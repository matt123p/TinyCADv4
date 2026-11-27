import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { registerProjectFiles } from '../../electron/projectFiles.js';
import { runProjectGit } from '../../electron/projectGit.js';

test('graphs local branches and restores the checkout when a merge conflicts', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'tinycad-branch-merge-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const request = (options) => runProjectGit(root, options);
  const commit = async (value, message) => {
    await writeFile(path.join(root, 'Notes.txt'), value + '\n');
    git('add', 'Notes.txt');
    git('commit', '-qm', message);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'TinyCAD Tests');
  git('config', 'user.email', 'tinycad@example.test');
  await commit('Initial', 'Initial');
  await request({ command: 'create-branch', branch: 'feature' });
  await request({ command: 'switch-branch', branch: 'feature' });
  await commit('Feature', 'Feature change');
  await request({ command: 'switch-branch', branch: 'main' });
  const graph = await request({ command: 'branch-graph' });
  assert.ok(graph.some(({ subject }) => subject === 'Feature change'));
  await request({ command: 'merge-branch', branch: 'feature', into: 'main' });
  assert.equal(git('show', 'HEAD:Notes.txt'), 'Feature');
  await request({ command: 'switch-branch', branch: 'feature' });
  await commit('Other side', 'Other change');
  await request({ command: 'switch-branch', branch: 'main' });
  await commit('Current side', 'Current change');
  const before = git('rev-parse', 'HEAD');
  await assert.rejects(
    request({ command: 'merge-branch', branch: 'feature', into: 'main' }),
    /cancelled because the branches have conflicts/,
  );
  assert.equal(git('rev-parse', 'HEAD'), before);
  assert.equal(git('status', '--porcelain'), '');
  assert.equal((await readFile(path.join(root, 'Notes.txt'), 'utf8')).trim(), 'Current side');
});

test('shares the Git index and commit history with the installed client', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'tinycad-project-git-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'Design');
  await mkdir(folder);
  const mainFrame = {};
  const webContents = { mainFrame };
  let handler;
  registerProjectFiles({
    ipcMain: {
      handle: (_, callback) => {
        handler = callback;
      },
    },
    getWindow: () => ({ webContents }),
    store: { get: (_, fallback) => fallback },
    documents: folder,
  });
  const invoke = (request, at = folder) =>
    handler(
      { sender: webContents, senderFrame: mainFrame },
      { operation: 'git', folder: at, request },
    );
  const cli = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' });

  assert.equal(await invoke({ command: 'status' }), null);
  await assert.rejects(
    invoke({ command: 'status' }, root),
    /outside the project folder/,
  );
  cli('init', '-q', '-b', 'main');
  cli('config', 'user.email', 'tinycad@example.test');
  cli('config', 'user.name', 'TinyCAD Tests');
  cli('config', 'commit.gpgSign', 'false');
  const original = Array.from(
    { length: 20 },
    (_, index) => `Line ${index + 1}\n`,
  ).join('');
  await writeFile(path.join(folder, 'Notes.md'), original);
  await writeFile(path.join(folder, 'Board.dpn'), original);
  await writeFile(path.join(root, 'Outside.txt'), 'external');
  let snapshot = await invoke({ command: 'status' });
  assert.equal(snapshot.root, root);
  assert.equal(snapshot.branch, 'main');
  assert.equal(snapshot.scope, 'Design');
  assert.ok(
    snapshot.changes.some(
      (entry) => entry.path === 'Outside.txt' && entry.outside,
    ),
  );
  await assert.rejects(
    invoke({ command: 'diff', path: 'Outside.txt', staged: false }),
    /unavailable/,
  );
  const untracked = await invoke({
    command: 'diff',
    path: 'Design/Notes.md',
    staged: false,
  });
  assert.match(untracked.text, /new file mode/);
  assert.match(untracked.text, /\+Line 1/);
  snapshot = await invoke({ command: 'stage' });
  assert.equal(
    cli('diff', '--cached', '--name-only'),
    'Design/Board.dpn\nDesign/Notes.md\n',
  );
  snapshot = await invoke({ command: 'unstage', path: 'Design/Board.dpn' });
  assert.equal(cli('diff', '--cached', '--name-only'), 'Design/Notes.md\n');
  await invoke({ command: 'stage', path: 'Design/Board.dpn' });
  cli('add', 'Outside.txt');
  await assert.rejects(
    invoke({
      command: 'commit',
      message: 'Stale preview',
      token: snapshot.stagedToken,
    }),
    /staged changes changed/,
  );
  snapshot = await invoke({ command: 'status' });
  await invoke({
    command: 'commit',
    message: 'Initial design',
    token: snapshot.stagedToken,
  });
  assert.equal(cli('log', '-1', '--format=%s').trim(), 'Initial design');

  const changes = original
    .replace('Line 2\n', 'One change\n')
    .replace('Line 18\n', 'Another change\n');
  await writeFile(path.join(folder, 'Board.dpn'), changes);
  await writeFile(path.join(folder, 'Notes.md'), changes);
  const board = await invoke({
    command: 'diff',
    path: 'Design/Board.dpn',
    staged: false,
  });
  assert.equal(board.hunks.length, 0);
  assert.match(board.text, /One change/);
  const diff = await invoke({
    command: 'diff',
    path: 'Design/Notes.md',
    staged: false,
  });
  assert.equal(diff.hunks.length, 2);
  snapshot = await invoke({
    command: 'stage-hunk',
    path: 'Design/Notes.md',
    token: diff.token,
    hunk: 0,
  });
  const notes = snapshot.changes.find(({ path }) => path === 'Design/Notes.md');
  assert.equal(notes.index, 'M');
  assert.equal(notes.working, 'M');
  assert.match(cli('diff', '--cached', '--', 'Design/Notes.md'), /One change/);
  assert.doesNotMatch(
    cli('diff', '--cached', '--', 'Design/Notes.md'),
    /Another change/,
  );
  await assert.rejects(
    invoke({
      command: 'stage-hunk',
      path: 'Design/Notes.md',
      token: diff.token,
      hunk: 1,
    }),
    /diff changed/,
  );
  await invoke({
    command: 'commit',
    message: 'Stage a paragraph',
    token: snapshot.stagedToken,
  });
  const history = await invoke({ command: 'history', path: 'Design/Notes.md' });
  assert.deepEqual(
    history.map(({ subject }) => subject),
    ['Stage a paragraph', 'Initial design'],
  );
  assert.match(
    await invoke({ command: 'revision', id: history[0].id }),
    /One change/,
  );
  assert.doesNotMatch(
    await invoke({ command: 'revision', id: history[0].id }),
    /Another change/,
  );
});

test('clones into the chosen folder and synchronises only the active branch upstream', async (t) => {
  const area = await mkdtemp(path.join(tmpdir(), 'tinycad-git-remotes-'));
  t.after(() => rm(area, { recursive: true, force: true }));
  const remote = path.join(area, 'remote.git');
  const seed = path.join(area, 'Seed');
  const parent = path.join(area, 'Clones');
  for (const directory of [remote, seed, parent]) await mkdir(directory);
  const git = (cwd, ...args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  function identity(folder) {
    git(folder, 'config', 'user.email', 'tinycad@example.test');
    git(folder, 'config', 'user.name', 'TinyCAD Tests');
    git(folder, 'config', 'commit.gpgSign', 'false');
  }
  async function change(folder, name, message) {
    await writeFile(path.join(folder, name), message);
    git(folder, 'add', '--', name);
    git(folder, 'commit', '-qm', message);
  }
  git(remote, 'init', '-q', '--bare', '-b', 'main');
  git(seed, 'init', '-q', '-b', 'main');
  identity(seed);
  await change(seed, 'Notes.md', 'Initial');
  git(seed, 'remote', 'add', 'origin', remote);
  git(seed, 'push', '-qu', 'origin', 'main');

  const mainFrame = {};
  const webContents = { mainFrame };
  let handler;
  const preferences = new Map();
  registerProjectFiles({
    ipcMain: {
      handle: (_, callback) => {
        handler = callback;
      },
    },
    getWindow: () => ({ webContents }),
    documents: seed,
    store: {
      get: (key, fallback) => preferences.get(key) ?? fallback,
      set: (key, value) => preferences.set(key, value),
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [parent] }),
    },
  });
  const request = (payload) =>
    handler({ sender: webContents, senderFrame: mainFrame }, payload);
  const checkout = await request({
    operation: 'git-clone',
    source: remote,
    name: 'Checkout',
  });
  assert.equal(checkout.id, path.join(parent, 'Checkout'));
  const invoke = (payload) =>
    request({ operation: 'git', folder: checkout.id, request: payload });
  identity(checkout.id);

  let status = await invoke({ command: 'status' });
  assert.equal(status.upstream, 'origin/main');
  status = await invoke({ command: 'create-branch', branch: 'layout/routing' });
  assert.ok(status.branches.some(({ name }) => name === 'layout/routing'));
  status = await invoke({ command: 'switch-branch', branch: 'layout/routing' });
  assert.equal(status.branch, 'layout/routing');
  await invoke({ command: 'switch-branch', branch: 'main' });

  await change(seed, 'Incoming.txt', 'From remote');
  git(seed, 'push', '-q');
  status = await invoke({ command: 'fetch' });
  assert.equal(status.behind, 1);
  const [incoming] = await invoke({ command: 'incoming' });
  assert.equal(incoming.subject, 'From remote');
  assert.match(
    await invoke({ command: 'revision', id: incoming.id }),
    /From remote/,
  );
  status = await invoke({ command: 'pull' });
  assert.equal(status.behind, 0);
  assert.equal(
    git(checkout.id, 'log', '-1', '--format=%s').trim(),
    'From remote',
  );

  await change(checkout.id, 'Local.txt', 'From TinyCAD checkout');
  const [outgoing] = await invoke({ command: 'outgoing' });
  assert.equal(outgoing.subject, 'From TinyCAD checkout');
  status = await invoke({ command: 'sync' });
  assert.equal(status.ahead, 0);
  assert.equal(
    git(remote, 'log', '-1', '--format=%s').trim(),
    'From TinyCAD checkout',
  );

  await change(checkout.id, 'Diverged.txt', 'Local diverged');
  git(seed, 'pull', '--ff-only', '-q');
  await change(seed, 'Upstream.txt', 'Remote diverged');
  git(seed, 'push', '-q');
  await assert.rejects(
    invoke({ command: 'sync' }),
    /not possible to fast-forward/i,
  );
  assert.equal(
    git(remote, 'log', '-1', '--format=%s').trim(),
    'Remote diverged',
  );
  assert.equal(
    git(checkout.id, 'log', '-1', '--format=%s').trim(),
    'Local diverged',
  );
  status = await invoke({ command: 'status' });
  assert.equal(status.behind, 1);
  assert.equal(status.ahead, 1);
});

test('stages a three-way text result, whole binary version and selected deletion', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'tinycad-git-conflicts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const write = (name, bytes) => writeFile(path.join(root, name), bytes);
  const binary = (version) => Buffer.from([0, 255, version]);
  const mainFrame = {};
  const webContents = { mainFrame };
  let handler;
  registerProjectFiles({
    ipcMain: {
      handle: (_, callback) => {
        handler = callback;
      },
    },
    getWindow: () => ({ webContents }),
    documents: root,
    store: { get: (_, fallback) => fallback },
  });
  const request = (payload) =>
    handler(
      { sender: webContents, senderFrame: mainFrame },
      { operation: 'git', folder: root, request: payload },
    );
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'tinycad@example.test');
  git('config', 'user.name', 'TinyCAD Tests');
  git('config', 'commit.gpgSign', 'false');

  await write('Notes.md', 'base notes\n');
  await write('Board.dpn', binary(1));
  await write('Old.csv', 'base\n');
  git('add', '--all');
  git('commit', '-qm', 'Base');
  git('switch', '-qc', 'revision');
  await write('Notes.md', 'incoming notes\n');
  await write('Board.dpn', binary(3));
  git('rm', '-q', 'Old.csv');
  git('commit', '-qam', 'Incoming');
  git('switch', '-q', 'main');
  await write('Notes.md', 'current notes\n');
  await write('Board.dpn', binary(2));
  await write('Old.csv', 'changed locally\n');
  git('commit', '-qam', 'Current');
  assert.throws(
    () => git('merge', 'revision'),
    ({ status }) => status === 1,
  );

  let conflict = await request({ command: 'conflict', path: 'Notes.md' });
  assert.equal(conflict.editable, true);
  assert.deepEqual(
    conflict.versions.map(({ text }) => text),
    ['base notes\n', 'current notes\n', 'incoming notes\n'],
  );
  await assert.rejects(
    request({
      command: 'resolve-conflict',
      path: 'Notes.md',
      token: conflict.token,
      choice: 'text',
      text: conflict.result,
    }),
    /merge markers/,
  );
  await write('Notes.md', 'edited after preview\n');
  await assert.rejects(
    request({
      command: 'resolve-conflict',
      path: 'Notes.md',
      token: conflict.token,
      choice: 'text',
      text: 'stale result\n',
    }),
    /conflict changed/,
  );

  conflict = await request({ command: 'conflict', path: 'Notes.md' });
  await request({
    command: 'resolve-conflict',
    path: 'Notes.md',
    token: conflict.token,
    choice: 'text',
    text: 'merged notes\n',
  });
  assert.equal(git('show', ':Notes.md'), 'merged notes\n');

  conflict = await request({ command: 'conflict', path: 'Board.dpn' });
  assert.equal(conflict.editable, false);
  assert.deepEqual(
    conflict.versions.map(({ size }) => size),
    [3, 3, 3],
  );
  const incoming = conflict.versions[2].id;
  await request({
    command: 'resolve-conflict',
    path: 'Board.dpn',
    token: conflict.token,
    choice: 'theirs',
  });
  assert.equal(git('rev-parse', ':Board.dpn').trim(), incoming);

  conflict = await request({ command: 'conflict', path: 'Old.csv' });
  assert.equal(conflict.versions[2], null);
  await request({
    command: 'resolve-conflict',
    path: 'Old.csv',
    token: conflict.token,
    choice: 'theirs',
  });
  assert.equal(git('ls-files', '-u'), '');
  assert.match(git('diff', '--cached', '--name-status'), /D\tOld\.csv/);
});

test('shares stash, worktrees and published upstream with the Git CLI', async (t) => {
  const area = await mkdtemp(path.join(tmpdir(), 'tinycad-project-controls-'));
  t.after(() => rm(area, { recursive: true, force: true }));
  const root = path.join(area, 'Project');
  const remote = path.join(area, 'Remote');
  await mkdir(root);
  const cli = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const frame = {};
  const webContents = { mainFrame: frame };
  let handler;
  registerProjectFiles({
    ipcMain: { handle: (_, callback) => { handler = callback; } },
    getWindow: () => ({ webContents }),
    documents: root,
    store: { get: (_, fallback) => fallback },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [area] }) },
  });
  const request = (payload) => handler({ sender: webContents, senderFrame: frame }, payload);
  const git = (command, fields) => request({ operation: 'git', folder: root, request: { command, ...fields } });
  cli('init', '-q', '-b', 'main');
  cli('config', 'user.email', 'tinycad@example.test');
  cli('config', 'user.name', 'TinyCAD Tests');
  cli('config', 'commit.gpgSign', 'false');
  await writeFile(path.join(root, 'Readme.txt'), 'Base\n');
  cli('add', '.');
  cli('commit', '-qm', 'Initial');
  cli('init', '--bare', '-q', remote);
  cli('remote', 'add', 'origin', remote);
  assert.equal((await git('publish-branch', { remote: 'origin' })).upstream, 'origin/main');
  await writeFile(path.join(root, 'Readme.txt'), 'Extra\nBase\nSelected\n');
  const pathspec = { path: 'Readme.txt' };
  const partial = await git('diff', { ...pathspec, staged: false });
  await git('stage-lines', { ...pathspec, token: partial.token, lines: [{ type: 'insert', line: 3 }] });
  assert.equal(cli('show', ':Readme.txt'), 'Base\nSelected');
  const indexed = await git('diff', { ...pathspec, staged: true });
  await git('unstage-lines', { ...pathspec, token: indexed.token, lines: [{ type: 'insert', line: 2 }] });
  assert.equal(cli('show', ':Readme.txt'), 'Base');
  assert.equal(await readFile(path.join(root, 'Readme.txt'), 'utf8'), 'Extra\nBase\nSelected\n');
  await writeFile(path.join(root, 'Readme.txt'), 'Local edit\n');
  cli('add', 'Readme.txt');
  assert.equal((await git('stash-create', { message: 'Workbench' })).changes.length, 0);
  const [stash] = await git('stash-list');
  assert.match(stash.subject, /Workbench/);
  await assert.rejects(git('stash-pop', { ...stash, id: 'invalid' }), /changed/);
  assert.match((await git('stash-pop', stash)).changes[0].index, /M/);
  assert.deepEqual(await git('stash-list'), []);
  const [initial] = await git('graph');
  assert.equal(initial.subject, 'Initial');
  assert.match(await git('blame', { path: 'Readme.txt' }), /Local edit/);
  cli('tag', 'baseline');
  cli('commit', '-qm', 'Local commit');
  const [latest] = await git('graph');
  const reference = (await git('references')).find(({ ref }) => ref === 'refs/tags/baseline');
  assert.match(await git('compare', { id: latest.id, ref: reference.ref }), /\+Local edit/);
  await assert.rejects(git('compare', { id: latest.id, ref: '--outside' }), /existing branch or tag/);

  await assert.rejects(request({ operation: 'worktree-open', folder: root, id: remote }), /unavailable/);
  const clean = await request({
    operation: 'worktree-add', folder: root, name: 'Clean copy', branch: 'experiment', createBranch: true,
  });
  assert.equal(clean.id, path.join(area, 'Clean copy'));
  assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: clean.id, encoding: 'utf8' }).trim(), 'experiment');
  assert.ok((await request({ operation: 'worktree-list', folder: root })).some((entry) => entry.id === clean.id));
  assert.deepEqual(await request({ operation: 'worktree-open', folder: root, id: clean.id }), clean);
});
