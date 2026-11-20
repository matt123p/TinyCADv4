import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import {
  MAX_PROJECT_FILE_BYTES,
  isProjectFile,
} from '../shared/projectFiles.js';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function validName(name) {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 240 &&
    !/[/\\<>:"|?*\x00-\x1f]|[. ]$/.test(name) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  );
}

export function registerProjectFiles({
  ipcMain,
  getWindow,
  dialog,
  shell,
  store,
  documents,
}) {
  let root = store.get('projectFolder', documents);
  const pendingWrites = new Set();

  async function linkNewFile(source, target) {
    try {
      await fs.link(source, target);
    } catch (error) {
      if (
        !['ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'EPERM', 'ENOSYS'].includes(
          error.code,
        )
      )
        throw error;
      await fs.copyFile(source, target, constants.COPYFILE_EXCL);
    }
  }
  ipcMain.handle('project-files', async (event, request) => {
    const window = getWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    ) {
      throw new Error('Projects are available only to the host main frame.');
    }
    if (request.operation === 'choose') {
      const selection = await dialog.showOpenDialog(window, {
        defaultPath: root,
        properties: ['openDirectory'],
      });
      if (selection.canceled) return null;
      root = await fs.realpath(selection.filePaths[0]);
      store.set('projectFolder', root);
      return { id: root, name: path.basename(root) || root };
    }
    if (request.operation === 'root')
      return { id: root, name: path.basename(root) || root };

    const base = await fs.realpath(root);
    const resolve = async (id, directory) => {
      if (typeof id !== 'string' || !path.isAbsolute(id))
        throw new Error('Invalid project location.');
      const target = await fs.realpath(id);
      const relative = path.relative(base, target);
      if (
        (!directory && !relative) ||
        relative === '..' ||
        relative.startsWith('..' + path.sep) ||
        path.isAbsolute(relative)
      ) {
        throw new Error('Location is outside the project folder.');
      }
      const stat = await fs.stat(target);
      if (
        directory
          ? !stat.isDirectory()
          : !stat.isFile() || !isProjectFile(target)
      )
        throw new Error('Invalid project file or folder.');
      return target;
    };
    const destination = async (folder, name) => {
      if (!validName(name)) throw new Error('Invalid file or folder name.');
      return path.join(await resolve(folder, true), name);
    };
    const read = async (id) => {
      const filename = await resolve(id, false);
      const file = await fs.open(
        filename,
        constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
      );
      try {
        const stat = await file.stat();
        const { size } = stat;
        if (!stat.isFile() || size > MAX_PROJECT_FILE_BYTES)
          throw new Error('Invalid or oversized project file.');
        const buffer = Buffer.allocUnsafe(size + 1);
        let offset = 0;
        while (offset < buffer.length) {
          const { bytesRead } = await file.read(
            buffer,
            offset,
            buffer.length - offset,
            offset,
          );
          if (!bytesRead) break;
          offset += bytesRead;
        }
        if (offset !== size)
          throw new Error('Project changed while it was being read.');
        return buffer.subarray(0, size);
      } finally {
        await file.close();
      }
    };

    const { operation, id, folder, name } = request;
    if (operation === 'list') {
      const parent = await resolve(folder, true);
      return (await fs.readdir(parent, { withFileTypes: true }))
        .filter(
          (item) =>
            !item.name.startsWith('.') &&
            (item.isDirectory() || (item.isFile() && isProjectFile(item.name))),
        )
        .map((item) => ({
          id: path.join(parent, item.name),
          name: item.name,
          folder: item.isDirectory(),
        }));
    }
    if (operation === 'read') {
      const data = await read(id);
      return { data: new Uint8Array(data), version: hash(data) };
    }
    if (operation === 'mkdir') {
      await fs.mkdir(await destination(folder, name));
      return;
    }
    if (operation === 'rename' || operation === 'move') {
      const source = await resolve(id, request.directory === true);
      if (source === base)
        throw new Error(
          'Choose a different project root before moving this folder.',
        );
      const target = await destination(folder, name);
      if (target === source) return { id: target, name };
      if (pendingWrites.has(source) || pendingWrites.has(target))
        throw new Error('A project save is in progress.');
      if (request.directory === true) {
        try {
          await fs.lstat(target);
          throw new Error('A file or folder already has that name.');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        await fs.rename(source, target);
      } else {
        if (!isProjectFile(name))
          throw new Error('Project files use the .tcproject extension.');
        await linkNewFile(source, target);
        try {
          await fs.unlink(source);
        } catch (error) {
          await fs.unlink(target);
          throw error;
        }
      }
      return { id: target, name };
    }
    if (operation === 'trash') {
      const target = await resolve(id, request.directory === true);
      if (target === base || pendingWrites.has(target))
        throw new Error('This location is in use.');
      await shell.trashItem(target);
      return;
    }
    if (operation === 'write') {
      const { data, version } = request;
      if (
        !(data instanceof Uint8Array) ||
        data.length > MAX_PROJECT_FILE_BYTES ||
        !isProjectFile(name)
      )
        throw new Error('Invalid project data.');
      const target = id
        ? await resolve(id, false)
        : await destination(folder, name);
      if (pendingWrites.has(target))
        throw new Error('A project save is in progress.');
      pendingWrites.add(target);
      const temp = path.join(
        path.dirname(target),
        `.tinycad-${randomUUID()}.tmp`,
      );
      try {
        const handle = await fs.open(temp, 'wx');
        try {
          await handle.writeFile(data);
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (id) {
          if (hash(await read(id)) !== version)
            throw new Error(
              'Project changed on disk. Reopen it or save a copy.',
            );
          await fs.rename(temp, target);
        } else {
          await linkNewFile(temp, target);
        }
        return { id: target, name: path.basename(target), version: hash(data) };
      } finally {
        pendingWrites.delete(target);
        await fs.unlink(temp).catch((error) => {
          if (error.code !== 'ENOENT')
            console.error('Unable to remove temporary project file', error);
        });
      }
    }
    throw new Error('Unknown project operation.');
  });
}
