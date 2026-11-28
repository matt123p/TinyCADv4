import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import {
  isProjectFile,
  MAX_PROJECT_SETTINGS_BYTES,
  validProjectName,
} from '../shared/projectFiles.js';

const blankSettings =
  '<?xml version="1.0" encoding="UTF-8"?>\n<TinyCADProject/>\n';

const sectionPattern = (section) =>
  new RegExp(`<\\?tinycad-${section}\\s+([\\s\\S]*?)\\?>`);

function readSection(text, section) {
  const block = sectionPattern(section).exec(text);
  return block ? JSON.parse(block[1]) : undefined;
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
  return { text, encoding };
}

export function createProjectSettings({
  readFile,
  pendingWrites,
  linkNewFile,
}) {
  async function projectSettings(root) {
    if ((await fs.realpath(root)) !== root)
      throw new Error('The project folder has moved.');
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
          console.error('Unable to remove temporary project file', error);
      });
    }
  }

  async function updateProjectSettings(root, section, update) {
    const release = await lockfile.lock(root, {
      lockfilePath: path.join(root, '.tinycad-e070ca7e.tmp'),
      retries: { retries: 5, minTimeout: 30, maxTimeout: 250 },
    });
    try {
      const { target, bytes, text, encoding } = await projectSettings(root);
      const settingsBlock = sectionPattern(section);
      const settings = await update(readSection(text, section));
      if (settings === undefined) return;
      const block =
        '<?tinycad-' +
        section +
        '\n' +
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

  async function readProjectSettings(root, section) {
    return readSection((await projectSettings(root)).text, section);
  }

  return { readProjectSettings, updateProjectSettings, writeAtomic };
}
