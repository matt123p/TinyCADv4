import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const temporary = await mkdtemp(path.join(root, '.plugin-tests-'));
try {
  const outfile = path.join(temporary, 'tests.cjs');
  await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import { ActionCreators } from 'redux-undo';
import { readFile, mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import catalog from './tinycad-plugins.json';
import bundled from './src/plugins/bundledData.json';
import { parseCatalog, parseManifest, path, evaluate, canonicalRepository } from './src/plugins/validation';
import { unpackPlugin } from './src/plugins/archive';
import { verifyPackage, GitHubPluginSource, githubPlugins } from './src/plugins/github';
import { pluginStorage } from './src/plugins/storage';
import { PluginManager } from './src/plugins/manager';
import { DevelopmentPluginSource, developmentURL } from './src/plugins/development';
import { createPluginDevelopmentServer } from './scripts/plugin-development-server.mjs';
import { blank, ioXML } from './src/io/ioXml';
import { XMLBuilder } from './src/util/xmlbuilder';
import { ensureDrawingIds, newIdentity } from './src/plugins/persistence';
import { loadTcLibrary, saveTcLibrary } from './src/io/tclib';
import { exportedCoreCommand, prepareEdits } from './src/plugins/edits';
import { PLUGIN_EDIT, RESTORE_SESSION } from './src/plugins/actions';
import { DocStoreWithHistory } from './src/state/undo/undo';
import { AltStoreReducer } from './src/state/stores/altStoreReducer';
import { documentSessions, restoreSessionState, sessionMiddleware } from './src/plugins/sessions';
import { actionSetDocument } from './src/state/dispatcher/AppDispatcher';

async function run() {
  const values = new Map();
  globalThis.window = { electronAPI: undefined, addEventListener() {} };
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const packages = new Map(); const settings = new Map();
  pluginStorage.setPackage = async pkg => { packages.set(pkg.digest, structuredClone(pkg)); };
  pluginStorage.getPackage = async digest => packages.get(digest);
  pluginStorage.getSettings = async id => settings.get(id) || {};
  pluginStorage.setSettings = async (id, value) => { settings.set(id, value); };
  const parsed = parseCatalog(catalog); assert.equal(parsed.plugins.length, 2);
  const metadata = bundled[0]; const manifest = parseManifest(JSON.parse(metadata.files['tinycad-plugin.json']), parsed.plugins[0]);
  for (const invalid of ['../secret', '/secret', 'a/../b', 'a\\\\b', 'a%2fb', 'a//b', 'a?query']) assert.throws(() => path(invalid));
  assert.equal(canonicalRepository('https://github.com/Owner/Repo.git').slug, 'owner/repo');
  assert.throws(() => canonicalRepository('https://github.com/owner/repo/tree/main'));
  assert.throws(() => canonicalRepository('https://user:password@github.com/owner/repo'));
  assert.equal(evaluate("editorKind == 'schematic' && (hasSelection || platform == 'electron')", { editorKind: 'schematic', hasSelection: false, platform: 'electron' }), true);
  assert.equal(evaluate("hasSelection && documentWritable", { hasSelection: false, documentWritable: true }), false);
  for (const expression of ['globalThis.alert(1)', 'constructor', 'hasSelection; true', 'platform ==']) assert.throws(() => evaluate(expression, {}));
  assert.throws(() => parseManifest({ ...manifest, permissions: ['filesystem.anything'] }));
  assert.throws(() => parseManifest({ ...manifest, readme: 'not-markdown.html' }));
  assert.throws(() => parseManifest({ ...manifest, contributes: { panels: [{ id: 'other.plugin.panel', title: 'Test', surface: 'test', location: 'left' }] } }));

  const source = { repository: { id: 12, url: 'https://github.com/test/plugins', slug: 'test/plugins', defaultBranch: 'main' }, entry: parsed.plugins[0], commit: 'a'.repeat(40), catalogDigest: 'b'.repeat(64) };
  const files = Object.fromEntries(Object.entries(metadata.files).map(([name, content]) => [name, new TextEncoder().encode(content)]));
  const pkg = await verifyPackage(files, source);
  const unpacked = unpackPlugin(zipSync(files)); assert.deepEqual(Object.keys(unpacked).sort(), Object.keys(files).sort());
  assert.throws(() => unpackPlugin(zipSync({ '../escape': new Uint8Array([1]) })));
  const linkZip = zipSync({ 'link': new Uint8Array([1]) });
  for (let i = 0; i < linkZip.length - 46; i++) if (new DataView(linkZip.buffer).getUint32(i, true) === 0x02014b50) new DataView(linkZip.buffer).setUint32(i + 38, 0xa1ff0000, true);
  assert.throws(() => unpackPlugin(linkZip), /symlink/);
  await assert.rejects(() => verifyPackage({ ...files, 'evil.js': new Uint8Array([1]) }, source), /Undeclared/);
  await assert.rejects(() => verifyPackage({ ...files, 'README.md': undefined }, source));

  const xml = new ioXML(); let drawing = blank();
  drawing.pluginData = { 'net.tinycad.inspector': { schema: 1, encoding: 'json', payload: JSON.stringify({ notes: '<safe> & data' }) }, 'future.plugin': { schema: 99, encoding: 'future', payload: 'opaque payload' } };
  drawing.pluginDataXml = ['<PLUGIN_DATA format="7"><FUTURE keep="yes"/></PLUGIN_DATA>'];
  drawing.sheets[0].pluginData = { 'sheet.plugin': { schema: 5, encoding: 'json', payload: '{"retained":true}' } };
  drawing.sheets[0].items = [{ NodeName: 'wire', _id: 90001, persistentId: newIdentity(), d_points: [[0,0],[10,0]], _magnetic: null, pluginData: { 'item.plugin': { schema: 1, encoding: 'json', payload: '{"value":3}' } } }];
  const input = new XMLBuilder(); input.fromText(xml.to_dsn(drawing, true, true).tostring()); const loaded = xml.from_dsn(input);
  assert.equal(loaded.persistentId, drawing.persistentId); assert.equal(loaded.sheets[0].persistentId, drawing.sheets[0].persistentId);
  assert.deepEqual({ ...loaded.pluginData }, drawing.pluginData); assert.deepEqual({ ...loaded.sheets[0].pluginData }, drawing.sheets[0].pluginData);
  assert.equal(loaded.sheets[0].items[0].persistentId, drawing.sheets[0].items[0].persistentId);
  assert.deepEqual({ ...loaded.sheets[0].items[0].pluginData }, drawing.sheets[0].items[0].pluginData);
  assert.match(xml.to_dsn(loaded, true, true).tostring(), /FUTURE keep="yes"/);
  const futureXml = new XMLBuilder(); futureXml.fromText('<TinyCADSheets><PLUGIN_DATA format="1"><PLUGIN id="future.plugin" schema="99" encoding="xml" future="preserve"><NESTED value="kept"/></PLUGIN></PLUGIN_DATA><TinyCAD/></TinyCADSheets>');
  const futureDocument = xml.from_dsn(futureXml); const savedFuture = xml.to_dsn(futureDocument, true, true).tostring();
  assert.match(savedFuture, /future="preserve"/); assert.match(savedFuture, /NESTED value="kept"/);
  const duplicate = ensureDrawingIds({ ...loaded, sheets: [{ ...loaded.sheets[0], items: [loaded.sheets[0].items[0], { ...loaded.sheets[0].items[0], _id: 90002 }] }] });
  assert.notEqual(duplicate.sheets[0].items[0].persistentId, duplicate.sheets[0].items[1].persistentId);
  const definition = { id: 1, uid: 'shared-definition', outlines: [{ items: [] }] };
  const symbolsDocument = ensureDrawingIds({ ...blank(), sheets: [{ ...blank().sheets[0], symbols: { 1: definition }, items: [{ NodeName: 'symbol', _id: 80001, _symbol: definition }] }] });
  assert.equal(symbolsDocument.sheets[0].symbols[1], symbolsDocument.sheets[0].items[0]._symbol, 'dictionary and placements share one persistent definition');
  const secondPlacement = ensureDrawingIds({ ...symbolsDocument, sheets: [{ ...symbolsDocument.sheets[0], items: [...symbolsDocument.sheets[0].items, { NodeName: 'symbol', _id: 80002, _symbol: symbolsDocument.sheets[0].symbols[1] }] }] });
  assert.equal(secondPlacement.sheets[0].items[0]._symbol.persistentId, secondPlacement.sheets[0].items[1]._symbol.persistentId, 'additional placements retain definition identity');
  const library = { name: 'Example', fileId: 'example', modified: '', persistentId: newIdentity(), pluginData: drawing.pluginData, pluginDataXml: drawing.pluginDataXml,
    names: [{ persistentId: newIdentity(), NameID: 1, Name: 'Example', SymbolID: 1, Reference: 'U?', ppp: 1, Description: '', ShowName: 0, ShowRef: 0, Attributes: [], pluginData: drawing.pluginData }],
    symbols: [{ persistentId: newIdentity(), SymbolId: 1, Data: xml.to_dsn(drawing, false, false).tostring(), pluginData: drawing.pluginData }],
    pluginRows: [{ scope: 'future', target: 'unknown', data: 'opaque row' }] };
  const libraryBytes = await saveTcLibrary(library); const restoredLibrary = await loadTcLibrary('example', 'Example', '', libraryBytes);
  assert.equal(restoredLibrary.persistentId, library.persistentId); assert.deepEqual(restoredLibrary.pluginData, library.pluginData);
  assert.equal(restoredLibrary.names[0].persistentId, library.names[0].persistentId); assert.deepEqual(restoredLibrary.names[0].pluginData, library.names[0].pluginData);
  assert.deepEqual(restoredLibrary.symbols[0].pluginData, library.symbols[0].pluginData); assert.deepEqual(restoredLibrary.pluginRows, library.pluginRows);

  const record = { id: manifest.id, current: { manifest, source, digest: pkg.digest, fileHashes: pkg.fileHashes, installedAt: '' }, grants: manifest.permissions, enabled: true, policy: 'manual', channel: 'stable', history: [], rejected: [], revision: 1 };
  const result = prepareEdits(record, { drawing: loaded, library: null, symbol: null }, [{ type: 'setExtensionData', scope: 'document', schema: 1, data: { notes: 'changed' } }]);
  const definitionEdit = prepareEdits(record, { drawing: secondPlacement, library: null, symbol: null }, [{ type: 'setExtensionData', scope: 'symbolDefinition', targetId: secondPlacement.sheets[0].symbols[1].persistentId, schema: 1, data: { model: 'test' } }]);
  assert.equal(definitionEdit.drawing.sheets[0].symbols[1], definitionEdit.drawing.sheets[0].items[0]._symbol, 'definition metadata edits update the dictionary and every placement');
  assert.equal(JSON.parse(definitionEdit.drawing.sheets[0].items[1]._symbol.pluginData[record.id].payload).model, 'test');
  assert.equal(JSON.parse(result.drawing.pluginData[manifest.id].payload).notes, 'changed'); assert.notEqual(result.drawing, loaded);
  assert.equal(JSON.parse(loaded.pluginData[manifest.id].payload).notes, '<safe> & data');
  assert.throws(() => prepareEdits({ ...record, grants: [] }, { drawing: loaded, library: null, symbol: null }, [{ type: 'setExtensionData', data: {} }]), /permission/);
  assert.throws(() => prepareEdits(record, { drawing: loaded, library: null, symbol: null }, [{ type: 'delete', id: loaded.sheets[0].items[0].persistentId }]), /permission/);
  const writable = { ...record, grants: [...record.grants, 'document.write'] };
  assert.throws(() => exportedCoreCommand(record, 'core.file.save', false), /files.write/);
  assert.throws(() => exportedCoreCommand(writable, 'core.edit.undo', true), /symbols.write/);
  assert.equal(exportedCoreCommand(writable, 'core.edit.undo', false), 'edit-undo');
  assert.equal(exportedCoreCommand({ ...record, grants: ['symbols.write'] }, 'core.edit.undo', true), 'edit-undo');
  assert.throws(() => exportedCoreCommand(writable, 'core.internal.dispatch', false), /not exported/);
  const secondSheet = { ...loaded.sheets[0], persistentId: newIdentity(), name: 'Second', items: [], symbols: {} };
  const multiSheet = { ...loaded, sheets: [loaded.sheets[0], secondSheet] };
  const placedOnActive = prepareEdits(writable, { drawing: multiSheet, library: null, symbol: null, activeSheetId: secondSheet.persistentId }, [{ type: 'insertWire', a: [100, 100], b: [120, 100] }]);
  assert.equal(placedOnActive.drawing.sheets[0].items.length, loaded.sheets[0].items.length);
  assert.equal(placedOnActive.drawing.sheets[1].items.length, 1, 'commands without an explicit sheet target use the active sheet');
  assert.throws(() => prepareEdits(writable, { drawing: loaded, library: null, symbol: null }, [{ type: 'move', id: loaded.sheets[0].items[0].persistentId, delta: [10, 0] }, { type: 'delete', id: 'missing' }]), /unavailable/);
  assert.deepEqual(loaded.sheets[0].items[0].d_points, [[0,0],[10,0]], 'rejected transaction cannot mutate source');

  const baseReducer = combineReducers({ docStore: DocStoreWithHistory, altStore: AltStoreReducer });
  const store = createStore((state, action) => action.type === RESTORE_SESSION ? restoreSessionState(state, action.snapshot) : baseReducer(state, action), applyMiddleware(sessionMiddleware));
  documentSessions.attach(store); const first = documentSessions.activeId;
  store.dispatch(actionSetDocument(loaded, 'First.dsn', null, null)); store.dispatch(ActionCreators.clearHistory()); const firstDocument = documentSessions.activeId;
  store.dispatch({ type: PLUGIN_EDIT, drawing: result.drawing, expectedVersion: store.getState().docStore.present.drawingVersion });
  assert.ok(store.getState().docStore.past.length); store.dispatch(ActionCreators.undo());
  assert.equal(JSON.parse(store.getState().docStore.present.drawing.pluginData[manifest.id].payload).notes, '<safe> & data');
  store.dispatch(ActionCreators.redo()); assert.equal(JSON.parse(store.getState().docStore.present.drawing.pluginData[manifest.id].payload).notes, 'changed');
  store.dispatch(actionSetDocument(blank(), 'Second.dsn', null, null)); store.dispatch(ActionCreators.clearHistory()); const secondDocument = documentSessions.activeId;
  assert.notEqual(firstDocument, secondDocument); assert.equal(store.getState().docStore.past.length, 0);
  documentSessions.activate(firstDocument); assert.equal(store.getState().altStore.file.name, 'First.dsn'); assert.ok(store.getState().docStore.past.length);
  documentSessions.activate(secondDocument); assert.equal(store.getState().altStore.file.name, 'Second.dsn'); assert.equal(store.getState().docStore.past.length, 0);

  const manager = new PluginManager(); manager.attach({ context: () => ({ platform: 'browser', editorKind: 'schematic' }), safeToUpdate: () => true, subscribe: () => () => {}, invoke: async () => undefined });
  manager.controller = async () => ({ call: async () => undefined, dispose() {} });
  await manager.install(pkg, manifest.permissions, false); assert.equal(manager.installed.length, 1);
  const version2Manifest = { ...manifest, version: '1.1.0' }; const source2 = { ...source, entry: { ...source.entry, version: '1.1.0' } };
  const package2 = await verifyPackage({ ...files, 'tinycad-plugin.json': new TextEncoder().encode(JSON.stringify(version2Manifest)) }, source2);
  await manager.install(package2, manifest.permissions, false); assert.equal(manager.record(manifest.id).history[0].digest, pkg.digest);
  await manager.rollback(manifest.id, pkg.digest); assert.equal(manager.record(manifest.id).current.manifest.version, '1.0.0'); assert.equal(manager.record(manifest.id).policy, 'pinned');
  await assert.rejects(() => manager.install({ ...pkg, digest: 'f'.repeat(64) }, manifest.permissions), /without changing the plugin version/);
  manager.controller = async () => { throw new Error('activation failed'); };
  await assert.rejects(() => manager.install(package2, manifest.permissions, false), /activation failed/);
  assert.equal(manager.record(manifest.id).current.digest, pkg.digest); assert.ok(manager.record(manifest.id).rejected.includes(package2.digest));
  await assert.rejects(() => manager.install({ ...package2, source: { ...source2, repository: { ...source.repository, id: 999 } } }, manifest.permissions), /repository/);
  const corrupt = structuredClone(pkg); corrupt.files['ui.js'][0] ^= 1; packages.set(pkg.digest, corrupt); manager.packages.clear();
  await assert.rejects(() => manager.package(manifest.id), /corrupt/);

  const github = new GitHubPluginSource(); github.repository = async () => source.repository; github.commit = async () => source.commit;
  github.releases = async () => [{ id: 1, tag_name: 'release-one', prerelease: false, assets: [] }];
  github.sourceFile = async () => { throw new Error('missing catalog'); };
  await assert.rejects(() => github.versions(source.repository.url), /published releases/);
  github.sourceFile = async () => new TextEncoder().encode(JSON.stringify(catalog));
  const discovered = await github.versions(source.repository.url); assert.equal(discovered.length, 2); assert.ok(discovered.every(v => v.release.id === 1));
  const sourceReader = new GitHubPluginSource();
  sourceReader.json = async endpoint => endpoint.includes('/git/commits/') ? { tree: { sha: 'c'.repeat(40) } } : endpoint.includes('/git/trees/') ? { tree: [{ path: 'controller.js', type: 'blob', mode: '120000', size: 3, sha: 'd'.repeat(40) }] } : { encoding: 'base64', content: 'YWJj' };
  await assert.rejects(() => sourceReader.sourceFile(source.repository, source.commit, 'controller.js'), /symlink/);
  sourceReader.json = async endpoint => endpoint.includes('/git/commits/') ? { tree: { sha: 'c'.repeat(40) } } : endpoint.includes('/git/trees/') ? { tree: [{ path: 'controller.js', type: 'blob', mode: '100644', size: 3, sha: 'd'.repeat(40) }] } : { encoding: 'base64', content: 'YWJj' };
  assert.equal(new TextDecoder().decode(await sourceReader.sourceFile(source.repository, source.commit, 'controller.js')), 'abc');
  const development = new DevelopmentPluginSource();
  for (const input of ['file:///tmp/plugin', 'https://github.com/test/repo', 'http://user:pass@localhost/', 'http://localhost/?token=secret', 'http://localhost/#fragment']) assert.throws(() => developmentURL(input));
  const localFiles = new Map(Object.entries(files).map(([name, bytes]) => [name, bytes.slice()]));
  const folderFiles = () => [...localFiles].map(([name]) => ({ webkitRelativePath: 'my-plugin/' + name, get size() { return localFiles.get(name).length; }, arrayBuffer: async () => localFiles.get(name).slice().buffer }));
  const [localVersion] = await development.directory(folderFiles());
  const local1 = await development.load(localVersion); assert.equal(local1.manifest.id, manifest.id); assert.equal(local1.source.development.kind, 'directory');
  assert.equal(local1.source.commit, local1.digest);
  values.delete('tinycad.plugins.v1');
  const localManager = new PluginManager(); localManager.attach({ context: () => ({}), safeToUpdate: () => true, subscribe: () => () => {}, invoke: async () => undefined });
  localManager.controller = async () => ({ call: async () => undefined, dispose() {} });
  await localManager.install(local1, manifest.permissions); assert.equal(localManager.record(manifest.id).policy, 'manual');
  await assert.rejects(() => localManager.policy(manifest.id, 'automatic'), /manually/);
  localFiles.set('ui.js', new TextEncoder().encode(new TextDecoder().decode(files['ui.js']) + String.fromCharCode(10) + '// development edit'));
  const local2 = await development.reload(local1.source); assert.notEqual(local2.digest, local1.digest); assert.equal(local2.manifest.version, local1.manifest.version);
  await localManager.install(local2, manifest.permissions); assert.equal(localManager.record(manifest.id).history[0].digest, local1.digest);
  await assert.rejects(() => localManager.install({ ...local2, source }, manifest.permissions), /source owns/);
  await assert.rejects(() => localManager.install(local2, []), /permissions/);
  localManager.drafts.set('form', manifest.id); await assert.rejects(() => localManager.install(local1, manifest.permissions), /Finish/); localManager.drafts.clear();
  await localManager.rollback(manifest.id, local1.digest); assert.equal(localManager.record(manifest.id).current.digest, local1.digest);
  development.readers.clear(); localManager.packages.clear(); assert.equal((await localManager.package(manifest.id)).digest, local1.digest, 'restart uses cached snapshot without reading development files');
  packages.delete(local1.digest); localManager.packages.clear(); await assert.rejects(() => localManager.package(manifest.id), /cached development snapshot/);
  await assert.rejects(() => development.reload(local1.source), /folder again/);
  await assert.rejects(() => development.directory(folderFiles().map(file => ({ ...file, webkitRelativePath: file.webkitRelativePath.replace('my-plugin/', 'different/') })), local1.source.development), /original development folder/);
  await development.directory(folderFiles(), local1.source.development);
  const multiFiles = [{ webkitRelativePath: 'repo/tinycad-plugins.json', size: JSON.stringify(catalog).length, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(catalog)).buffer }];
  for (const example of bundled) for (const [file, content] of Object.entries(example.files)) multiFiles.push({ webkitRelativePath: 'repo/examples/plugins/' + example.name + '/' + file, size: new TextEncoder().encode(content).length, arrayBuffer: async () => new TextEncoder().encode(content).buffer });
  const multi = await development.directory(multiFiles); assert.equal(multi.length, 2); assert.equal((await development.load(multi[1])).manifest.id, catalog.plugins[1].id);

  const serverDirectory = await mkdtemp(nodePath.join(tmpdir(), 'tinycad-plugin-server-'));
  let server;
  try {
    for (const [name, bytes] of localFiles) { const file = nodePath.join(serverDirectory, name); await mkdir(nodePath.dirname(file), { recursive: true }); await writeFile(file, bytes); }
    await writeFile(nodePath.join(serverDirectory, 'private.txt'), 'must not be served');
    server = await createPluginDevelopmentServer(serverDirectory); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = 'http://127.0.0.1:' + server.address().port + '/';
    const [serverVersion] = await development.server(address); const firstServerPackage = await development.load(serverVersion); assert.equal(firstServerPackage.digest, local2.digest);
    assert.equal((await development.server(address + 'tinycad-plugin.json')).length, 1);
    assert.equal((await fetch(address + 'README.md')).headers.get('access-control-allow-origin'), '*');
    assert.equal((await fetch(address + 'private.txt')).status, 404);
    await writeFile(nodePath.join(serverDirectory, 'ui.js'), 'export function mount() {}');
    const secondServerPackage = await development.reload(firstServerPackage.source); assert.notEqual(secondServerPackage.digest, firstServerPackage.digest);
    if (process.platform !== 'win32') {
      await rm(nodePath.join(serverDirectory, 'ui.js')); await symlink(nodePath.join(serverDirectory, 'private.txt'), nodePath.join(serverDirectory, 'ui.js'));
      await assert.rejects(() => development.reload(firstServerPackage.source), /failed/);
    }
  } finally { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } await rm(serverDirectory, { recursive: true, force: true }); }

  console.log('Plugin checks passed: package validation, ZIP safety, XML/SQLite preservation, atomic edits, undo, sessions, release discovery, update rollback, cache integrity, local folders, and local server development reloads.');
}
module.exports = run();
` },
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile, logLevel: 'error',
    plugins: [{ name: 'test-services', setup(builder) {
      builder.onResolve({ filter: /^sql\.js\/dist\/sql-wasm\.js$/ }, () => ({ path: 'sql', namespace: 'sql-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'sql-test' }, () => ({ resolveDir: root, contents: `const init = require('sql.js'); export default options => init({...options, wasmBinary: require('node:fs').readFileSync(${JSON.stringify(path.join(root, 'node_modules/sql.js/dist/sql-wasm.wasm'))})});` }));
      builder.onResolve({ filter: /^redux-undo$/ }, () => ({ path: path.join(root, 'node_modules/redux-undo/dist/redux-undo.mjs') }));
      builder.onResolve({ filter: /\/startup$/ }, () => ({ path: 'startup', namespace: 'test' }));
      builder.onResolve({ filter: /\/i18n$/ }, () => ({ path: 'i18n', namespace: 'test' }));
      builder.onResolve({ filter: /^url:/ }, args => ({ path: args.path, namespace: 'asset' }));
      builder.onLoad({ filter: /.*/, namespace: 'asset' }, args => ({ contents: `export default ${JSON.stringify(args.path.includes('sql-wasm.wasm') ? path.join(root, 'node_modules/sql.js/dist/sql-wasm.wasm') : '')}` }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path === 'startup' ? 'export const store = {dispatch(){},getState(){return {}}};' : 'export default {t:key=>key};' }));
    } }],
  });
  await createRequire(import.meta.url)(outfile);
} finally { await rm(temporary, { recursive: true, force: true }); }
