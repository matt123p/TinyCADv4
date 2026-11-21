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

test('opens only a queued desktop project and rejects stale launch tickets', async (t) => {
  const parent = path.resolve('.tmp');
  await mkdir(parent, { recursive: true });
  const area = await mkdtemp(path.join(parent, 'project-launch-'));
  t.after(() => rm(area, { recursive: true, force: true }));
  const documents = path.join(area, 'Documents');
  const external = path.join(area, 'External');
  await mkdir(documents);
  await mkdir(external);
  const marker = path.join(external, 'LED.tcproject');
  const neighbor = path.join(area, 'Private.txt');
  await writeFile(marker, 'settings revision 1');
  await writeFile(neighbor, 'outside');

  const mainFrame = {};
  const webContents = { mainFrame };
  let handler;
  let queued;
  const preferences = new Map();
  registerProjectFiles({
    ipcMain: { handle: (_, callback) => { handler = callback; } },
    getWindow: () => ({ webContents }),
    store: {
      get: (key, fallback) => preferences.get(key) ?? fallback,
      set: (key, value) => preferences.set(key, value),
    },
    documents,
    takeProjectOpen: () => {
      const filename = queued;
      queued = undefined;
      return filename;
    },
  });
  const request = (payload) =>
    handler({ sender: webContents, senderFrame: mainFrame }, payload);

  assert.equal(await request({ operation: 'recent-project-folder' }), null);
  assert.equal(await request({ operation: 'open-launch', path: marker }), null);
  queued = marker;
  const first = await request({ operation: 'open-launch' });
  assert.equal(first.marker.id, marker);
  await assert.rejects(request({ operation: 'read', id: marker }), /outside/);
  await writeFile(marker, 'settings revision 2');
  await assert.rejects(
    request({ operation: 'activate-launch', ticket: first.ticket }),
    /changed/,
  );
  await assert.rejects(request({ operation: 'read', id: marker }), /outside/);
  queued = marker;
  const second = await request({ operation: 'open-launch' });
  assert.deepEqual(await request({ operation: 'activate-launch', ticket: second.ticket }), {
    id: external, name: 'External',
  });
  assert.equal(new TextDecoder().decode((await request({ operation: 'read', id: marker })).data),
    'settings revision 2');
  await assert.rejects(request({ operation: 'read', id: neighbor }), /outside/);
  assert.deepEqual(await request({ operation: 'recent-project-folder' }), {
    id: external, name: 'External',
  });
  await rm(external, { recursive: true });
  assert.equal(await request({ operation: 'recent-project-folder' }), null);
  await assert.rejects(
    request({ operation: 'activate-launch', ticket: second.ticket }),
    /no longer available/,
  );
});
