import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  designExportFormats,
  designExportName,
} from '../shared/designExports.js';
import { isDrawingFile } from '../shared/drawingFiles.js';
import { validProjectName } from '../shared/projectFiles.js';

const settingsKey = 'designExportLocations';
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

function exportSettings(settings = { version: 1, drawings: {} }) {
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
  return settings;
}

export function createDesignExportHandler({
  dialog, store, openedRoots, readProjectSettings, updateProjectSettings, writeAtomic,
}) {
  const drafts = new Map();
  const readExports = async (root) => exportSettings(await readProjectSettings(root, 'exports'));
  const updateExports = (root, update) => updateProjectSettings(root, 'exports', (value) => {
    const settings = exportSettings(value);
    if (update(settings)) return settings;
  });

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
        (await readExports(project)).drafts?.[draftKey]
      )
        await updateExports(project, (settings) => {
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
        ? await readExports(project)
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
        await updateExports(project, (settings) => {
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
