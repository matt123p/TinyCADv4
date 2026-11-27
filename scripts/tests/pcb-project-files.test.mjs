import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { recentProjectFolders, registerProjectFiles } from '../../electron/projectFiles.js';

test('remembers export destinations per drawing and format in the project settings', async (t) => {
  const parent = path.resolve('.tmp');
  await mkdir(parent, { recursive: true });
  const area = await mkdtemp(path.join(parent, 'design-exports-'));
  t.after(() => rm(area, { recursive: true, force: true }));
  const folder = path.join(area, 'Project');
  const other = path.join(folder, 'Other');
  await mkdir(other, { recursive: true });
  const marker = path.join(folder, 'Settings.tcproject');
  const originalSettings = '<?xml version="1.0"?><TinyCADProject><Name>Test</Name></TinyCADProject>';
  await writeFile(marker, originalSettings);
  const drawingId = path.join(folder, 'Circuit.dsn');
  const secondId = path.join(other, 'Circuit.dsn');
  await Promise.all([drawingId, secondId].map((id) => writeFile(id, 'drawing')));
  const preferences = new Map();
  const mainFrame = {};
  const webContents = { mainFrame };
  let selection;
  let dialogues = [];
  const register = async (localPreferences = preferences) => {
    let handle;
    registerProjectFiles({
      ipcMain: { handle: (_, callback) => { handle = callback; } },
      getWindow: () => ({ webContents }),
      dialog: {
        showOpenDialog: async () => ({ canceled: false, filePaths: [folder] }),
        showSaveDialog: async (_, options) => {
          dialogues.push(options);
          return selection ? { canceled: false, filePath: selection } : { canceled: true };
        },
      },
      store: {
        get: (key, fallback) => localPreferences.get(key) ?? fallback,
        set: (key, value) => localPreferences.set(key, value),
      },
      documents: area,
    });
    const request = (payload) => handle({ sender: webContents, senderFrame: mainFrame }, payload);
    await request({ operation: 'choose-project-folder' });
    return request;
  };
  const first = { project: folder, drawingId, name: 'Circuit.dsn', draftId: 'draft-one' };
  const second = { ...first, drawingId: secondId, draftId: 'draft-two' };
  const bom = path.join(folder, 'Components.csv');
  const netlist = path.join(area, 'Board.net');
  const vhdl = path.join(other, 'Circuit.vhdl');
  function save(request, source, format, text, saveAs = true) {
    return request({ operation: 'save-design-export', ...source, format, text, saveAs });
  }
  const location = (request, source, format) => request({ operation: 'export-destination', ...source, format });
  async function readSettings() {
    const contents = await readFile(marker, 'utf8');
    assert.ok(contents.startsWith(originalSettings));
    return JSON.parse(contents.match(/<\?tinycad-exports\s+([\s\S]*?)\?>/)[1]);
  }
  let request = await register();
  selection = bom;
  assert.equal(await save(request, first, 'bom', 'parts'), true);
  assert.equal(await location(request, second, 'bom'), null);
  selection = netlist;
  await save(request, first, 'PADS-PCB', 'nets');
  selection = vhdl;
  await save(request, second, 'VHDL', 'hdl');
  assert.equal(await location(request, first, 'VHDL'), null);
  assert.deepEqual((await readSettings()).drawings, {
    'Circuit.dsn': { bom: 'Components.csv', 'PADS-PCB': netlist },
    'Other/Circuit.dsn': { VHDL: 'Other/Circuit.vhdl' },
  });

  request = await register();
  dialogues = [];
  selection = undefined;
  assert.equal(await save(request, first, 'bom', 'updated', false), true);
  assert.equal(dialogues.length, 0);
  assert.equal(await readFile(bom, 'utf8'), 'updated');
  assert.equal(await location(request, { ...first, project: undefined }, 'bom'), bom);
  assert.equal(await save(request, first, 'PADS-PCB', 'cancelled'), false);
  assert.equal(dialogues.at(-1).defaultPath, netlist);
  assert.equal(await readFile(netlist, 'utf8'), 'nets');

  const imported = await register(new Map());
  assert.equal(await save(imported, first, 'bom', 'not authorized', false), false);
  assert.equal(dialogues.at(-1).defaultPath, bom);
  assert.equal(await readFile(bom, 'utf8'), 'updated');

  const draft = { project: folder, name: 'New.dsn', draftId: 'draft-three' };
  const draftNetlist = path.join(other, 'Custom.net');
  selection = draftNetlist;
  await save(request, draft, 'PADS-PCB', 'draft nets');
  assert.deepEqual(Object.values((await readSettings()).drafts), [
    { name: draft.name, outputs: { 'PADS-PCB': 'Other/Custom.net' } },
  ]);
  request = await register(new Map());
  assert.equal(await location(request, draft, 'PADS-PCB'), draftNetlist);
  assert.equal(await location(request, { ...draft, draftId: 'unrelated' }, 'PADS-PCB'), null);
  const saved = { ...draft, name: 'Renamed.dsn', drawingId: path.join(other, 'Renamed.dsn') };
  await writeFile(saved.drawingId, 'drawing');
  await request({ operation: 'bind-design-exports', ...saved });
  const settings = await readSettings();
  assert.equal(settings.drafts, undefined);
  assert.deepEqual(settings.drawings['Other/Renamed.dsn'], {
    'PADS-PCB': 'Other/Custom.net',
  });
  assert.equal(await location(await register(new Map()), saved, 'PADS-PCB'), draftNetlist);
});

test('reopens recent project folders in order without granting access to arbitrary folders', async (t) => {
  const parent = path.resolve('.tmp');
  await mkdir(parent, { recursive: true });
  const area = await mkdtemp(path.join(parent, 'project-recent-'));
  t.after(() => rm(area, { recursive: true, force: true }));
  const documents = path.join(area, 'Documents');
  const first = path.join(area, 'First');
  const second = path.join(area, 'Second');
  await Promise.all([documents, first, second].map((folder) => mkdir(folder)));
  const preferences = new Map([['recentProjectFolder', first]]);
  const store = {
    get: (key, fallback) => preferences.get(key) ?? fallback,
    set: (key, value) => preferences.set(key, value),
  };
  const mainFrame = {};
  const webContents = { mainFrame };
  let handler;
  registerProjectFiles({
    ipcMain: { handle: (_, callback) => { handler = callback; } },
    getWindow: () => ({ webContents }),
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [second] }) },
    store,
    documents,
  });
  const request = (payload) => handler({ sender: webContents, senderFrame: mainFrame }, payload);

  assert.deepEqual(recentProjectFolders(store), [first]);
  await request({ operation: 'choose-project-folder' });
  assert.deepEqual(recentProjectFolders(store), [second, first]);
  await assert.rejects(request({ operation: 'open-recent-project-folder', id: area }), /unavailable/);
  assert.deepEqual(await request({ operation: 'open-recent-project-folder', id: first }), {
    id: first, name: 'First',
  });
  assert.deepEqual(recentProjectFolders(store), [first, second]);
  await rm(first, { recursive: true });
  await assert.rejects(request({ operation: 'open-recent-project-folder', id: first }), /Cannot open project folder/);
  assert.deepEqual(await request({ operation: 'recent-project-folder' }), {
    id: second, name: 'Second',
  });
});

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

test('creates unique empty entries and confirms permanent deletion only after the system trash fails', async (t) => {
  const area = await mkdtemp(path.resolve('.tmp/project-entry-'));
  t.after(() => rm(area, { recursive: true, force: true }));
  const root = path.join(area, 'Project');
  await mkdir(root);
  const frame = {};
  const webContents = { mainFrame: frame };
  let reply = 0;
  let handler;
  const prompts = [];
  registerProjectFiles({
    ipcMain: { handle: (_, callback) => { handler = callback; } },
    getWindow: () => ({ webContents }),
    documents: root,
    store: { get: (_, fallback) => fallback },
    shell: { trashItem: async () => { throw new Error('Trash unavailable'); } },
    dialog: { showMessageBox: async (_, options) => { prompts.push(options); return { response: reply }; } },
  });
  const request = (payload) => handler({ sender: webContents, senderFrame: frame }, payload);
  const create = () => request({ operation: 'create-entry', folder: root, directory: false, extension: '.tclib' });
  const [first, second] = await Promise.all([create(), create()]);
  assert.deepEqual([first.name, second.name].sort(), ['New File 2.tclib', 'New File.tclib']);
  assert.equal((await readFile(first.id)).byteLength, 0);
  await assert.rejects(request({ operation: 'reveal', id: area, directory: true }), /outside/);
  assert.equal(await request({ operation: 'trash', id: first.id, directory: false }), false);
  assert.equal((await readFile(first.id)).byteLength, 0);
  assert.equal(prompts[0].defaultId, 0);
  reply = 1;
  assert.equal(await request({ operation: 'trash', id: first.id, directory: false }), true);
  await assert.rejects(readFile(first.id), { code: 'ENOENT' });
});
