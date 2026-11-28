import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, expect } from 'playwright/test';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const scratch = await mkdtemp(path.join(os.tmpdir(), 'tinycad-project-pcb-'));
const marker = path.join(scratch, 'Board test.tcproject');
const board = path.join(scratch, 'Saved board.dpn');
const env = { ...process.env, ELECTRON_IS_DEV: '0' };
delete env.ELECTRON_RUN_AS_NODE;
let desktop;

async function launch(...files) {
  desktop = await _electron.launch({
    executablePath: env.TINYCAD_TEST_ELECTRON,
    args: [repository, `--user-data-dir=${path.join(scratch, 'profile')}`, '--no-sandbox', '--disable-dev-shm-usage', ...files],
    env,
  });
  const page = await desktop.firstWindow();
  page.setDefaultTimeout(12_000);
  return page;
}

async function menu(...labels) {
  await desktop.evaluate(({ BrowserWindow, Menu }, names) => {
    let items = Menu.getApplicationMenu().items;
    let item;
    for (const name of names) {
      item = items.find(({ label }) => label.replaceAll('&', '') === name);
      items = item.submenu?.items;
    }
    item.click(undefined, BrowserWindow.getAllWindows()[0]);
  }, labels);
}

try {
  await writeFile(marker, '<?xml version="1.0"?><TinyCADProject/>');
  await copyFile(path.join(repository, 'examples/simulation/voltage-divider.dzn'), path.join(scratch, 'Circuit.dzn'));
  let page = await launch(marker);
  const files = () => page.getByRole('region', { name: 'Project Files' });
  const tabs = () => page.getByLabel('Open files');
  const canvas = () => page.getByRole('img', { name: 'Board layout' });
  const tab = (name) => tabs().getByRole('button', { name, exact: true });

  await files().getByRole('button', { name: 'Circuit.dzn', exact: true }).dblclick();
  await expect(tab('Circuit.dzn')).toBeVisible();
  await menu('File', 'New', 'New PCB');
  await expect(canvas()).toBeVisible();
  await expect(tabs().getByRole('button', { name: /^Untitled\.dpn/ })).toBeVisible();
  await page.getByRole('button', { name: 'Side by side' }).click();
  await expect(page.locator('.project-design-split')).toBeVisible();
  await page.getByRole('button', { name: 'Side by side' }).click();

  await desktop.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, board);
  await tab('Save All').click();
  await expect(tab('Saved board.dpn')).toBeVisible();
  assert.match(await readFile(board, 'utf8'), /TinyCADPCB/);

  await tab('Circuit.dzn').click();
  await expect(canvas()).toBeHidden();
  await tab('Saved board.dpn').click();
  await expect(canvas()).toBeVisible();
  await desktop.close();
  desktop = undefined;

  page = await launch(marker);
  await expect(tab('Circuit.dzn')).toBeVisible();
  await expect(tab('Saved board.dpn')).toBeVisible();
  await expect(canvas()).toBeVisible();
  console.log('Electron PCB project tabs, Save All, and restart passed.');
} finally {
  await desktop?.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
}
