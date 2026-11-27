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
  ['Comma.csv', ','],
  ['Semicolon.csv', ';'],
  ['Pipe.csv', '|'],
  ['Tabs.tsv', '\t'],
  ['Caret.csv', '^'],
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
    writeFile(path.join(project, 'tCad2.dzn'), ''),
    writeFile(
      path.join(project, 'Preview.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>',
    ),
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
  const saveAll = () => tab('Save All');
  const open = (name) =>
    files().getByRole('button', { name, exact: true }).click();
  const edit = (name) => page.getByRole('textbox', { name: `Edit ${name}` });
  const toolbar = () => page.getByRole('toolbar', { name: 'Editor toolbar' });
  const view = (name) => page.getByRole('tab', { name, exact: true });
  const tokens = (name, token) =>
    page.getByRole('region', { name, exact: true }).locator(token);
  const menu = (...labels) =>
    desktop.evaluate(({ BrowserWindow, Menu }, labels) => {
      let items = Menu.getApplicationMenu().items;
      let target;
      for (const name of labels) {
        target = items.find(({ label }) => label.replaceAll('&', '') === name);
        items = target.submenu?.items;
      }
      target.click(undefined, BrowserWindow.getAllWindows()[0]);
    }, labels);

  const activityBar = () =>
    page.getByRole('navigation', { name: 'Project views' });
  const librarySearch = () =>
    page.getByPlaceholder(/Search (libraries|TinyCAD\.net)/);
  const sidebar = () =>
    page.getByRole('complementary', { name: 'Project sidebar' });
  const tabOffset = async (left) =>
    (await tabs().boundingBox()).x - (left.x + left.width);
  await expect(page.locator('.side-panel-container')).toHaveCount(1);
  await expect(files()).toBeVisible();
  await expect(activityBar().getByRole('button').first()).toHaveAccessibleName(
    'Hide side panel',
  );
  await expect(librarySearch()).toBeHidden();
  await expect
    .poll(async () => tabOffset(await sidebar().boundingBox()))
    .toBeCloseTo(1, 0);
  await activityBar().getByRole('button', { name: 'Libraries' }).click();
  await expect(librarySearch()).toBeVisible();
  await expect(files()).toBeHidden();
  await button('Hide side panel').click();
  await expect(sidebar()).toBeHidden();
  await expect
    .poll(async () => tabOffset(await activityBar().boundingBox()))
    .toBeCloseTo(0, 0);
  await button('Show side panel').click();
  await expect(librarySearch()).toBeVisible();
  await activityBar().getByRole('button', { name: 'Git' }).click();
  await button('Initialize Repository').click();
  await expect(button('Stage project files')).toBeEnabled();
  await expect(button('Unstage project files')).toBeDisabled();
  await expect(button('Review Commit')).toBeDisabled();
  await button('Synchronize repository').click();
  for (const name of ['Fetch', 'Pull', 'Push', 'Sync Changes']) {
    await expect(
      page.getByRole('menuitem', { name, exact: true }),
    ).toBeDisabled();
  }
  await page.keyboard.press('Escape');
  await button('Repository actions').click();
  await expect(
    page.getByRole('menuitem', { name: 'Initialize Repository' }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  git('config', 'user.name', 'TinyCAD Test');
  git('config', 'user.email', 'test@example.invalid');
  git('add', '.');
  git('commit', '-qm', 'Initial project');
  await button('Refresh source control').click();
  await expect(button('Stage project files')).toBeDisabled();
  const initialBranch = git('branch', '--show-current');
  await button(initialBranch).click();
  await expect(page.getByRole('list', { name: 'Branch graph' })).toContainText(
    'Initial project',
  );
  await page.getByRole('textbox', { name: 'Branch name' }).fill('experiment');
  await button('Create branch').click();
  await expect(button('experiment')).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Branches' })
    .getByRole('button', { name: 'Close' })
    .click();
  await activityBar().getByRole('button', { name: 'Files' }).click();

  const background = files().locator('.project-tree-background');
  await background.click({ button: 'right' });
  await expect(
    page.getByRole('menuitem', { name: 'New Folder' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  await menu('File', 'New', 'New Design');
  await expect(tab('tCad3.dsn')).toBeVisible();
  await menu('File', 'New', 'New Design');
  await expect(tab('tCad4.dsn')).toBeVisible();
  await button('Close tCad4.dsn').click();
  await button('Close tCad3.dsn').click();
  const toolbarHeight = (
    await page.locator('.toolbar-container:visible').boundingBox()
  ).height;
  await open('Preview.svg');
  await expect(page.getByRole('img', { name: 'Preview.svg' })).toBeVisible();
  await expect(
    toolbar().getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
  const chat = toolbar().getByRole('button', { name: 'Chat', exact: true });
  await chat.click();
  await expect(page.locator('#tinycad-chat')).toBeVisible();
  await expect(chat).toHaveAttribute('aria-expanded', 'true');
  await chat.click();
  await expect(page.locator('#tinycad-chat')).toBeHidden();
  await toolbar().getByRole('button', { name: 'Language menu' }).click();
  await page.getByRole('menuitem', { name: 'Français', exact: true }).click();
  await toolbar().getByRole('button', { name: 'Menu de langue' }).click();
  await page.getByRole('menuitem', { name: 'English', exact: true }).click();
  await expect(
    toolbar().getByRole('button', { name: 'Language menu' }),
  ).toBeVisible();
  expect(
    (await page.locator('.toolbar-container:visible').boundingBox()).height,
  ).toBe(toolbarHeight);
  await button('Zoom in').click();
  await expect(
    page.getByRole('slider', { name: 'Zoom percentage' }),
  ).toHaveAttribute('aria-valuetext', '125%');
  await button('Fit').click();
  await expect(
    page.getByRole('slider', { name: 'Zoom percentage' }),
  ).toHaveAttribute('aria-valuetext', '100%');
  await expect(saveAll()).toBeVisible();
  await activityBar().getByRole('button', { name: 'Libraries' }).click();
  await expect(librarySearch()).toBeVisible();
  await button('Hide side panel').click();
  await expect(sidebar()).toBeHidden();
  await expect(page.getByRole('img', { name: 'Preview.svg' })).toBeVisible();
  await button('Show side panel').click();
  await activityBar().getByRole('button', { name: 'Files' }).click();
  await button('Close Preview.svg').click();
  const circuitTabClass = await page
    .locator('.sheetbar:visible .sheet-heading-on')
    .getAttribute('class');

  await desktop.evaluate(({ Menu }) => {
    const popup = Menu.prototype.popup;
    Menu.prototype.popup = function (...args) {
      if (this.items.some(({ role }) => role === 'cut')) {
        globalThis.projectEditorContextItems = this.items.map(({ label }) =>
          label.replaceAll('&', ''),
        );
        return;
      }
      return popup.apply(this, args);
    };
  });

  for (const [name, content, token, expected] of sourceFixtures) {
    await open(name);
    await expect(edit(name)).toHaveValue(
      typeof content === 'string' ? content : 'Plain text in UTF-16\n',
    );
    if (token) await expect(tokens(name, token).first()).toHaveText(expected);
    if (name === 'Parts.xml') {
      const undo = toolbar().getByRole('button', { name: 'Undo' });
      const redo = toolbar().getByRole('button', { name: 'Redo' });
      await expect(undo).toBeDisabled();
      await expect(redo).toBeDisabled();
      await edit(name).fill('<updated/>');
      await expect(undo).toBeEnabled();
      await expect(redo).toBeDisabled();
      await undo.click();
      await expect(edit(name)).toHaveValue(content);
      await expect(undo).toBeDisabled();
      await expect(redo).toBeEnabled();
      await redo.click();
      await expect(edit(name)).toHaveValue('<updated/>');
      await expect(redo).toBeDisabled();
      await undo.click();
    }
    if (name === 'UTF16.txt') {
      await edit(name).fill('Revised UTF-16\n');
      await edit(name).click({ button: 'right' });
      await expect
        .poll(() =>
          desktop.evaluate(() => globalThis.projectEditorContextItems),
        )
        .toEqual(
          expect.arrayContaining(['Undo', 'Redo', 'Cut', 'Copy', 'Paste']),
        );
      await menu('Edit', 'Undo');
      await expect(edit(name)).toHaveValue('Plain text in UTF-16\n');
      await menu('Edit', 'Redo');
      await expect(edit(name)).toHaveValue('Revised UTF-16\n');
      await edit(name).press('ControlOrMeta+a');
      await edit(name).press('ControlOrMeta+x');
      await expect(edit(name)).toHaveValue('');
      await edit(name).press('ControlOrMeta+v');
      await expect(edit(name)).toHaveValue('Revised UTF-16\n');
      await menu('File', 'Save');
      await expect(tab('UTF16.txt')).toBeVisible();
      assert.deepEqual(
        await readFile(path.join(project, name)),
        Buffer.from('\ufeffRevised UTF-16\r\n', 'utf16le'),
      );
    }
    await button(`Close ${name}`).click();
  }
  for (const [name, separator] of tableFixtures) {
    await open(name);
    await expect(edit(name)).toBeEditable();
    await expect(tokens(name, '.hljs-punctuation')).toHaveCount(2);
    assert.equal(
      await tokens(name, '.hljs-punctuation').first().textContent(),
      separator,
    );
    await expect(tokens(name, '.hljs-string')).toHaveCount(1);
    await expect(view('Text')).toHaveAttribute('aria-selected', 'true');
    await expect(view('Text')).toHaveClass(circuitTabClass);
    await view('Text').press('ArrowRight');
    await expect(view('Table')).toBeFocused();
    await expect(view('Table')).toHaveAttribute('aria-selected', 'true');
    const cells = page
      .getByRole('table', { name, exact: true })
      .getByRole('row')
      .nth(1)
      .getByRole('cell');
    await expect(cells.first()).toHaveText('001');
    assert.equal(
      await cells.last().textContent(),
      `first${separator}value\nsecond "line"`,
    );
    await expect(edit(name)).toBeHidden();
    await view('Text').click();
    if (name === 'Comma.csv') {
      await edit(name).fill('Part,Description\n002,Updated\n');
      await view('Table').click();
      await expect(cells.last()).toHaveText('Updated');
      await expect(button('Undo')).toBeDisabled();
      await view('Text').click();
      await expect(button('Undo')).toBeEnabled();
      await toolbar()
        .getByRole('button', { name: 'Save', exact: true })
        .click();
      await expect(tab(name)).toBeVisible();
      assert.equal(
        await readFile(path.join(project, name), 'utf8'),
        'Part,Description\r\n002,Updated\r\n',
      );
    }
    await button(`Close ${name}`).click();
  }

  await files().getByRole('button', { name: 'Divider.dzn' }).click();
  await files().getByRole('button', { name: 'Charging.dzn' }).click();
  await expect(tab('Charging.dzn')).toHaveAttribute('aria-pressed', 'true');
  await expect(saveAll()).toBeVisible();
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
  await expect(view('Preview')).toHaveAttribute('aria-selected', 'true');
  await expect(view('Preview')).toHaveClass(circuitTabClass);
  await expect(page.getByRole('heading', { name: 'Initial' })).toBeVisible();
  await view('Source').click();
  await edit('Notes.md').fill('# Reopened notes\n');
  await tab('Charging.dzn').click();
  await tab('Notes.md •').click();
  await button('Undo').click();
  await expect(edit('Notes.md')).toHaveValue('# Initial\n');
  await button('Redo').click();
  await expect(edit('Notes.md')).toHaveValue('# Reopened notes\n');
  await view('Preview').click();
  await expect(
    page.getByRole('heading', { name: 'Reopened notes' }),
  ).toBeVisible();
  await saveAll().click();
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
  await row('Assets renamed copy').click({ button: 'right' });
  const deleteItem = page.getByRole('menuitem', {
    name: 'Delete',
    exact: true,
  });
  await expect(
    deleteItem.locator('xpath=preceding-sibling::*[1]'),
  ).toHaveClass(/\bfui-MenuDivider\b/);
  await deleteItem.click();
  const deleteDialog = page.getByRole('dialog', {
    name: 'Delete',
    exact: true,
  });
  await expect(deleteDialog).toBeVisible();
  await expect(deleteItem).toHaveCount(0);
  await deleteDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(row('Assets renamed copy')).toBeVisible();
  await row('Assets renamed copy').press('Delete');
  await deleteDialog
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
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
  const changedNotes = working.locator('.project-git-file').filter({
    hasText: 'Notes.md',
  }).first();
  await expect(changedNotes.getByRole('button', { name: 'Notes.md' })).toHaveCount(0);
  await expect(source.getByText('Open Saved Changes', { exact: true })).toHaveCount(0);
  if (process.env.TINYCAD_TEST_PROJECT_SCREENSHOTS)
    await page.screenshot({
      path: path.join(
        process.env.TINYCAD_TEST_PROJECT_SCREENSHOTS,
        'source-control.png',
      ),
    });

  await view('Source').click();
  await edit('Notes.md').fill('# Unsaved notes\n');
  const stageWarning = page.getByRole('dialog', { name: 'Stage with unsaved edits?' });
  await source
    .getByRole('button', { name: 'Stage project files', exact: true })
    .click();
  await expect(stageWarning).toContainText('unsaved edits');
  await stageWarning.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(git('diff', '--cached', '--name-only'), '');

  await changedNotes.getByRole('button', { name: 'Stage', exact: true }).click();
  await stageWarning.getByRole('button', { name: 'Stage Saved Changes' }).click();
  await expect(staged.getByText('Notes.md', { exact: true })).toBeVisible();
  assert.equal(git('show', ':Notes.md'), '# Reopened notes');
  await source.getByRole('textbox', { name: 'Commit message' }).fill('Update notes');

  const commitReview = page.getByRole('dialog', { name: 'Commit staged changes' });
  await source.getByRole('button', { name: 'Review Commit' }).click();
  await expect(commitReview.getByRole('alert')).toContainText('unsaved edits');
  await commitReview.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(git('log', '-1', '--format=%s'), 'Initial project');

  await source.getByRole('button', { name: 'Review Commit' }).click();
  await commitReview.getByRole('button', { name: 'Commit', exact: true }).click();
  await expect.poll(() => git('log', '-1', '--format=%s')).toBe('Update notes');
  assert.equal(git('show', 'HEAD:Notes.md'), '# Reopened notes');
  await expect(edit('Notes.md')).toHaveValue('# Unsaved notes\n');
  await edit('Notes.md').fill('# Reopened notes\n');
  await view('Preview').click();
  await expect(source.getByRole('list', { name: 'Commit graph' })).toContainText('Update notes');
  await button('Files').click();
  await row('Notes.md').click({ button: 'right' });
  await expect(deleteItem).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: /^(File|Line) History$/ }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');

  await desktop.close();
  desktop = undefined;
  page = await launch();
  await expect(tab('Divider.dzn')).toBeVisible();
  await expect(tab('Charging.dzn')).toBeVisible();
  await expect(tab('Notes.md')).toHaveAttribute('aria-pressed', 'true');
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
