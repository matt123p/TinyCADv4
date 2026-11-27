import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, expect } from 'playwright/test';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const scratch = await mkdtemp(
  path.join(os.tmpdir(), 'tinycad-project-electron-'),
);
const project = path.join(scratch, 'project');
const profile = path.join(scratch, 'profile');
const git = (...args) =>
  execFileSync('git', ['-C', project, ...args], { encoding: 'utf8' }).trim();
const env = { ...process.env, ELECTRON_IS_DEV: '0' };
delete env.ELECTRON_RUN_AS_NODE;
let desktop;
const errors = [];

async function launch(...files) {
  desktop = await _electron.launch({
    executablePath: env.TINYCAD_TEST_ELECTRON,
    args: [repository, `--user-data-dir=${profile}`, '--no-sandbox', ...files],
    env,
  });
  const page = await desktop.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.locator('.page-container').waitFor();
  return page;
}

const tableFixtures = [
  ['Comma.csv', ',', 'Comma (,)'],
  ['Semicolon.csv', ';', 'Semicolon (;)'],
  ['Pipe.csv', '|', 'Pipe (|)'],
  ['Tabs.tsv', '\t', 'Tab'],
  ['Caret.csv', '^', 'Caret (^)'],
];
const sourceFixtures = [
  ['Config.json', '{"label":"demo","enabled":true}', '.hljs-attr', '"label"'],
  ['Parts.xml', '<parts><part id="a"/></parts>', '.hljs-name', 'parts'],
  ['Config.yaml', 'label: demo\nenabled: true\n', '.hljs-attr', 'label:'],
  ['README', 'Plain extensionless text'],
  ['UTF16.txt', Buffer.from('\ufeffPlain text in UTF-16\r\n', 'utf16le')],
];

try {
  await mkdir(project);
  const marker = path.join(project, 'Circuit.tcproject');
  await Promise.all([
    copyFile(
      path.join(repository, 'examples/simulation/voltage-divider.dzn'),
      path.join(project, 'Divider.dzn'),
    ),
    copyFile(
      path.join(repository, 'examples/simulation/rc-charging.dzn'),
      path.join(project, 'Charging.dzn'),
    ),
    writeFile(path.join(project, 'Notes.md'), '# Initial\n'),
    writeFile(marker, '<?xml version="1.0"?><TinyCADProject/>'),
    ...sourceFixtures.map(([name, content]) =>
      writeFile(path.join(project, name), content),
    ),
    ...tableFixtures.map(([name, separator]) =>
      writeFile(
        path.join(project, name),
        `Part${separator}Description\r\n001${separator}"first${separator}value\r\nsecond ""line"""\r\n`,
      ),
    ),
  ]);
  git('init', '-q');
  git('config', 'user.name', 'TinyCAD Test');
  git('config', 'user.email', 'test@example.invalid');
  git('add', '.');
  git('commit', '-qm', 'Initial project');

  let page = await launch();
  await desktop.evaluate(({ BrowserWindow, dialog, Menu }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
    const window = BrowserWindow.getAllWindows()[0];
    const file = Menu.getApplicationMenu().items.find(
      ({ label }) => label.replaceAll('&', '') === 'File',
    );
    file.submenu.items
      .find(({ label }) => label === 'Open Project Folder…')
      .click(undefined, window);
  }, project);

  const files = () => page.getByRole('region', { name: 'Project Files' });
  const tabs = () => page.getByLabel('Open files');
  const button = (name) => page.getByRole('button', { name, exact: true });
  const tab = (name) => tabs().getByRole('button', { name, exact: true });
  const open = (name) =>
    files().getByRole('button', { name, exact: true }).click();
  for (const [name, content, token, expected] of sourceFixtures) {
    await open(name);
    const source = page.getByLabel(`Source of ${name}`);
    if (token) await expect(source.locator(token).first()).toHaveText(expected);
    else
      await expect(source).toContainText(
        typeof content === 'string' ? content : 'Plain text in UTF-16',
      );
    if (name === 'UTF16.txt') {
      await button('Edit Source').click();
      await page
        .getByRole('textbox', { name: 'Edit UTF16.txt' })
        .fill('Revised UTF-16\n');
      await button('Save UTF16.txt').click();
      await expect(tab('UTF16.txt')).toBeVisible();
      assert.deepEqual(
        await readFile(path.join(project, name)),
        Buffer.from('\ufeffRevised UTF-16\r\n', 'utf16le'),
      );
    }
    await button(`Close ${name}`).click();
  }
  for (const [name, separator, label] of tableFixtures) {
    await open(name);
    await button('View as Table').click();
    const table = page.getByRole('table', { name });
    await expect(
      page.getByLabel('Separator').locator('option:checked'),
    ).toHaveText(`Auto (${label})`);
    await expect(table.getByRole('row')).toHaveCount(2);
    const cells = table.getByRole('row').nth(1).getByRole('cell');
    await expect(cells).toHaveCount(2);
    await expect(cells.first()).toHaveText('001');
    assert.equal(
      await cells.last().textContent(),
      `first${separator}value\nsecond "line"`,
    );
    await button(`Close ${name}`).click();
  }

  await files().getByRole('button', { name: 'Divider.dzn' }).click();
  await files().getByRole('button', { name: 'Charging.dzn' }).click();
  await expect(tab('Charging.dzn')).toHaveAttribute('aria-pressed', 'true');
  await tab('Divider.dzn').click();
  await expect(tab('Divider.dzn')).toHaveAttribute('aria-pressed', 'true');
  const originalDrawing = await readFile(path.join(project, 'Divider.dzn'));
  await desktop.evaluate(({ BrowserWindow, Menu }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const settings = Menu.getApplicationMenu().items.find(
      ({ label }) => label.replaceAll('&', '') === 'Settings',
    );
    settings.submenu.items
      .find(({ label }) =>
        label.replaceAll('&', '').startsWith('Design Details'),
      )
      .click(undefined, window);
  });
  const details = page.getByRole('dialog', { name: 'Design Details' });
  await details
    .getByRole('textbox', { name: 'Title' })
    .fill('Project smoke test');
  await details.getByRole('button', { name: 'OK' }).click();
  await tab('Charging.dzn').click();
  await expect(tab('Divider.dzn •')).toBeVisible();

  await files().getByRole('button', { name: 'Notes.md' }).click();
  const text = () => page.getByRole('textbox', { name: 'Edit Notes.md' });
  await button('Edit Source').click();
  await text().fill('# Reopened notes\n');
  await button('Preview Markdown').click();
  await expect(
    page.getByRole('heading', { name: 'Reopened notes' }),
  ).toBeVisible();
  await button('Save All').click();
  await expect(tab('Notes.md')).toHaveAttribute('aria-pressed', 'true');
  await expect(tab('Divider.dzn')).toBeVisible();
  assert.notDeepEqual(
    await readFile(path.join(project, 'Divider.dzn')),
    originalDrawing,
  );
  assert.equal(
    await readFile(path.join(project, 'Notes.md'), 'utf8'),
    '# Reopened notes\n',
  );

  const row = (name) => files().getByRole('button', { name, exact: true });
  const context = async (name, action) => {
    await row(name).click({ button: 'right' });
    await page.getByRole('menuitem', { name: action, exact: true }).click();
  };
  const inlineName = async (from, to) => {
    const name = page.getByRole('textbox', {
      name: `Rename ${from}`,
      exact: true,
    });
    await expect(name).toBeFocused();
    await name.fill(to);
    await name.press('Enter');
    await expect(row(to)).toBeVisible();
  };
  await row('project').click();
  await button('New Folder').click();
  await expect
    .poll(async () =>
      stat(path.join(project, 'New Folder')).then((s) => s.isDirectory()),
    )
    .toBe(true);
  if (process.env.TINYCAD_TEST_PROJECT_SCREENSHOTS) {
    await page
      .getByRole('textbox', { name: 'Rename New Folder', exact: true })
      .waitFor();
    await page.screenshot({
      path: path.join(
        process.env.TINYCAD_TEST_PROJECT_SCREENSHOTS,
        'explorer.png',
      ),
    });
  }
  await inlineName('New Folder', 'Assets');
  await row('Assets').focus();
  await page.keyboard.press('F2');
  await inlineName('Assets', 'Assets renamed');

  for (const [label, extension] of [
    ['Schematic (.dsn)', 'dsn'],
    ['Compressed schematic (.dzn)', 'dzn'],
    ['Symbol library (.tclib)', 'tclib'],
    ['JSON (.json)', 'json'],
  ]) {
    await row('project').click();
    await button('New File').click();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
    await inlineName(`New File.${extension}`, `Empty.${extension}`);
    assert.equal(
      (await readFile(path.join(project, `Empty.${extension}`))).byteLength,
      0,
    );
  }
  await open('Empty.dzn');
  await expect(tab('Empty.dzn')).toHaveAttribute('aria-pressed', 'true');
  await context('Empty.dzn', 'Rename');
  await inlineName('Empty.dzn', 'Renamed.dzn');
  await expect(tab('Renamed.dzn')).toHaveAttribute('aria-pressed', 'true');
  await button('Close Renamed.dzn').click();

  await context('Notes.md', 'Copy');
  await context('Assets renamed', 'Paste');
  await expect(row('Assets renamed')).toHaveAttribute('aria-expanded', 'true');
  assert.equal(
    await readFile(path.join(project, 'Assets renamed', 'Notes.md'), 'utf8'),
    '# Reopened notes\n',
  );
  await context('Assets renamed', 'Copy');
  await button('Project file actions').click();
  await page.getByRole('menuitem', { name: 'Paste', exact: true }).click();
  await expect(row('Assets renamed copy')).toBeVisible();
  assert.equal(
    await readFile(
      path.join(project, 'Assets renamed copy', 'Notes.md'),
      'utf8',
    ),
    '# Reopened notes\n',
  );

  await row('Empty.json').focus();
  await page.keyboard.press('Control+x');
  await row('Assets renamed').focus();
  await page.keyboard.press('Control+v');
  await expect(
    row('Assets renamed')
      .locator('xpath=..')
      .getByRole('button', { name: 'Empty.json' }),
  ).toBeVisible();
  assert.equal(
    (await readFile(path.join(project, 'Assets renamed', 'Empty.json')))
      .byteLength,
    0,
  );
  await assert.rejects(readFile(path.join(project, 'Empty.json')), {
    code: 'ENOENT',
  });

  await row('Renamed.dzn').dragTo(row('Assets renamed'));
  await expect(
    row('Assets renamed')
      .locator('xpath=..')
      .getByRole('button', { name: 'Renamed.dzn' }),
  ).toBeVisible();
  assert.equal(
    (await readFile(path.join(project, 'Assets renamed', 'Renamed.dzn')))
      .byteLength,
    0,
  );

  await desktop.evaluate(({ shell }, directory) => {
    const fs = process.getBuiltinModule('fs');
    shell.showItemInFolder = (filename) =>
      fs.writeFileSync(directory + '/revealed', filename);
    shell.openPath = async (filename) => {
      fs.writeFileSync(directory + '/opened', filename);
      return '';
    };
    shell.trashItem = async (filename) =>
      fs.renameSync(filename, directory + '/trashed');
  }, scratch);
  await context('Empty.tclib', 'Reveal in File Manager');
  await expect
    .poll(() => readFile(path.join(scratch, 'revealed'), 'utf8'))
    .toBe(path.join(project, 'Empty.tclib'));
  await button('Project file actions').click();
  await page
    .getByRole('menuitem', { name: 'Open in File Manager', exact: true })
    .click();
  await expect
    .poll(() => readFile(path.join(scratch, 'opened'), 'utf8'))
    .toBe(project);
  page.once('dialog', (dialog) => dialog.accept());
  await context('Assets renamed copy', 'Move to Trash');
  await expect(row('Assets renamed copy')).toHaveCount(0);
  assert.equal(
    await readFile(path.join(scratch, 'trashed', 'Notes.md'), 'utf8'),
    '# Reopened notes\n',
  );

  await row('Assets renamed').click();
  await open('Notes.md');
  await page.getByRole('button', { name: /^Git/ }).click();
  const source = page.getByRole('region', { name: 'Source Control' });
  const working = source.getByRole('list', { name: 'Changes', exact: true });
  const staged = source.getByRole('list', {
    name: 'Staged Changes',
    exact: true,
  });
  const changedNotes = working
    .getByRole('button', { name: 'Notes.md', exact: true })
    .first();
  await changedNotes.click();
  const diff = page.getByRole('region', { name: 'Git diff' });
  await expect(
    diff.getByText('Reopened notes', { exact: false }).first(),
  ).toBeVisible();
  await button('Side by Side').click();
  await expect(diff.locator('.diff-split')).toBeVisible();
  if (process.env.TINYCAD_TEST_PROJECT_SCREENSHOTS)
    await page.screenshot({
      path: path.join(
        process.env.TINYCAD_TEST_PROJECT_SCREENSHOTS,
        'source-control.png',
      ),
    });
  await button('Stage Hunk').click();
  await expect(staged.getByRole('button', { name: 'Notes.md' })).toBeVisible();
  assert.equal(git('diff', '--cached', '--name-only'), 'Notes.md');
  await staged.getByRole('button', { name: 'Notes.md' }).click();
  await button('Unstage Hunk').click();
  await expect(staged.getByRole('button', { name: 'Notes.md' })).toHaveCount(0);
  assert.equal(git('diff', '--cached', '--name-only'), '');
  await changedNotes.click();
  await button('Select removed line 1').click();
  await button('Select added line 1').click();
  await button('Stage Selected Lines').click();
  await expect(staged.getByRole('button', { name: 'Notes.md' })).toBeVisible();
  await staged.getByRole('button', { name: 'Notes.md' }).click();
  await button('Select removed line 1').click();
  await button('Select added line 1').click();
  await button('Unstage Selected Lines').click();
  await expect(staged.getByRole('button', { name: 'Notes.md' })).toHaveCount(0);
  await changedNotes
    .locator('xpath=..')
    .getByRole('button', { name: 'Stage', exact: true })
    .click();
  await expect(staged.getByRole('button', { name: 'Notes.md' })).toBeVisible();
  await source
    .getByRole('textbox', { name: 'Commit message' })
    .fill('Update notes');
  await source.getByRole('button', { name: 'Review Commit' }).click();
  await page
    .getByRole('dialog', { name: 'Commit staged changes' })
    .getByRole('button', { name: 'Commit', exact: true })
    .click();
  await expect.poll(() => git('log', '-1', '--format=%s')).toBe('Update notes');
  const graph = source.getByRole('list', { name: 'Commit graph' });
  const initial = graph.getByRole('button', { name: 'Initial project' });
  await initial.click();
  await expect(page.getByRole('region', { name: 'Git diff' })).toBeVisible();
  await button('Close Review').click();
  await initial.click({ button: 'right' });
  await page
    .getByRole('menuitem', { name: 'Compare with Branch or Tag…' })
    .click();
  await page
    .getByRole('dialog', { name: /Compare/ })
    .getByRole('button', { name: 'Compare', exact: true })
    .click();
  await expect(page.getByRole('region', { name: 'Git diff' })).toBeVisible();
  await button('Close Review').click();
  await button('Files').click();
  await context('Notes.md', 'Line History');
  await expect(
    page.getByRole('region', { name: 'Line History · Notes.md' }),
  ).toContainText(git('log', '-1', '--format=%an'));
  await button('Close Review').click();
  await button('Files').click();

  await desktop.close();
  desktop = undefined;
  page = await launch();
  await expect(tab('Divider.dzn')).toBeVisible();
  await expect(tab('Charging.dzn')).toBeVisible();
  await expect(tab('Notes.md')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Source of Notes.md')).toContainText(
    '# Reopened notes',
  );
  await button('Preview Markdown').click();
  await expect(
    page.getByRole('heading', { name: 'Reopened notes' }),
  ).toBeVisible();
  await button('Close project').click();
  await expect(tabs()).toHaveCount(0);

  await desktop.close();
  desktop = undefined;
  page = await launch(marker);
  await expect(
    files().getByRole('button', { name: 'Circuit.tcproject' }),
  ).toBeVisible();
  await desktop.close();
  desktop = undefined;
  page = await launch(path.join(project, 'Empty.tclib'));
  await expect(page.getByTitle('New Symbol')).toBeVisible();
  await expect(page.getByText('Empty.tclib', { exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log('Electron project smoke test passed');
} catch (error) {
  if (errors.length) console.error(errors);
  throw error;
} finally {
  await desktop?.close();
  await rm(scratch, { recursive: true, force: true });
}
