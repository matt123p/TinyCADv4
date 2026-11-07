import { test, expect } from '@playwright/test';
import { readFile, writeFile, mkdtemp, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPluginDevelopmentServer } from '../../plugin-development-server.mjs';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

async function installExamples(page) {
  await page.getByRole('button', { name: 'Plugins', exact: true }).click();
  await page.getByRole('tab', { name: 'Discover', exact: true }).click();
  await page.getByRole('button', { name: 'Browse bundled examples' }).click();
  await page.getByRole('checkbox', { name: 'Circuit Inspector', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Project Home', exact: true }).check();
  await page.getByRole('button', { name: 'Install selected plugins' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disable', exact: true })).toHaveCount(2, { timeout: 30000 });
}
test('bundled plugins install, expose safe versioned Markdown, contribute panels/views, and survive reload', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await installExamples(page);
  await page.getByRole('button', { name: 'Full documentation', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Circuit Inspector documentation', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'symbol metadata instructions' }).click();
  await expect(page.getByRole('heading', { name: 'Symbol metadata', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Changelog', exact: true }).first().click();
  await expect(page.locator('.plugin-markdown')).toContainText('1.0.0');
  await page.getByRole('button', { name: 'Close plugin manager' }).click();
  await page.getByRole('combobox', { name: 'Left panel', exact: true }).selectOption('net.tinycad.inspector.summary');
  const inspector = page.frameLocator('iframe[title="Circuit Inspector"]').first();
  await expect(inspector.getByRole('heading', { name: 'Circuit Inspector', exact: true })).toBeVisible();
  const isolation = await page.frames().find(frame => frame !== page.mainFrame() && frame.url() === 'about:srcdoc').evaluate(() => {
    let parentAccess = true; try { void parent.document.body; } catch { parentAccess = false; }
    return { parentAccess, electron: typeof window.electronAPI, require: typeof window.require };
  });
  expect(isolation).toEqual({ parentAccess: false, electron: 'undefined', require: 'undefined' });
  await page.getByRole('combobox', { name: 'Bottom panel', exact: true }).selectOption('net.tinycad.inspector.notes');
  const notes = page.frameLocator('iframe[title="Circuit Inspector"]').last();
  await notes.getByRole('textbox').fill('Browser integration notes'); await notes.getByRole('button', { name: 'Save notes' }).click();
  await expect(notes.getByRole('status')).toContainText('Notes updated');
  await page.getByRole('button', { name: 'Project Home', exact: true }).first().click();
  const project = page.frameLocator('iframe[title="Project Home"]').first();
  await expect(project.getByRole('heading', { name: 'Project files' })).toBeVisible();
  await project.getByRole('button', { name: 'New design', exact: true }).click();
  await expect(page.getByRole('tab', { name: /Untitled.dsn/ })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Plugins', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disable', exact: true })).toHaveCount(2);
  const library = await page.context().newPage(); library.on('pageerror', error => errors.push(error.message));
  await library.goto('/?action=new-library');
  await library.getByRole('tab', { name: 'Plugin metadata', exact: true }).click();
  const model = library.frameLocator('iframe[title="Circuit Inspector"]').last();
  await model.getByRole('textbox').fill('Library definition notes');
  await model.getByRole('button', { name: 'Save notes', exact: true }).click();
  await expect(model.getByRole('status')).toContainText('Notes updated');
  await library.close();
  expect(errors).toEqual([]);
});

test('GitHub release catalogs install only selected plugins, automatically update, and roll back to a pinned version', async ({ page }) => {
  const bundled = JSON.parse(await readFile(new URL('../../../src/plugins/bundledData.json', import.meta.url), 'utf8'));
  let latest = false;
  const assets = new Map(); const releases = [];
  for (const [index, version] of ['1.0.0', '1.1.0'].entries()) {
    const entries = [];
    for (const [pluginIndex, plugin] of bundled.entries()) {
      const pluginVersion = pluginIndex === 0 ? version : '1.0.0';
      const manifest = JSON.parse(plugin.files['tinycad-plugin.json']); manifest.version = pluginVersion;
      const files = { ...plugin.files, 'tinycad-plugin.json': JSON.stringify(manifest) };
      const zip = Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, Buffer.from(value)])), { mtime: new Date('2026-01-01T00:00:00Z') }));
      const id = 100 + index * 10 + pluginIndex; const name = `${manifest.id}-${pluginVersion}.zip`; const digest = createHash('sha256').update(zip).digest('hex');
      assets.set(id, zip); entries.push({ ...plugin.metadata, version: pluginVersion, package: { type: 'releaseAsset', asset: name, sha256: digest } });
    }
    const catalogId = 200 + index; const catalog = Buffer.from(JSON.stringify({ catalogVersion: 1, plugins: entries })); assets.set(catalogId, catalog);
    releases.push({ id: index + 1, name: `Release ${index + 1}`, tag_name: `release-${index + 1}`, draft: false, prerelease: false, published_at: '2026-11-07T00:00:00Z', html_url: 'https://github.com/test/plugins/releases',
      assets: [{ id: catalogId, name: 'tinycad-plugins.json', size: catalog.length }, ...entries.map((entry, i) => ({ id: 100 + index * 10 + i, name: entry.package.asset, size: assets.get(100 + index * 10 + i).length, digest: 'sha256:' + entry.package.sha256 }))] });
  }
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url()); const pathname = url.pathname;
    let body;
    if (pathname === '/repos/test/plugins') body = { id: 55, default_branch: 'main' };
    else if (pathname === '/repos/test/plugins/releases') body = latest ? [releases[1], releases[0]] : [releases[0]];
    else if (pathname.startsWith('/repos/test/plugins/commits/')) body = { sha: (pathname.endsWith('2') ? 'b' : 'a').repeat(40) };
    else if (pathname.startsWith('/repos/test/plugins/releases/assets/')) {
      const data = assets.get(Number(pathname.split('/').pop()));
      await route.fulfill({ status: data ? 200 : 404, body: data || '', headers: { 'content-type': 'application/octet-stream', 'access-control-allow-origin': '*' } }); return;
    } else { await route.fulfill({ status: 404, body: '{}' }); return; }
    await route.fulfill({ status: 200, json: body, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Plugins', exact: true }).click(); await page.getByRole('tab', { name: 'Discover', exact: true }).click();
  await page.getByLabel('GitHub repository URL').fill('https://github.com/test/plugins'); await page.getByRole('button', { name: 'Browse plugins', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Circuit Inspector', exact: true }).check();
  await page.getByRole('button', { name: 'Install selected plugins' }).click(); await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disable', exact: true })).toHaveCount(1);
  let records = await page.evaluate(() => JSON.parse(localStorage.getItem('tinycad.plugins.v1')).plugins);
  expect(records.map(record => record.id)).toEqual(['net.tinycad.inspector']); expect(records[0].current.manifest.version).toBe('1.0.0');
  latest = true; await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('tinycad.plugins.v1')).plugins[0].current.manifest.version)).toBe('1.1.0');
  records = await page.evaluate(() => JSON.parse(localStorage.getItem('tinycad.plugins.v1')).plugins);
  await page.getByRole('combobox', { name: 'Circuit Inspector rollback', exact: true }).selectOption(records[0].history[0].digest);
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('tinycad.plugins.v1')).plugins[0].policy)).toBe('pinned');
  records = await page.evaluate(() => JSON.parse(localStorage.getItem('tinycad.plugins.v1')).plugins);
  expect(records[0].current.manifest.version).toBe('1.0.0'); expect(records).toHaveLength(1);
});


test('local server catalog supports selection, same-version reload, offline startup, and rollback', async ({ page }) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tinycad-browser-plugin-server-')); let server;
  try {
    await cp('examples/plugins/inspector', path.join(directory, 'inspector'), { recursive: true });
    await cp('examples/plugins/project', path.join(directory, 'project'), { recursive: true });
    const catalog = JSON.parse(await readFile('tinycad-plugins.json', 'utf8'));
    for (const entry of catalog.plugins) entry.package.manifest = entry.package.manifest.replace('examples/plugins/', '');
    await writeFile(path.join(directory, 'tinycad-plugins.json'), JSON.stringify(catalog));
    server = await createPluginDevelopmentServer(directory); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await page.goto('/'); await page.getByRole('button', { name: 'Plugins', exact: true }).click();
    await page.getByRole('tab', { name: 'Discover', exact: true }).click();
    await page.getByText('Develop a plugin', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Local plugin server URL', exact: true }).fill('http://127.0.0.1:' + server.address().port + '/');
    await page.getByRole('button', { name: 'Browse local server', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Circuit Inspector', exact: true }).check();
    await expect(page.getByRole('checkbox', { name: 'Project Home', exact: true })).not.toBeChecked();
    await page.getByRole('button', { name: 'Full documentation', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Circuit Inspector documentation', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Install selected plugins', exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Disable', exact: true })).toHaveCount(1);
    const original = await page.evaluate(() => JSON.parse(localStorage.getItem('tinycad.plugins.v1')).plugins[0]);
    expect(original.policy).toBe('manual'); expect(original.current.source.development.kind).toBe('server');
    const ui = path.join(directory, 'inspector/ui.js');
    await writeFile(ui, (await readFile(ui, 'utf8')).replaceAll('Circuit Inspector', 'Server Inspector'));
    await page.getByRole('button', { name: 'Reload from source', exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Circuit Inspector rollback', exact: true })).toBeVisible();
    const updated = await page.evaluate(() => JSON.parse(localStorage.getItem('tinycad.plugins.v1')).plugins[0]);
    expect(updated.current.digest).not.toBe(original.current.digest); expect(updated.current.manifest.version).toBe(original.current.manifest.version);
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); server = undefined;
    await page.reload();
    await page.getByRole('combobox', { name: 'Left panel', exact: true }).selectOption('net.tinycad.inspector.summary');
    const inspector = page.frameLocator('iframe[title="Circuit Inspector"]').first();
    await expect(inspector.getByRole('heading', { name: 'Server Inspector', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Plugins', exact: true }).click();
    await page.getByRole('combobox', { name: 'Circuit Inspector rollback', exact: true }).selectOption(original.current.digest);
    await expect(page.locator('.plugin-manager-list')).toContainText(original.current.digest.slice(0, 8));
    await page.getByRole('button', { name: 'Close plugin manager' }).click();
    await expect(inspector.getByRole('heading', { name: 'Circuit Inspector', exact: true })).toBeVisible();
  } finally { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } await rm(directory, { recursive: true, force: true }); }
});

test('browser folder imports and reloads selected files after restart', async ({ page }) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tinycad-browser-plugin-folder-')); const folder = path.join(directory, 'inspector');
  try {
    await cp('examples/plugins/inspector', folder, { recursive: true });
    await page.goto('/'); await page.getByRole('button', { name: 'Plugins', exact: true }).click();
    await page.getByRole('tab', { name: 'Discover', exact: true }).click();
    await page.getByText('Develop a plugin', { exact: true }).click();
    const chooserPromise = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Import plugin folder', exact: true }).click();
    await (await chooserPromise).setFiles(folder);
    await page.getByRole('checkbox', { name: 'Circuit Inspector', exact: true }).check();
    await page.getByRole('button', { name: 'Install selected plugins', exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reload from folder…', exact: true })).toBeVisible();
    await page.reload(); await page.getByRole('button', { name: 'Plugins', exact: true }).click();
    const ui = path.join(folder, 'ui.js'); await writeFile(ui, (await readFile(ui, 'utf8')).replaceAll('Circuit Inspector', 'Folder Inspector'));
    const reloadChooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Reload from folder…', exact: true }).click();
    await (await reloadChooser).setFiles(folder);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Circuit Inspector rollback', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close plugin manager' }).click();
    await page.getByRole('combobox', { name: 'Left panel', exact: true }).selectOption('net.tinycad.inspector.summary');
    await expect(page.frameLocator('iframe[title="Circuit Inspector"]').first().getByRole('heading', { name: 'Folder Inspector', exact: true })).toBeVisible();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
