import fs from 'node:fs/promises';
import path from 'node:path';
import { constants, createReadStream, watch } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { cloneProjectGit, runProjectGit } from './projectGit.js';
import {
  MAX_PROJECT_FILE_BYTES,
  MAX_PROJECT_SETTINGS_BYTES,
  isProjectFile,
  validProjectName,
} from '../shared/projectFiles.js';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const temporaryProjectFile = /^\.tinycad-[0-9a-f-]+\.tmp$/;
const recentFoldersKey = 'recentProjectFolders';

export function recentProjectFolders(store) {
  const saved = store.get(recentFoldersKey, []);
  const folders = [...(Array.isArray(saved) ? saved : []), store.get('recentProjectFolder', null)];
  return [...new Set(folders.filter((folder) => typeof folder === 'string' && path.isAbsolute(folder)))].slice(0, 10);
}

export function registerProjectFiles({
  ipcMain,
  getWindow,
  dialog,
  shell,
  store,
  documents,
  takeProjectOpen,
  onRecentProjectsChanged,
}) {
  let root = store.get('projectFolder', documents);
  const pendingWrites = new Set();
  const openedRoots = new Set();
  const selectedDocuments = new Set();
  let pendingLaunch;
  const folderWatchers = new Map();
  let watchOwner;
  let watchVersion = 0;
  let watchNotice;

  function rememberProjectFolder(folder) {
    const recent = recentProjectFolders(store).filter((entry) => entry !== folder);
    store.set?.(recentFoldersKey, [folder, ...recent].slice(0, 10));
    onRecentProjectsChanged?.();
  }

  async function openRecentFolder(folder) {
    const selected = await fs.realpath(folder);
    if (selected !== folder) throw new Error('The project folder has moved.');
    await fs.readdir(selected);
    openedRoots.add(selected);
    return { id: selected, name: path.basename(selected) || selected };
  }

  function stopWatching() {
    watchVersion++;
    clearTimeout(watchNotice);
    watchNotice = undefined;
    for (const watcher of folderWatchers.values()) watcher.close();
    folderWatchers.clear();
    watchOwner?.removeListener('destroyed', stopWatching);
    watchOwner?.removeListener('render-process-gone', stopWatching);
    watchOwner?.removeListener('did-navigate', stopWatching);
    watchOwner = undefined;
  }

  function notifyFolderChange() {
    if (watchNotice) return;
    watchNotice = setTimeout(() => {
      watchNotice = undefined;
      if (watchOwner && !watchOwner.isDestroyed())
        watchOwner.send('project-folders-changed');
    }, 100);
  }

  const within = (base, target, directory = false) => {
    const relative = path.relative(base, target);
    return (
      (relative !== '' || directory) &&
      relative !== '..' &&
      !relative.startsWith('..' + path.sep) &&
      !path.isAbsolute(relative)
    );
  };

  async function readFile(filename, maxBytes = MAX_PROJECT_FILE_BYTES) {
    const file = await fs.open(
      filename,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
    );
    try {
      const stat = await file.stat();
      const { size } = stat;
      if (!stat.isFile() || size > maxBytes)
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
  }

  async function launchMarker(filename) {
    const parent = await fs.realpath(path.dirname(filename));
    const name = path.basename(filename);
    const marker = path.join(parent, name);
    const entries = await fs.readdir(parent, { withFileTypes: true });
    const markers = entries.filter(
      (entry) => !entry.isDirectory() && isProjectFile(entry.name),
    );
    if (
      markers.length !== 1 ||
      !markers[0].isFile() ||
      (await fs.realpath(marker)) !== path.join(parent, markers[0].name)
    )
      throw new Error('A project folder needs exactly one root settings file.');
    const id = path.join(parent, markers[0].name);
    const data = await readFile(id, MAX_PROJECT_SETTINGS_BYTES);
    return {
      root: { id: parent, name: path.basename(parent) || parent },
      marker: { id, name: markers[0].name },
      data: new Uint8Array(data),
      version: hash(data),
    };
  }

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
    if (request.operation === 'open-launch') {
      const filename = takeProjectOpen?.();
      if (!filename) return null;
      const launch = {
        filename,
        ticket: randomUUID(),
        prepared: launchMarker(filename),
      };
      pendingLaunch = launch;
      try {
        const prepared = await launch.prepared;
        return { ...prepared, ticket: launch.ticket };
      } catch (error) {
        if (pendingLaunch === launch) pendingLaunch = undefined;
        throw error;
      }
    }
    if (request.operation === 'activate-launch') {
      const launch = pendingLaunch;
      if (!launch || launch.ticket !== request.ticket)
        throw new Error('The project open request is no longer available.');
      pendingLaunch = undefined;
      const [prepared, current] = await Promise.all([
        launch.prepared,
        launchMarker(launch.filename),
      ]);
      if (
        prepared.marker.id !== current.marker.id ||
        prepared.version !== current.version
      )
        throw new Error('The selected project changed. Open it again.');
      openedRoots.add(current.root.id);
      rememberProjectFolder(current.root.id);
      return current.root;
    }
    if (request.operation === 'git-clone') {
      const selection = await dialog.showOpenDialog(window, {
        defaultPath: root,
        properties: ['openDirectory'],
      });
      if (selection.canceled) return null;
      const parent = await fs.realpath(selection.filePaths[0]);
      const cloned = await cloneProjectGit(
        parent,
        request.source,
        request.name,
      );
      openedRoots.add(cloned.id);
      rememberProjectFolder(cloned.id);
      return cloned;
    }
    if (request.operation === 'recent-project-folder') {
      for (const folder of recentProjectFolders(store)) {
        try {
          return await openRecentFolder(folder);
        } catch {
          // Try older folders when the newest one is unavailable.
        }
      }
      return null;
    }
    if (request.operation === 'open-recent-project-folder') {
      if (!recentProjectFolders(store).includes(request.id))
        throw new Error('This folder is unavailable in Recent Projects.');
      let selected;
      try {
        selected = await openRecentFolder(request.id);
      } catch {
        throw new Error(`Cannot open project folder: ${request.id}`);
      }
      rememberProjectFolder(selected.id);
      return selected;
    }
    if (
      request.operation === 'choose' ||
      request.operation === 'choose-project-folder'
    ) {
      const currentProject = request.containProject;
      const selection = await dialog.showOpenDialog(window, {
        defaultPath: currentProject ? path.dirname(root) : root,
        properties: ['openDirectory'],
      });
      if (selection.canceled) return null;
      const selected = await fs.realpath(selection.filePaths[0]);
      if (currentProject) {
        const relative = path.relative(selected, currentProject);
        if (
          !relative ||
          relative === '..' ||
          relative.startsWith('..' + path.sep) ||
          path.isAbsolute(relative)
        ) {
          throw new Error('Choose a parent folder of the open project.');
        }
      }
      if (request.operation === 'choose-project-folder') {
        openedRoots.add(selected);
        rememberProjectFolder(selected);
      } else {
        root = selected;
        store.set('projectFolder', root);
      }
      return { id: selected, name: path.basename(selected) || selected };
    }
    if (request.operation === 'root') {
      root = await fs.realpath(root).catch(() => root);
      return { id: root, name: path.basename(root) || root };
    }

    const { operation, id, folder, name } = request;
    let version;
    if (operation === 'watch-folders') {
      if (!Array.isArray(request.folders)) throw new Error('Invalid project folders.');
      if (watchOwner !== event.sender) stopWatching();
      if (!request.folders.length) {
        stopWatching();
        return;
      }
      if (!watchOwner) {
        watchOwner = event.sender;
        watchOwner.once('destroyed', stopWatching);
        watchOwner.once('render-process-gone', stopWatching);
        watchOwner.once('did-navigate', stopWatching);
      }
      version = ++watchVersion;
    }

    const base = await fs.realpath(root).catch(() => root);
    const allowedRoots = new Set([base, ...openedRoots]);
    const resolve = async (id, directory, allowSelected = false) => {
      if (typeof id !== 'string' || !path.isAbsolute(id))
        throw new Error('Invalid project location.');
      const target = path.resolve(id);
      if (!(allowSelected && !directory && selectedDocuments.has(target)) &&
          ![...allowedRoots].some((root) => within(root, target, directory)))
        throw new Error('Location is outside the project folder.');
      if ((await fs.realpath(target)) !== target)
        throw new Error('Symbolic links are unavailable in project trees.');
      const stat = await fs.stat(target);
      if (directory ? !stat.isDirectory() : !stat.isFile())
        throw new Error('Invalid project file or folder.');
      return target;
    };
    const destination = async (folder, name) => {
      if (!validProjectName(name))
        throw new Error('Invalid file or folder name.');
      return path.join(await resolve(folder, true), name);
    };
    const read = async (id, allowSelected = false) => readFile(await resolve(id, false, allowSelected));

    if (operation === 'watch-folders') {
      const directories = await Promise.all([...new Set(request.folders)].map(async (id) => {
        try {
          return await resolve(id, true);
        } catch (error) {
          if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
        }
      }));
      if (version !== watchVersion) return;
      const wanted = new Set(directories.filter(Boolean));
      for (const [directory, watcher] of folderWatchers) {
        if (wanted.has(directory)) continue;
        watcher.close();
        folderWatchers.delete(directory);
      }
      for (const directory of wanted) {
        if (folderWatchers.has(directory)) continue;
        try {
          const watcher = watch(directory, { persistent: false }, (eventType, filename) => {
            if (folderWatchers.get(directory) === watcher &&
              (!filename || eventType === 'rename') && !temporaryProjectFile.test(filename ?? ''))
              notifyFolderChange();
          });
          folderWatchers.set(directory, watcher);
          watcher.on('error', () => {
            if (folderWatchers.get(directory) !== watcher) return;
            watcher.close();
            folderWatchers.delete(directory);
            notifyFolderChange();
          });
        } catch {
          // Some filesystems do not support watching. The tree can still be refreshed manually.
        }
      }
      return;
    }
    if (operation === 'git')
      return runProjectGit(await resolve(folder, true), request.request);
    if (operation === 'list') {
      const parent = await resolve(folder, true);
      return (await fs.readdir(parent, { withFileTypes: true }))
        .filter((item) =>
          request.tree
            ? !temporaryProjectFile.test(item.name)
            : !item.name.startsWith('.') &&
              (item.isDirectory() ||
                (item.isFile() && isProjectFile(item.name))),
        )
        .map((item) => ({
          id: path.join(parent, item.name),
          name: item.name,
          folder: item.isDirectory(),
          ...(!item.isDirectory() && !item.isFile()
            ? { unsupported: true }
            : {}),
        }));
    }
    if (operation === 'read') {
      const data = await read(id, true);
      return { data: new Uint8Array(data), version: hash(data) };
    }
    if (operation === 'mkdir') {
      const target = await destination(folder, name);
      await fs.mkdir(target);
      return { id: target, name };
    }
    if (operation === 'rename' || operation === 'move') {
      const source = await resolve(id, request.directory === true);
      if (allowedRoots.has(source))
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
      if (allowedRoots.has(target) || pendingWrites.has(target) ||
          (request.directory && [...pendingWrites].some((file) => within(target, file))))
        throw new Error('This location is in use.');
      await shell.trashItem(target);
      return;
    }
    if (operation === 'copy') {
      const source = await resolve(id, false);
      await fs.copyFile(
        source,
        await destination(folder, name),
        constants.COPYFILE_EXCL,
      );
      return;
    }
    if (operation === 'folder-identity') {
      const stat = await fs.stat(await resolve(id, true), { bigint: true });
      return `${stat.dev}:${stat.ino}`;
    }
    if (operation === 'fingerprint') {
      const source = await resolve(id, false);
      const digest = createHash('sha256');
      for await (const part of createReadStream(source, {
        flags: constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
      }))
        digest.update(part);
      return digest.digest('hex');
    }
    if (operation === 'write') {
      const { data, version } = request;
      if (
        !(data instanceof Uint8Array) ||
        data.length > MAX_PROJECT_FILE_BYTES ||
        !validProjectName(name)
      )
        throw new Error('Invalid project data.');
      const target = id
        ? await resolve(id, false, true)
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
          if (hash(await read(id, true)) !== version)
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

  return async (filename) => {
    const selected = await fs.realpath(filename);
    if (!(await fs.stat(selected)).isFile()) throw new Error('Select a project file.');
    selectedDocuments.add(selected);
    return selected;
  };
}
