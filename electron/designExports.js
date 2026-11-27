import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import {
  designExportFormats,
  designExportName,
} from '../shared/designExports.js';
import { isDrawingFile } from '../shared/drawingFiles.js';
import {
  isProjectFile,
  MAX_PROJECT_SETTINGS_BYTES,
  validProjectName,
} from '../shared/projectFiles.js';

const settingsKey = 'designExportLocations';
const settingsBlock = /<\?tinycad-exports\s+([\s\S]*?)\?>/;
const blankSettings =
  '<?xml version="1.0" encoding="UTF-8"?>\n<TinyCADProject/>\n';
const keyFor = (...fields) =>
  createHash('sha256').update(JSON.stringify(fields)).digest('hex');

function relativeTo(root, file) {
  const relative = path.relative(root, file);
  return relative &&
    !path.isAbsolute(relative) &&
    relative !== '..' &&
    !relative.startsWith('..' + path.sep)
    ? relative.split(path.sep).join('/')
    : undefined;
}

function decodeSettings(bytes) {
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
      ? 'utf-16be'
      : 'utf-8';
  let text = new TextDecoder(encoding, {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes);
  if (!text.trim())
    text =
      (text.startsWith('\uFEFF') ? '\uFEFF' : '') +
      (encoding === 'utf-8'
        ? blankSettings
        : blankSettings.replace('UTF-8', 'UTF-16'));
  const block = settingsBlock.exec(text);
  const settings = block ? JSON.parse(block[1]) : { version: 1, drawings: {} };
  if (
    settings?.version !== 1 ||
    !settings.drawings ||
    Array.isArray(settings.drawings) ||
    typeof settings.drawings !== 'object' ||
    (settings.drafts !== undefined &&
      (!settings.drafts ||
        Array.isArray(settings.drafts) ||
        typeof settings.drafts !== 'object'))
  )
    throw new Error('Unsupported export settings in the project file.');
  return { text, encoding, settings };
}

export function createDesignExportHandler({
  dialog,
  store,
  openedRoots,
  readFile,
  pendingWrites,
  linkNewFile,
}) {
  const drafts = new Map();

  async function projectSettings(root) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const markers = entries.filter(
      (entry) => !entry.isDirectory() && isProjectFile(entry.name),
    );
    if (markers.length > 1 || (markers.length && !markers[0].isFile()))
      throw new Error('Keep one root settings file in the project folder.');
    const name = path.basename(root) + '.tcproject';
    const target = path.join(
      root,
      markers[0]?.name ?? (validProjectName(name) ? name : 'Project.tcproject'),
    );
    const bytes = markers.length
      ? await readFile(target, MAX_PROJECT_SETTINGS_BYTES)
      : null;
    return {
      target,
      bytes,
      ...decodeSettings(bytes ?? Buffer.from(blankSettings)),
    };
  }

  async function writeAtomic(target, data, beforeReplace) {
    if (pendingWrites.has(target))
      throw new Error('A save is already in progress for this file.');
    pendingWrites.add(target);
    const temp = path.join(
      path.dirname(target),
      `.tinycad-${randomUUID()}.tmp`,
    );
    try {
      const file = await fs.open(temp, 'wx');
      try {
        await file.writeFile(data);
        await file.sync();
      } finally {
        await file.close();
      }
      if (await beforeReplace()) await fs.rename(temp, target);
      else await linkNewFile(temp, target);
    } finally {
      pendingWrites.delete(target);
      await fs.unlink(temp).catch((error) => {
        if (error.code !== 'ENOENT')
          console.error('Unable to remove temporary export', error);
      });
    }
  }

  async function updateProjectSettings(root, update) {
    const release = await lockfile.lock(root, {
      lockfilePath: path.join(root, '.tinycad-e070ca7e.tmp'),
      retries: { retries: 5, minTimeout: 30, maxTimeout: 250 },
    });
    try {
      const { target, bytes, text, encoding, settings } = await projectSettings(
        root,
      );
      if (!update(settings)) return;
      const block =
        '<?tinycad-exports\n' +
        JSON.stringify(settings, null, 2).replaceAll('?', '\\u003f') +
        '\n?>';
      const next = settingsBlock.test(text)
        ? text.replace(settingsBlock, () => block)
        : text + (text.endsWith('\n') ? '' : '\n') + block + '\n';
      const data = Buffer.from(next, encoding === 'utf-8' ? 'utf8' : 'utf16le');
      if (encoding === 'utf-16be') data.swap16();
      if (data.length > MAX_PROJECT_SETTINGS_BYTES)
        throw new Error('The project settings file is too large.');
      await writeAtomic(target, data, async () => {
        if (!bytes) return false;
        if (!bytes.equals(await readFile(target, MAX_PROJECT_SETTINGS_BYTES)))
          throw new Error(
            'The project settings changed on disk. Try saving again.',
          );
        return true;
      });
    } finally {
      await release();
    }
  }

  return async function handleDesignExport(window, request) {
    const { operation, drawingId, project, draftId, name, format } = request;
    if (
      !validProjectName(name) ||
      !isDrawingFile(name) ||
      (drawingId != null &&
        (typeof drawingId !== 'string' ||
          !path.isAbsolute(drawingId) ||
          !isDrawingFile(drawingId))) ||
      typeof draftId !== 'string' ||
      !draftId ||
      draftId.length > 150
    )
      throw new Error('Invalid design export source.');
    if (project && !openedRoots.has(project))
      throw new Error('Open the project folder first.');
    const drawing =
      drawingId && project ? relativeTo(project, drawingId) : undefined;
    const projectDraft = project && !drawingId;
    const draftKey = keyFor(project ?? '', draftId);
    const draft = drafts.get(draftKey);
    const preference = (kind) =>
      settingsKey + '.' + keyFor(path.normalize(drawingId), kind);

    if (operation === 'bind-design-exports') {
      if (!drawingId) return;
      if (
        drawing &&
        (await projectSettings(project)).settings.drafts?.[draftKey]
      )
        await updateProjectSettings(project, (settings) => {
          const outputs = settings.drafts?.[draftKey]?.outputs;
          if (!outputs) return false;
          settings.drawings[drawing] = {
            ...settings.drawings[drawing],
            ...outputs,
          };
          delete settings.drafts[draftKey];
          if (!Object.keys(settings.drafts).length) delete settings.drafts;
          return true;
        });
      for (const [kind, file] of Object.entries(draft ?? {}))
        store.set(preference(kind), file);
      drafts.delete(draftKey);
      return;
    }

    if (!Object.hasOwn(designExportFormats, format))
      throw new Error('Invalid export format.');
    const { description, extension } = designExportFormats[format];
    const allowedExtension = (file) =>
      path.extname(file).toLowerCase() === extension ||
      (format === 'VHDL' && /\.vhd$/i.test(file));
    const local = drawingId ? store.get(preference(format), null) : null;
    const approved =
      typeof local === 'string' &&
      path.isAbsolute(local) &&
      allowedExtension(local)
        ? local
        : null;
    const settings =
      drawing || projectDraft
        ? (await projectSettings(project)).settings
        : undefined;
    const configured = drawing
      ? settings.drawings[drawing]?.[format]
      : settings?.drafts?.[draftKey]?.outputs?.[format];
    let configuredPath;
    if (typeof configured === 'string') {
      const absolute = path.isAbsolute(configured)
        ? configured
        : path.resolve(project, configured);
      if (
        absolute &&
        (path.isAbsolute(configured) || relativeTo(project, absolute)) &&
        allowedExtension(absolute)
      )
        configuredPath = absolute;
    }
    const remembered = configuredPath ?? approved ?? draft?.[format];
    if (operation === 'export-destination') return remembered ?? null;
    if (typeof request.text !== 'string')
      throw new Error('Invalid export contents.');

    const direct =
      !request.saveAs &&
      remembered &&
      (remembered === approved || remembered === draft?.[format]) &&
      (await fs.stat(path.dirname(remembered)).then(
        (item) => item.isDirectory(),
        () => false,
      ));
    let target = remembered;
    if (!direct) {
      const folder = drawingId ? path.dirname(drawingId) : project;
      const selection = await dialog.showSaveDialog(window, {
        title: `Save ${description} As`,
        defaultPath:
          remembered ?? path.join(folder ?? '', designExportName(name, format)),
        filters: [
          {
            name: description,
            extensions:
              format === 'VHDL' ? ['vhdl', 'vhd'] : [extension.slice(1)],
          },
        ],
      });
      if (selection.canceled || !selection.filePath) return false;
      target = selection.filePath;
      if (!path.extname(target)) target += extension;
      if (!allowedExtension(target))
        throw new Error(`Choose a filename ending in ${extension}.`);
    }

    const parent = await fs.realpath(path.dirname(target));
    const file = path.join(parent, path.basename(target));
    if (direct && file !== target)
      throw new Error(
        'The export folder changed. Use Save As to select it again.',
      );
    await writeAtomic(file, request.text, async () => {
      const entry = await fs.lstat(file).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      if (entry && !entry.isFile())
        throw new Error('Choose a regular file as the export destination.');
      return !!entry;
    });
    try {
      if ((drawing || projectDraft) && file !== configuredPath)
        await updateProjectSettings(project, (settings) => {
          const destination = relativeTo(project, file) ?? file;
          if (drawing) {
            settings.drawings[drawing] = {
              ...settings.drawings[drawing],
              [format]: destination,
            };
          } else {
            settings.drafts ??= {};
            settings.drafts[draftKey] = {
              name,
              outputs: {
                ...settings.drafts[draftKey]?.outputs,
                [format]: destination,
              },
            };
          }
          return true;
        });
      if (drawingId) store.set(preference(format), file);
      else drafts.set(draftKey, { ...drafts.get(draftKey), [format]: file });
    } catch (error) {
      throw new Error(
        `The export was saved, but its location could not be remembered. ${error.message}`,
      );
    }
    return true;
  };
}
