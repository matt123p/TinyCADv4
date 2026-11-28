import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import {
  loadExampleSources,
  resolveExampleFile,
} from '../shared/exampleSources.js';

export async function installProjectExample(sources, groupId, exampleId, chooseParent) {
  const { catalog, resources } = await loadExampleSources(sources);
  const example = catalog.groups.find(({ id }) => id === groupId)
    ?.examples.find(({ id }) => id === exampleId);
  if (!example?.project) throw new Error('Unknown project example.');
  const files = await Promise.all([example.path, ...example.project.files].map(async (resource) => ({
    name: path.basename(resource),
    source: await resolveExampleFile(resources.get(resource)),
  })));
  const parent = await chooseParent();
  if (!parent) return null;

  let destination;
  for (let suffix = 0; ; suffix++) {
    const name = example.project.folder + (suffix ? `.${suffix}` : '');
    destination = path.join(parent, name);
    try {
      await fs.mkdir(destination);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  const copied = [];
  try {
    for (const { name, source } of files) {
      const target = path.join(destination, name);
      await fs.copyFile(source, target, constants.COPYFILE_EXCL);
      copied.push(target);
    }
  } catch (error) {
    await Promise.allSettled(copied.map((file) => fs.unlink(file)));
    await fs.rmdir(destination).catch(() => {});
    throw error;
  }
  return { destination, drawingName: files[0].name };
}

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
