import fs from 'node:fs/promises';
import path from 'node:path';
import { parseBundledLibraryCatalog } from '../shared/bundledLibraries.js';

export function registerBundledLibraries({
  ipcMain,
  getWindow,
  directory,
  store,
}) {
  const authorize = (event) => {
    const window = getWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    ) {
      throw new Error(
        'Bundled libraries are available only to the host main frame.',
      );
    }
  };
  const catalog = async () =>
    parseBundledLibraryCatalog(
      JSON.parse(
        await fs.readFile(path.join(directory, 'config.json'), 'utf8'),
      ),
    );
  ipcMain.handle('bundled-library-catalog', async (event) => {
    authorize(event);
    return catalog();
  });
  ipcMain.handle('bundled-library-read', async (event, id) => {
    authorize(event);
    const entry = (await catalog()).libraries.find((entry) => entry.id === id);
    if (!entry) throw new Error('Unknown bundled library.');
    const root = await fs.realpath(directory);
    const file = await fs.realpath(path.join(root, entry.path));
    const relative = path.relative(root, file);
    if (
      relative === '..' ||
      relative.startsWith('..' + path.sep) ||
      path.isAbsolute(relative)
    )
      throw new Error('Invalid bundled library location.');
    return new Uint8Array(await fs.readFile(file));
  });
  ipcMain.handle('bundled-library-selection', async (event, ids) => {
    authorize(event);
    if (ids === undefined) return store.get('bundledLibrarySelection', []);
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))
      throw new Error('Invalid bundled library selection.');
    if (ids.length > 1)
      throw new Error('Choose only one standard library at a time.');
    store.set('bundledLibrarySelection', [...new Set(ids)]);
  });
}
