import fs from 'node:fs/promises';
import path from 'node:path';
import { readNativeLibrary } from './tclibReader.js';

const section = 'libraries';
const grantsKey = 'projectLibraryFiles';
const isLibrary = (id) =>
  typeof id === 'string' && !id.includes('\0') && /\.tclib$/i.test(id);
const isAbsolute = (id) => path.isAbsolute(id) || path.win32.isAbsolute(id);
const pathKey = (id) => (process.platform === 'win32' ? id.toLowerCase() : id);

export function createProjectLibraryHandler({
  dialog,
  store,
  openedRoots,
  within,
  readProjectSettings,
  updateProjectSettings,
}) {
  const globalLibraries = () => {
    const libraries = store.get('libraries', []);
    return Array.isArray(libraries) ? libraries : [];
  };
  const grants = () => {
    const entries = store.get(grantsKey, []);
    return Array.isArray(entries) ? entries : [];
  };

  async function libraryPath(project, id, externalAllowed) {
    if (!isLibrary(id) || !path.isAbsolute(id))
      throw new Error('Choose a TinyCAD library.');
    const target = path.normalize(id);
    if (!within(project, target) && !externalAllowed)
      throw new Error(
        'Choose this external library again to grant the project access.',
      );
    const canonical = await fs.realpath(target);
    if (!externalAllowed && !within(project, canonical))
      throw new Error('The library is outside the open project.');
    return canonical;
  }

  return async function handleProjectLibraries(window, request) {
    const { project, operation, id } = request;
    if (!openedRoots.has(project) || (await fs.realpath(project)) !== project)
      throw new Error('Open a project folder first.');
    if (operation === 'project-library-config') {
      const saved = await readProjectSettings(project, section);
      if (saved === undefined)
        return {
          saved: false,
          config: {
            libraries: globalLibraries(),
            libraryFolders: store.get('libraryFolders', []),
          },
        };
      if (
        saved?.version !== 1 ||
        !Array.isArray(saved.libraries) ||
        !Array.isArray(saved.libraryFolders)
      )
        throw new Error('Unsupported library settings in the project file.');
      const libraries = saved.libraries.flatMap((entry) => {
        if (!isLibrary(entry?.id)) return [];
        if (isAbsolute(entry.id)) return [entry];
        const id = path.resolve(project, entry.id.replaceAll('\\', '/'));
        return within(project, id) ? [{ ...entry, id }] : [];
      });
      return {
        saved: true,
        config: { libraries, libraryFolders: saved.libraryFolders },
      };
    }
    if (operation === 'save-project-library-config') {
      const { config, initialOnly } = request;
      if (
        !Array.isArray(config?.libraries) ||
        !Array.isArray(config.libraryFolders)
      )
        throw new Error('Invalid project library settings.');
      await updateProjectSettings(project, section, (saved) => {
        if (initialOnly && saved !== undefined) return;
        const libraries = config.libraries.flatMap((entry) => {
          if (!isLibrary(entry?.id) || !isAbsolute(entry.id)) return [];
          const id =
            path.isAbsolute(entry.id) && within(project, entry.id)
              ? path.relative(project, entry.id).split(path.sep).join('/')
              : entry.id;
          return [{ id, name: entry.name, folderId: entry.folderId }];
        });
        const next = {
          version: 1,
          libraries,
          libraryFolders: config.libraryFolders,
        };
        if (JSON.stringify(saved) !== JSON.stringify(next)) return next;
      });
      return;
    }
    if (operation === 'choose-project-libraries') {
      const selection =
        id === undefined
          ? await dialog.showOpenDialog(window, {
              defaultPath: project,
              properties: ['openFile', 'multiSelections'],
              filters: [{ name: 'TinyCAD libraries', extensions: ['tclib'] }],
            })
          : { canceled: false, filePaths: [id] };
      if (selection.canceled) return [];
      const paths = await Promise.all(
        selection.filePaths.map(async (filename) => {
          const canonical = await libraryPath(
            project,
            filename,
            id === undefined,
          );
          if (!isLibrary(canonical) || !(await fs.stat(canonical)).isFile())
            throw new Error('Choose a TinyCAD library.');
          return canonical;
        }),
      );
      const known = grants();
      const external = [...new Set(paths)].filter(
        (filename) =>
          !within(project, filename) &&
          !known.some(
            (entry) => entry?.project === project && entry.id === filename,
          ),
      );
      if (external.length)
        store.set(grantsKey, [
          ...known,
          ...external.map((id) => ({ project, id })),
        ]);
      return paths.map((id) => ({ id, name: path.basename(id) }));
    }

    const allowed =
      grants().some((entry) => entry?.project === project && entry.id === id) ||
      globalLibraries().some(
        (entry) => (typeof entry === 'string' ? entry : entry?.id) === id,
      );
    const filename = await libraryPath(project, id, allowed);
    // Only paths granted by the picker or present in the user's custom list may leave the project.
    if (
      allowed &&
      pathKey(filename) !== pathKey(path.normalize(id)) &&
      !within(project, filename)
    )
      throw new Error(
        'Choose this external library again to grant the project access.',
      );
    const stats = await fs.stat(filename);
    if (!stats.isFile()) throw new Error('The library path must be a file.');
    return {
      ...(stats.size
        ? await readNativeLibrary(filename)
        : { names: [], symbols: [] }),
      fileId: id,
      name: path.basename(filename),
      modified: stats.mtime.toISOString(),
    };
  };
}
