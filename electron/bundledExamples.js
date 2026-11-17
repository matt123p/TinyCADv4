import fs from 'node:fs/promises';
import path from 'node:path';
import {
  parseExampleCatalog,
  exampleResourcePaths,
} from '../shared/bundledExamples.js';

export function registerBundledExamples({ ipcMain, getWindow, directory }) {
  const authorize = (event) => {
    const window = getWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    ) {
      throw new Error('Examples are available only to the host main frame.');
    }
  };
  const catalog = async () =>
    parseExampleCatalog(
      JSON.parse(
        await fs.readFile(path.join(directory, 'config.json'), 'utf8'),
      ),
    );
  ipcMain.handle('bundled-example-catalog', async (event) => {
    authorize(event);
    return catalog();
  });
  ipcMain.handle('bundled-example-read', async (event, resource) => {
    authorize(event);
    if (
      typeof resource !== 'string' ||
      !exampleResourcePaths(await catalog()).has(resource)
    )
      throw new Error('Unknown example resource.');
    const root = await fs.realpath(directory);
    const file = await fs.realpath(path.join(root, resource));
    const relative = path.relative(root, file);
    if (
      relative === '..' ||
      relative.startsWith('..' + path.sep) ||
      path.isAbsolute(relative)
    )
      throw new Error('Invalid example resource location.');
    return new Uint8Array(await fs.readFile(file));
  });
}
