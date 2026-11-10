import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadComponent } from './load-component.mjs';
import * as validation from '../../shared/bundledLibraries.js';
import { packageLibraries } from '../package-libraries.mjs';
import { registerBundledLibraries } from '../../electron/bundledLibraries.js';

const require = createRequire(import.meta.url);
const model = loadComponent('src/model/tclib.ts', {});
const managerModule = loadComponent('src/io/bundledLibraries.ts', {
  '../model/tclib': model,
  '../../shared/bundledLibraries': validation,
});
const { BundledLibraryManager } = managerModule;
const catalog = {
  version: 1,
  libraries: [
    {
      id: 'passives',
      name: 'Passives',
      path: 'standard/passives.tclib',
    },
    {
      id: 'connectors',
      name: 'Connectors',
      path: 'connectors.tclib',
    },
  ],
};
const library = {
  fileId: 'unused',
  name: 'test',
  modified: null,
  names: [],
  symbols: [],
};

assert.equal(
  validation.parseBundledLibraryCatalog(catalog).libraries.length,
  2,
);
for (const file of [
  '../secret.tclib',
  '/secret.tclib',
  'C:/secret.tclib',
  'a\\secret.tclib',
  'https://host/a.tclib',
  'a%2fb.tclib',
  'a//b.tclib',
  'a/./b.tclib',
  'a.tclib?x',
  'a.json',
]) {
  assert.throws(() =>
    validation.parseBundledLibraryCatalog({
      version: 1,
      libraries: [{ ...catalog.libraries[0], path: file }],
    }),
  );
}
assert.throws(() =>
  validation.parseBundledLibraryCatalog({ version: 2, libraries: [] }),
);
assert.throws(() =>
  validation.parseBundledLibraryCatalog({
    version: 1,
    libraries: [catalog.libraries[0], catalog.libraries[0]],
  }),
);
const loads = [];
let saved = [];
let failWrite = false;
let failLoad = false;
const source = {
  catalog: async () => catalog,
  selection: async () => saved,
  saveSelection: async (ids) => {
    if (failWrite) throw new Error('Storage full');
    saved = ids;
  },
  load: async (entry) => {
    loads.push(entry.id);
    if (failLoad) throw new Error('Broken file');
    return library;
  },
};
const manager = new BundledLibraryManager(source);
await manager.initialize();
assert.deepEqual(
  loads,
  [],
  'reading the catalog must never load unselected files',
);
await manager.select(['passives']);
assert.deepEqual(loads, ['passives']);
assert.deepEqual(saved, ['passives']);
assert.equal(manager.getSnapshot().libraries[0].readOnly, true);
assert.equal(manager.getSnapshot().libraries[0].fileId, 'bundled:passives');
await manager.load('passives');
assert.equal(loads.length, 1, 'an already loaded library is not loaded again');
await manager.select(['connectors']);
assert.deepEqual(manager.getSnapshot().selected, ['connectors']);
assert.deepEqual(
  manager.getSnapshot().libraries.map((lib) => lib.fileId),
  ['bundled:connectors'],
  'switching standard libraries must release the previous library',
);
await manager.select(['passives', 'connectors']);
assert.equal(
  manager.getSnapshot().selected.length,
  1,
  'a selection can contain at most one standard library',
);
assert.equal(manager.getSnapshot().libraries.length, 1);
assert.equal(saved.length, 1, 'only one standard library is persisted');
await manager.select([]);
assert.equal(
  manager.getSnapshot().libraries.length,
  0,
  'deselection releases library data',
);
failWrite = true;
await manager.select(['connectors']);
assert.deepEqual(
  manager.getSnapshot().selected,
  [],
  'storage failure must not change the selection',
);
assert.match(manager.getSnapshot().error, /Storage full/);
failWrite = false;
failLoad = true;
await manager.select(['connectors']);
assert.match(manager.getSnapshot().errors.connectors, /Broken file/);
failLoad = false;
await manager.load('connectors');
assert.equal(manager.getSnapshot().errors.connectors, undefined);
assert.equal(manager.getSnapshot().libraries.length, 1);
saved = ['passives', 'no-longer-in-catalog'];
loads.length = 0;
const restored = new BundledLibraryManager(source);
await restored.initialize();
assert.deepEqual(
  loads,
  ['passives'],
  'restart restores only valid selected libraries',
);
saved = ['passives', 'connectors'];
loads.length = 0;
const restoredMultiple = new BundledLibraryManager(source);
await restoredMultiple.initialize();
assert.deepEqual(
  loads,
  ['passives'],
  'restoring multiple old choices must load only one standard library',
);
assert.deepEqual(
  saved,
  ['passives'],
  'restoring a selection persists only the active library',
);

const pending = [];
const racing = new BundledLibraryManager({
  ...source,
  selection: async () => [],
  load: () => new Promise((resolve) => pending.push(resolve)),
});
await racing.initialize();
const first = racing.select(['passives']);
await new Promise((resolve) => setImmediate(resolve));
await racing.select([]);
const second = racing.select(['passives']);
await new Promise((resolve) => setImmediate(resolve));
pending[0]({ ...library, name: 'stale' });
await first;
assert.equal(
  racing.getSnapshot().libraries.length,
  0,
  'an in-flight deselected load cannot re-add a library',
);
pending[1](library);
await second;
assert.equal(racing.getSnapshot().libraries.length, 1);

const switchedLoads = new Map();
const switching = new BundledLibraryManager({
  ...source,
  selection: async () => [],
  load: (entry) =>
    new Promise((resolve) => switchedLoads.set(entry.id, resolve)),
});
await switching.initialize();
const oldLoad = switching.select(['passives']);
await new Promise((resolve) => setImmediate(resolve));
const newLoad = switching.select(['connectors']);
await new Promise((resolve) => setImmediate(resolve));
switchedLoads.get('passives')(library);
await oldLoad;
assert.equal(
  switching.getSnapshot().libraries.length,
  0,
  'the previous library cannot reappear after switching',
);
switchedLoads.get('connectors')(library);
await newLoad;
assert.deepEqual(
  switching.getSnapshot().libraries.map((lib) => lib.fileId),
  ['bundled:connectors'],
);

let catalogAttempts = 0;
const recovery = new BundledLibraryManager({
  ...source,
  selection: async () => [],
  catalog: async () => {
    if (++catalogAttempts === 1) throw new Error('Unavailable catalog');
    return catalog;
  },
});
await recovery.initialize();
assert.match(recovery.getSnapshot().error, /Unavailable/);
await recovery.initialize();
assert.ok(recovery.getSnapshot().catalog, 'catalog failures can be retried');

// Exercise the real SQLite parser/serializer without importing browser startup.
const initSqlJs = require('sql.js');
const wasmBinary = await readFile(
  new URL('../../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url),
);
const sqlite = loadComponent('src/io/tclib.ts', {
  'sql.js/dist/sql-wasm.js': (options) => initSqlJs({ ...options, wasmBinary }),
  'url:sql.js/dist/sql-wasm.wasm': '',
  '../model/tclib': model,
});
const bytes = await sqlite.saveTcLibrary({
  ...library,
  names: [
    {
      NameID: 1,
      Name: 'Test resistor',
      SymbolID: 1,
      Reference: 'R',
      ppp: 1,
      Description: 'Test symbol',
      ShowName: 0,
      ShowRef: 0,
      Attributes: [],
    },
  ],
  symbols: [
    {
      SymbolId: 1,
      Data: '<TinyCADSheets><TinyCAD><RECTANGLE a="0,0" b="40,20"/></TinyCAD></TinyCADSheets>',
    },
  ],
});
const decoded = await sqlite.loadTcLibrary(
  'bundled:passives',
  'Passives',
  null,
  bytes,
);
assert.equal(decoded.names[0].Name, 'Test resistor');
await assert.rejects(
  () => sqlite.saveTcLibrary({ ...decoded, readOnly: true }),
  /read-only/,
);

// Personal-library refreshes preserve bundled data; bundled updates can remove it.
const actionModules = {};
for (const name of [
  'docActions',
  'menuActions',
  'dialogActions',
  'libraryActions',
  'findActions',
  'userLogin',
  'viewActions',
  'configActions',
]) {
  actionModules['../actions/' + name] = loadComponent(
    'src/state/actions/' + name + '.ts',
    {},
  );
}
const { LibraryActionTypes } = actionModules['../actions/libraryActions'];
const { AltStoreReducer } = loadComponent(
  'src/state/stores/altStoreReducer.ts',
  {
    ...actionModules,
    'immutability-helper': require('immutability-helper'),
    '../dispatcher/AppDispatcher': {
      Panels: { LibrariesPanel: 'libraries' },
      BottomPanels: { StylePanel: 'style' },
    },
  },
);
let state = AltStoreReducer(undefined, { type: 'init' });
const navigation = AltStoreReducer(
  { ...state, viewLibrary: library },
  {
    type: LibraryActionTypes.ShowStandardLibrary,
    libraryId: 'spice',
  },
);
assert.equal(navigation.viewLibrary, null);
assert.equal(navigation.panel, 'libraries');
assert.equal(navigation.standardLibraryNavigation.libraryId, 'spice');
assert.equal(
  AltStoreReducer(navigation, {
    type: LibraryActionTypes.ShowStandardLibrary,
    libraryId: 'spice',
  }).standardLibraryNavigation.request,
  navigation.standardLibraryNavigation.request + 1,
  'More can reopen the panel repeatedly',
);
const bundled = { ...decoded, readOnly: true };
state = AltStoreReducer(state, {
  type: LibraryActionTypes.SetBundledLibraries,
  libraries: [bundled],
});
state = AltStoreReducer(state, {
  type: LibraryActionTypes.SetLibraryList,
  libraries: [library],
});
assert.deepEqual(state.libraries, [library, bundled]);
assert.equal(
  AltStoreReducer(state, {
    type: LibraryActionTypes.EditLibrary,
    lib: bundled,
  }),
  state,
  'read-only library cannot enter editing mode',
);
state = AltStoreReducer(state, {
  type: LibraryActionTypes.SetBundledLibraries,
  libraries: [],
});
assert.deepEqual(state.libraries, [library]);

for (const name of ['appActions', 'symbolActions', 'menuText']) {
  actionModules['../actions/' + name] = loadComponent(
    'src/state/actions/' + name + '.ts',
    {},
  );
}
const { DocStoreReducer } = loadComponent(
  'src/state/stores/docStoreReducer.ts',
  {
    ...actionModules,
    'immutability-helper': require('immutability-helper'),
    '../../io/ioXml': { blank: () => ({ sheets: [] }) },
    '../../manipulators/updateView': { updateView: class {} },
    '../../manipulators/updateDrawing': { updateDrawing: class {} },
  },
);
const documentState = {
  drawing: { sheets: [{}] },
  view: { selected_sheet: 0, _selected_array: [] },
};
assert.equal(
  DocStoreReducer(documentState, {
    type: LibraryActionTypes.EditLibrary,
    lib: bundled,
  }),
  documentState,
  'read-only library must not replace the active document',
);
const Dialogue = loadComponent('src/components/dialogues/Dialogue.tsx', {})
  .default.type;
assert.equal(
  Dialogue({
    show_dialogue: 'library_info',
    dialogue_props: {
      name: 'Passives',
      path: 'bundled:passives',
      readOnly: true,
    },
  }).props.readOnly,
  true,
  'dialog renderer must preserve the read-only flag',
);

const temporary = await mkdtemp(path.join(tmpdir(), 'tinycad-libraries-'));
try {
  const sourceDirectory = path.join(temporary, 'source');
  const destination = path.join(temporary, 'dist');
  await mkdir(path.join(sourceDirectory, 'standard'), { recursive: true });
  await writeFile(
    path.join(sourceDirectory, 'config.json'),
    JSON.stringify(catalog),
  );
  await writeFile(
    path.join(sourceDirectory, 'standard/passives.tclib'),
    new Uint8Array(bytes),
  );
  await writeFile(
    path.join(sourceDirectory, 'connectors.tclib'),
    new Uint8Array(bytes),
  );
  await writeFile(path.join(sourceDirectory, 'not-configured.tclib'), 'unused');
  await packageLibraries(sourceDirectory, destination);
  assert.equal(
    (await readFile(path.join(destination, 'standard/passives.tclib'))).length,
    bytes.byteLength,
  );
  await assert.rejects(
    () => readFile(path.join(destination, 'not-configured.tclib')),
    /ENOENT/,
  );

  const handlers = new Map();
  const window = { webContents: { mainFrame: {} } };
  const settings = new Map();
  registerBundledLibraries({
    ipcMain: { handle: (key, handler) => handlers.set(key, handler) },
    getWindow: () => window,
    directory: destination,
    store: {
      get: (key, fallback) => settings.get(key) || fallback,
      set: (key, value) => settings.set(key, value),
    },
  });
  const event = {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  };
  assert.equal(
    (await handlers.get('bundled-library-catalog')(event)).libraries.length,
    2,
  );
  assert.equal(
    (await handlers.get('bundled-library-read')(event, 'passives')).length,
    bytes.byteLength,
  );
  await assert.rejects(
    () => handlers.get('bundled-library-read')(event, '../config.json'),
    /Unknown/,
  );
  await assert.rejects(
    () =>
      handlers.get('bundled-library-read')(
        { ...event, senderFrame: {} },
        'passives',
      ),
    /host main frame/,
  );
  await handlers.get('bundled-library-selection')(event, ['passives']);
  await assert.rejects(
    () =>
      handlers.get('bundled-library-selection')(event, [
        'passives',
        'connectors',
      ]),
    /one standard library/,
  );
  assert.deepEqual(await handlers.get('bundled-library-selection')(event), [
    'passives',
  ]);
  await rm(path.join(sourceDirectory, 'connectors.tclib'));
  await assert.rejects(
    () => packageLibraries(sourceDirectory, destination),
    /ENOENT/,
  );
  if (process.platform !== 'win32') {
    const outside = path.join(temporary, 'outside.tclib');
    await writeFile(outside, 'outside');
    await symlink(outside, path.join(sourceDirectory, 'connectors.tclib'));
    await assert.rejects(
      () => packageLibraries(sourceDirectory, destination),
      /outside/,
    );
    await rm(path.join(destination, 'connectors.tclib'));
    await symlink(outside, path.join(destination, 'connectors.tclib'));
    await assert.rejects(
      () => handlers.get('bundled-library-read')(event, 'connectors'),
      /Invalid/,
    );
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log(
  'Library checks passed: catalog, packaging, flat SQLite libraries, lazy loading, selection persistence, unloading, retries, read-only guards, and desktop IPC.',
);
