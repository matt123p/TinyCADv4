import fs from 'node:fs/promises';
import {
  loadExampleSources,
  resolveExampleFile,
} from '../shared/exampleSources.js';

export function registerBundledExamples({ ipcMain, getWindow, sources }) {
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
  ipcMain.handle('bundled-example-catalog', async (event) => {
    authorize(event);
    return (await loadExampleSources(sources)).catalog;
  });
  ipcMain.handle('bundled-example-read', async (event, resource) => {
    authorize(event);
    if (typeof resource !== 'string')
      throw new Error('Unknown example resource.');
    const source = (await loadExampleSources(sources)).resources.get(resource);
    if (!source) throw new Error('Unknown example resource.');
    const file = await resolveExampleFile(source);
    return new Uint8Array(await fs.readFile(file));
  });
}
