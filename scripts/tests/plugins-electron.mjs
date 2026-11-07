import { _electron, expect } from '@playwright/test';
import { createPluginDevelopmentServer } from '../plugin-development-server.mjs';
import { mkdtemp, writeFile, readFile, mkdir, readdir, rm, cp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'tinycad-plugin-electron-'));
const profile = path.join(directory, 'profile'); await mkdir(profile);
const entry = path.join(directory, 'main.mjs');
await writeFile(entry, `import { app } from 'electron'; app.setPath('userData', ${JSON.stringify(profile)}); await import(${JSON.stringify(pathToFileURL(path.join(root, 'electron/electron.js')).href)});`);
const env = { ...process.env, ELECTRON_IS_DEV: '0' }; delete env.ELECTRON_RUN_AS_NODE;
const args = [entry, '--no-sandbox', '--disable-gpu'];
let app;
async function openManager(app, page) {
  await page.locator('.toolbar-container').waitFor({ state: 'visible' });
  await app.evaluate(({ Menu }) => {
    const file = Menu.getApplicationMenu().items.find(item => item.label.replaceAll('&', '') === 'File');
    if (!file) throw new Error('File menu missing');
    const plugins = file.submenu.items.find(item => item.label === 'Plugins…');
    if (!plugins) throw new Error('Plugins must be in File');
    plugins.click();
  });
  await expect(page.getByRole('dialog', { name: 'Plugin manager', exact: true })).toBeVisible();
}
async function installPlugin(page, name) {
  await page.getByRole('tab', { name: 'Available', exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Uninstall', exact: true })).toBeVisible();
}
async function installedCount(page, count) {
  await expect.poll(async () => (await page.evaluate(() => window.electronAPI.pluginStorage('get', 'records'))).plugins.length).toBe(count);
}
try {
  app = await _electron.launch({ args, env, timeout: 30000 });
  let page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await openManager(app, page);
  await installPlugin(page, 'Circuit Inspector'); await installPlugin(page, 'Project Home');
  await installedCount(page, 2);
  const records = await page.evaluate(() => window.electronAPI.pluginStorage('get', 'records'));
  expect(records.plugins).toHaveLength(2);
  const cached = await readdir(path.join(profile, 'plugins'));
  expect(cached.some(file => file.startsWith('package-') && file.endsWith('.bin'))).toBe(true);
  const menuLabels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.flatMap(menu => menu.submenu?.items.map(item => item.label) || []));
  expect(menuLabels).toContain('Plugins…');
  expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.some(item => item.label === 'Plugins'))).toBe(false); expect(menuLabels).toContain('Inspect circuit'); expect(menuLabels).toContain('Project Home');
  await page.getByRole('button', { name: 'Close plugin manager' }).click();
  await app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu().items.flatMap(menu => menu.submenu?.items || []).find(item => item.label === 'Inspect circuit');
    item.click();
  });
  await expect(page.getByRole('tab', { name: 'Circuit report', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Left panel', exact: true }).selectOption('net.tinycad.inspector.summary');
  await expect(page.frameLocator('iframe[title="Circuit Inspector"]').first().getByRole('heading', { name: 'Circuit Inspector', exact: true })).toBeVisible();
  const isolation = await page.frames().find(frame => frame !== page.mainFrame() && frame.url() === 'about:srcdoc').evaluate(() => ({ bridge: typeof window.electronAPI, require: typeof window.require }));
  expect(isolation).toEqual({ bridge: 'undefined', require: 'undefined' });
  expect(errors).toEqual([]);
  await app.close(); app = undefined;
  app = await _electron.launch({ args, env, timeout: 30000 });
  page = await app.firstWindow(); await openManager(app, page);
  await installedCount(page, 2);
  await page.getByRole('option', { name: 'Circuit Inspector', exact: true }).click();
  await page.getByRole('tab', { name: 'Full documentation', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Circuit Inspector documentation', exact: true })).toBeVisible();
  // Replace one bundled example with a selected development folder, then reload without a version bump.
  await page.getByRole('button', { name: 'Uninstall', exact: true }).first().click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await installedCount(page, 1);
  const localFolder = path.join(directory, 'inspector'); await cp(path.join(root, 'examples/plugins/inspector'), localFolder, { recursive: true });
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, localFolder);
  await page.getByRole('button', { name: 'Developer mode', exact: true }).click();
  await page.getByRole('combobox', { name: 'Development source', exact: true }).selectOption('directory');
  await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
  await installPlugin(page, 'Circuit Inspector');
  await expect(page.locator('.plugin-details-source')).toContainText('inspector');
  const installed = await page.evaluate(() => window.electronAPI.pluginStorage('get', 'records'));
  const localRecord = installed.plugins.find(plugin => plugin.id === 'net.tinycad.inspector');
  const sourceId = localRecord.current.source.development.id;
  await expect(page.getByRole('button', { name: 'Reload from source', exact: true })).toBeVisible();
  await writeFile(path.join(localFolder, 'ui.js'), (await readFile(path.join(localFolder, 'ui.js'), 'utf8')).replaceAll('Circuit Inspector', 'Development Inspector'));
  await page.getByRole('button', { name: 'Reload from source', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByText('Plugin settings', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Circuit Inspector rollback', exact: true })).toBeVisible();
  const updated = (await page.evaluate(() => window.electronAPI.pluginStorage('get', 'records'))).plugins.find(plugin => plugin.id === 'net.tinycad.inspector');
  expect(updated.current.digest).not.toBe(localRecord.current.digest); expect(updated.current.manifest.version).toBe(localRecord.current.manifest.version);
  expect(updated.history[0].digest).toBe(localRecord.current.digest);
  // The main-process adapter rejects traversal and symlinks even from the host renderer.
  await expect(page.evaluate(id => window.electronAPI.readPluginDevelopmentFile(id, '../outside.txt'), sourceId)).rejects.toThrow(/path/);
  if (process.platform !== 'win32') {
    await symlink(path.join(localFolder, 'README.md'), path.join(localFolder, 'linked.md'));
    await expect(page.evaluate(id => window.electronAPI.readPluginDevelopmentFile(id, 'linked.md'), sourceId)).rejects.toThrow(/symlinks/);
  }
  const server = await createPluginDevelopmentServer(localFolder); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const bytes = await page.evaluate(url => window.electronAPI.pluginDevelopmentDownload(url), 'http://127.0.0.1:' + server.address().port + '/tinycad-plugin.json');
    expect(JSON.parse(new TextDecoder().decode(new Uint8Array(Object.values(bytes)))).id).toBe('net.tinycad.inspector');
    await expect(page.evaluate(() => window.electronAPI.pluginDevelopmentDownload('https://example.com/plugin'))).rejects.toThrow(/loopback/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await page.getByRole('button', { name: 'Close plugin manager' }).click();
  await page.getByRole('combobox', { name: 'Left panel', exact: true }).selectOption('net.tinycad.inspector.summary');
  await expect(page.frameLocator('iframe[title="Circuit Inspector"]').first().getByRole('heading', { name: 'Development Inspector', exact: true })).toBeVisible();
  await app.close(); app = undefined;
  app = await _electron.launch({ args, env, timeout: 30000 }); page = await app.firstWindow();
  await openManager(app, page);
  await page.getByRole('button', { name: 'Reload from source', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.plugin-details-source')).toContainText('inspector');
  console.log('Electron plugin integration passed: isolated runtime, disk cache/restart, native menus, Markdown documentation, and remembered local folder reloads.');
} finally { if (app) await app.close(); await rm(directory, { recursive: true, force: true }); }
