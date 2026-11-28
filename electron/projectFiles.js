import fs from 'node:fs/promises';
import path from 'node:path';
import { constants, createReadStream, watch } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { addProjectWorktree, cloneProjectGit, projectWorktrees, runProjectGit } from './projectGit.js';
import { createDesignExportHandler } from './designExports.js';
import { createProjectSettings } from './projectSettings.js';
import { createProjectLibraryHandler } from './projectLibraries.js';
import { drawingFileName, isDrawingFile } from '../shared/drawingFiles.js';
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
  openLibrary,
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

  const sameFilename = (first, second) => process.platform === 'win32'
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;

  const hierarchyBase = (project, owner) => {
    if (!openedRoots.has(project) ||
        (owner !== undefined && owner !== project && (typeof owner !== 'string' || !path.isAbsolute(owner) ||
          !within(project, owner) || !isDrawingFile(owner))))
      throw new Error('Choose a linked schematic inside the open project.');
    return owner === undefined || owner === project ? project : path.dirname(owner);
  };
  const hierarchyTarget = (project, base, filename) => {
    if (typeof filename !== 'string' || filename.includes('\0') || !isDrawingFile(filename))
      throw new Error('Choose a TinyCAD schematic.');
    const target = path.resolve(base, filename.replaceAll('\\', '/'));
    if (!within(project, target))
      throw new Error('The linked schematic is outside the open project.');
    return target;
  };
  const hierarchyRelative = (base, target) => path.relative(base, target).split(path.sep).join('/');
  async function resolveHierarchyFile(project, target) {
    const id = await fs.realpath(target);
    if (!within(project, id) || !sameFilename(id, target))
      throw new Error('Symbolic links are unavailable in project trees.');
    return id;
  }

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
  const projectSettings = createProjectSettings({ readFile, pendingWrites, linkNewFile });
  const handleDesignExport = createDesignExportHandler({ dialog, store, openedRoots, ...projectSettings });
  const handleProjectLibraries = createProjectLibraryHandler({ dialog, store, openedRoots, within, ...projectSettings });
  ipcMain.handle('project-files', async (event, request) => {
    const window = getWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    ) {
      throw new Error('Projects are available only to the host main frame.');
    }
    if (['export-destination', 'save-design-export', 'bind-design-exports'].includes(request.operation))
      return handleDesignExport(window, request);
    if (['project-library-config', 'save-project-library-config', 'choose-project-libraries', 'read-project-library'].includes(request.operation))
      return handleProjectLibraries(window, request);
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
          const watcher = watch(directory, { persistent: false }, (_, filename) => {
            if (folderWatchers.get(directory) === watcher &&
              !temporaryProjectFile.test(filename ?? ''))
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
    if (operation === 'worktree-list')
      return projectWorktrees(await resolve(folder, true));
    if (operation === 'worktree-add' || operation === 'worktree-open') {
      const project = await resolve(folder, true);
      let target;
      if (operation === 'worktree-add') {
        if (!validProjectName(name)) throw new Error('Enter a valid worktree folder name.');
        const selection = await dialog.showOpenDialog(window, {
          title: 'Choose a parent folder for the worktree',
          defaultPath: path.dirname(project),
          properties: ['openDirectory'],
        });
        if (selection.canceled) return null;
        target = path.join(await fs.realpath(selection.filePaths[0]), name);
        await addProjectWorktree(project, target, request.branch, request.createBranch === true);
      } else {
        const worktree = (await projectWorktrees(project)).find((item) => item.id === id && !item.prunable && !item.bare);
        if (!worktree) throw new Error('This worktree is unavailable.');
        target = worktree.id;
      }
      const selected = await fs.realpath(target);
      openedRoots.add(selected);
      rememberProjectFolder(selected);
      return { id: selected, name: path.basename(selected) || selected };
    }
    if (operation === 'git')
      return runProjectGit(await resolve(folder, true), request.request);
    if (operation === 'choose-hierarchical-save') {
      const { project, owner, compressed } = request;
      if (!openedRoots.has(project) || !validProjectName(name))
        throw new Error('Choose a schematic filename inside the open project.');
      const folder = typeof owner === 'string' && within(project, owner)
        ? path.dirname(owner) : project;
      const extension = compressed === true ? 'dzn' : 'dsn';
      const selection = await dialog.showSaveDialog(window, {
        defaultPath: path.join(folder, drawingFileName(name, compressed === true)),
        filters: [{ name: 'TinyCAD schematics', extensions: [extension] }],
      });
      if (selection.canceled || !selection.filePath) return null;
      const selected = path.resolve(selection.filePath);
      const id = drawingFileName(selected, compressed === true);
      if (!within(project, id) || !validProjectName(path.basename(id)))
        throw new Error('Save the linked schematic inside the open project.');
      await resolve(path.dirname(selected), true);
      let version;
      try {
        await resolve(id, false);
        if (id !== selected)
          throw new Error('Select the exact filename to confirm replacing it.');
        version = hash(await readFile(id));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      return { id, folder: path.dirname(id), name: path.basename(id), version };
    }
    if (operation === 'rebase-hierarchical-links') {
      const { project, owner, links } = request;
      if (typeof owner !== 'string' || !Array.isArray(links) || links.length > 1000)
        throw new Error('Choose a schematic inside the open project.');
      const base = hierarchyBase(project, owner);
      return links.map(({ owner: source, filename }) => {
        const target = hierarchyTarget(project, hierarchyBase(project, source), filename);
        return hierarchyRelative(base, target);
      });
    }
    if (operation === 'choose-hierarchical-drawing') {
      const { project } = request;
      const base = hierarchyBase(project);
      const selection = await dialog.showOpenDialog(window, {
        defaultPath: project,
        properties: ['openFile'],
        filters: [{ name: 'TinyCAD schematics', extensions: ['dsn', 'dzn'] }],
      });
      if (selection.canceled) return null;
      const target = hierarchyTarget(project, base, selection.filePaths[0]);
      const id = await resolveHierarchyFile(project, target);
      return { id, name: path.basename(id) };
    }
    if (operation === 'read-hierarchical-drawing') {
      const { project, owner, filename } = request;
      const base = hierarchyBase(project, owner);
      const id = await resolveHierarchyFile(project, hierarchyTarget(project, base, filename));
      const data = await readFile(id, 32 * 1024 * 1024);
      return {
        id,
        folder: path.dirname(id),
        relative: hierarchyRelative(base, id),
        data: new Uint8Array(data),
        version: hash(data),
      };
    }
    if (operation === 'chat-list' || operation === 'chat-read') {
      const { project, relative = '', offset = 0 } = request;
      const parts = typeof relative === 'string' ? relative.split('/') : [];
      const visible = (name) =>
        name.toLowerCase() !== '.git' && !temporaryProjectFile.test(name);
      if (
        !openedRoots.has(project) ||
        (relative === ''
          ? operation !== 'chat-list'
          : !parts.length || parts.some((name) =>
              name === '.' || name === '..' || !validProjectName(name) || !visible(name)))
      ) throw new Error('Choose a path inside the current project.');

      const directory = operation === 'chat-list';
      const target = path.join(project, relative);
      if (!within(project, target, directory))
        throw new Error('Choose a path inside the current project.');
      if (!Number.isSafeInteger(offset) || offset < 0)
        throw new Error('Invalid directory offset.');
      let items;
      try {
        await resolve(target, directory);
        if (!directory) return new Uint8Array(await readFile(target, 32 * 1024 * 1024));
        items = await fs.readdir(target, { withFileTypes: true });
      } catch (error) {
        if (error.code) throw new Error('Could not open that project file or folder.');
        throw error;
      }
      const entries = items
        .filter((entry) => visible(entry.name) && validProjectName(entry.name) &&
          (entry.isDirectory() || entry.isFile()))
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) ||
          a.name.localeCompare(b.name));
      const limit = 100;
      return {
        entries: entries.slice(offset, offset + limit).map((entry) => ({
          path: relative ? `${relative}/${entry.name}` : entry.name,
          kind: entry.isDirectory() ? 'folder' : 'file',
        })),
        nextOffset: offset + limit < entries.length ? offset + limit : null,
      };
    }
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
    if (operation === 'reveal') {
      const target = await resolve(id, request.directory === true);
      if (request.openFolder && request.directory) {
        const error = await shell.openPath(target);
        if (error) throw new Error(error);
      } else {
        shell.showItemInFolder(target);
      }
      return;
    }
    if (operation === 'edit-library') {
      const target = await resolve(id, false);
      if (!/\.tclib$/i.test(target)) throw new Error('Choose a TinyCAD library.');
      openLibrary(target);
      return;
    }
    if (operation === 'create-entry') {
      const directory = request.directory === true;
      const parent = await resolve(folder, true);
      const suffix = request.extension ?? '';
      if (!/^(?:\.[a-z0-9]+)?$/i.test(suffix) || (directory && suffix))
        throw new Error('Invalid file extension.');
      const stem = directory ? 'New Folder' : 'New File';
      for (let count = 1; count <= 1000; count++) {
        const name = stem + (count === 1 ? '' : ' ' + count) + suffix;
        const target = path.join(parent, name);
        try {
          if (directory) await fs.mkdir(target);
          else await (await fs.open(target, 'wx')).close();
          return { id: target, name };
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
      }
      throw new Error('Could not find an available name.');
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
      if (pendingWrites.has(source) || pendingWrites.has(target) ||
          (request.directory && [...pendingWrites].some((file) => within(source, file))))
        throw new Error('A project save is in progress.');
      if (request.directory && within(source, target))
        throw new Error('A folder cannot be moved into itself.');
      const caseOnly = path.dirname(source) === path.dirname(target) &&
        path.basename(source).toLowerCase() === path.basename(target).toLowerCase();
      const aliasesSource = caseOnly && await fs.realpath(target).then(
        (resolved) => resolved === source,
        (error) => {
          if (error.code === 'ENOENT') return false;
          throw error;
        },
      );
      if (aliasesSource) {
        const names = await fs.readdir(path.dirname(source));
        if (names.includes(path.basename(target)))
          throw new Error('A file or folder already has that name.');
        await fs.rename(source, target);
      } else if (request.directory === true) {
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
      const identity = await fs.stat(target, { bigint: true });
      try {
        await shell.trashItem(target);
        return true;
      } catch {
        const result = await dialog.showMessageBox(window, {
          type: 'warning',
          message: 'The system Trash is unavailable for this item.',
          detail: `Permanently delete "${path.basename(target)}"?`,
          buttons: ['Cancel', 'Delete Permanently'],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response !== 1) return false;
        const selected = await resolve(id, request.directory === true);
        const current = await fs.stat(selected, { bigint: true });
        if (selected !== target || current.ino !== identity.ino || current.dev !== identity.dev)
          throw new Error('The location changed. Select it again.');
        if (pendingWrites.has(target) ||
            (request.directory && [...pendingWrites].some((file) => within(target, file))))
          throw new Error('A project save is in progress.');
        if (request.directory) await fs.rm(target, { recursive: true });
        else await fs.unlink(target);
        return true;
      }
    }
    if (operation === 'copy') {
      const directory = request.directory === true;
      const source = await resolve(id, directory);
      const target = await destination(folder, name);
      if (directory) {
        if (within(source, target, true)) throw new Error('A folder cannot be copied into itself.');
        await fs.mkdir(target);
        try {
          for (const child of await fs.readdir(source)) {
            if (child === '.git') continue;
            await fs.cp(path.join(source, child), path.join(target, child), {
              recursive: true,
              force: false,
              errorOnExist: true,
              verbatimSymlinks: true,
              filter: (entry) => path.basename(entry) !== '.git',
            });
          }
        } catch (error) {
          await fs.rm(target, { recursive: true, force: true });
          throw error;
        }
      } else {
        await fs.copyFile(source, target, constants.COPYFILE_EXCL);
      }
      return { id: target, name };
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
