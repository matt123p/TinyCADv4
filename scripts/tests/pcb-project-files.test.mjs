import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { registerProjectFiles } from '../../electron/projectFiles.js';

test('Electron project storage preserves existing files and rejects writes based on a stale revision', async (t) => {
  const parent = path.resolve('.tmp');
  await mkdir(parent, { recursive: true });
  const area = await mkdtemp(path.join(parent, 'project-storage-'));
  t.after(() => rm(area, { recursive: true, force: true }));
  const root = path.join(area, 'Projects');
  await mkdir(root);
  const outside = path.join(area, 'outside.tcproject');
  await writeFile(outside, 'outside');
  await writeFile(path.join(root, 'drawing.dsn'), 'standalone');

  const mainFrame = {};
  const webContents = { mainFrame };
  let handler;
  const trash = [];
  registerProjectFiles({
    ipcMain: {
      handle: (_, callback) => {
        handler = callback;
      },
    },
    getWindow: () => ({ webContents }),
    store: { get: (_, fallback) => fallback },
    documents: root,
    shell: {
      trashItem: async (filename) => {
        trash.push(filename);
      },
    },
  });
  const request = (operation) =>
    handler({ sender: webContents, senderFrame: mainFrame }, operation);
  await assert.rejects(
    request({ operation: 'read', id: outside }),
    /outside the project folder/,
  );
  await assert.rejects(
    handler({ sender: webContents, senderFrame: {} }, { operation: 'root' }),
    /main frame/,
  );
  assert.deepEqual(await request({ operation: 'list', folder: root }), []);

  const file = {
    operation: 'write',
    name: 'Amp.tcproject',
    folder: root,
    data: new Uint8Array([1, 2, 3]),
  };
  const created = await request(file);
  await assert.rejects(request(file), /EEXIST/);
  const update = {
    ...file,
    id: created.id,
    version: created.version,
    data: new Uint8Array([4, 5, 6]),
  };
  const saved = await request(update);
  assert.notEqual(saved.version, created.version);
  await assert.rejects(request(update), /changed on disk/);
  assert.deepEqual(new Uint8Array(await readFile(created.id)), update.data);

  await request({ operation: 'mkdir', folder: root, name: 'Board' });
  const boardFolder = path.join(root, 'Board');
  const moved = await request({
    operation: 'move',
    from: root,
    id: created.id,
    folder: boardFolder,
    name: 'Amp copy.tcproject',
  });
  assert.deepEqual(await request({ operation: 'read', id: moved.id }), {
    data: update.data,
    version: saved.version,
  });
  await request({ operation: 'trash', id: moved.id });
  assert.deepEqual(trash, [moved.id]);
  assert.deepEqual(await request({ operation: 'list', folder: root }), [
    { id: boardFolder, name: 'Board', folder: true },
  ]);
});
