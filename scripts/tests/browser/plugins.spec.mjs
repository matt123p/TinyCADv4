import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
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
