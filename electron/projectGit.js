import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { devNull } from 'node:os';
import { validProjectName } from '../shared/projectFiles.js';

const maxOutput = 8 * 1024 * 1024;
const maxMergeText = 512 * 1024;
const digest = (text) => createHash('sha256').update(text).digest('hex');
const absent = /not a git repository/i;
const wholeFile = /\.(?:dsn|dzn|dpn|tcproject|tclib|tplib)$/i;

function git(
  cwd,
  args,
  { input, accept = [0], timeout = 30000, encoding = 'utf8' } = {},
) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };
  for (const key of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_COMMON_DIR',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_NAMESPACE',
  ])
    delete env[key];
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      [
        '--literal-pathspecs',
        '-c',
        `core.hooksPath=${devNull}`,
        '-c',
        'core.fsmonitor=false',
        '-c',
        'protocol.ext.allow=never',
        ...args,
      ],
      { cwd, env, windowsHide: true, timeout, maxBuffer: maxOutput, encoding },
      (error, stdout, stderr) => {
        if (!error || accept.includes(error.code)) return resolve(stdout);
        if (error.code === 'ENOENT')
          return reject(
            new Error(
              'Git is unavailable. Install Git and restart TinyCAD with Git on PATH.',
            ),
          );
        if (error.killed)
          return reject(new Error('Git did not finish before the time limit.'));
        reject(new Error(String(stderr || error.message).trim()));
      },
    );
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function inside(scope, name) {
  return !scope || name.startsWith(scope + '/');
}

export function parseGitStatus(text, scope = '') {
  let head = '';
  let branch = '';
  let upstream;
  let ahead = 0;
  let behind = 0;
  const changes = [];
  const entries = text.split('\0');
  for (let i = 0; i < entries.length; ++i) {
    const record = entries[i];
    if (!record) continue;
    if (record.startsWith('# branch.')) {
      const [, value, extra] = record.split(' ');
      // The record prefix contains a space between # and branch.*.
      if (value === 'branch.oid') head = extra;
      else if (value === 'branch.head') branch = record.slice(14);
      else if (value === 'branch.upstream') upstream = record.slice(18);
      else if (value === 'branch.ab') {
        ahead = Number(extra.slice(1));
        behind = Number(record.split(' ')[3].slice(1));
      }
      continue;
    }
    const kind = record[0];
    if (!['1', '2', 'u', '?'].includes(kind)) continue;
    const fields = record.split(' ');
    const offset = kind === '1' ? 8 : kind === '2' ? 9 : kind === 'u' ? 10 : 1;
    const filename = fields.slice(offset).join(' ');
    const original = kind === '2' ? entries[++i] : undefined;
    const [index, working] = kind === '?' ? ['.', '?'] : fields[1];
    changes.push({
      path: filename,
      original,
      index,
      working,
      indexedObject: kind === '1' || kind === '2' ? fields[7] : undefined,
      indexMode: kind === '1' || kind === '2' ? fields[4] : undefined,
      conflicted: kind === 'u',
      outside:
        !inside(scope, filename) || (!!original && !inside(scope, original)),
    });
  }
  const staged = changes.filter(
    ({ index, conflicted }) => index !== '.' && !conflicted,
  );
  const stagedToken = digest(
    JSON.stringify([
      head,
      staged.map((entry) => [
        entry.path,
        entry.original,
        entry.index,
        entry.indexedObject,
        entry.indexMode,
      ]),
    ]),
  );
  return { head, branch, upstream, ahead, behind, changes, stagedToken };
}

async function repository(folder) {
  try {
    return await fs.realpath(
      (
        await git(folder, ['rev-parse', '--show-toplevel'])
      ).replace(/\r?\n$/, ''),
    );
  } catch (error) {
    if (absent.test(error.message)) return null;
    throw error;
  }
}

async function status(root, folder) {
  const scope = path.relative(root, folder).split(path.sep).join('/');
  const [changes, refs, remotes] = await Promise.all([
    git(root, [
      'status',
      '--porcelain=v2',
      '-z',
      '--branch',
      '--untracked-files=all',
    ]),
    git(root, [
      'for-each-ref',
      '--format=%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:remotename)%00%(upstream:remoteref)',
      'refs/heads',
    ]),
    git(root, ['remote']),
  ]);
  return {
    root,
    scope,
    ...parseGitStatus(changes, scope),
    branches: refs
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, id, upstream, remote, target] = line.split('\0');
        return { name, id, upstream, remote, target };
      }),
    remotes: remotes.trim().split('\n').filter(Boolean),
  };
}

export async function cloneProjectGit(parent, source, name) {
  if (
    typeof source !== 'string' ||
    !source.trim() ||
    /[\x00-\x1f]/.test(source) ||
    !validProjectName(name) ||
    name.toLowerCase() === '.git'
  )
    throw new Error('Enter a repository location and a folder name.');
  const destination = path.join(parent, name);
  try {
    await fs.lstat(destination);
    throw new Error('A file or folder already has that name.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await git(
    parent,
    ['clone', '--no-recurse-submodules', '--', source.trim(), name],
    { timeout: 180000 },
  );
  return { id: await fs.realpath(destination), name };
}

function upstreamFor(snapshot) {
  const branch = snapshot.branches.find(({ name }) => name === snapshot.branch);
  if (!branch?.remote || !branch.target?.startsWith('refs/heads/'))
    throw new Error('Set an upstream branch in Git before synchronising.');
  return branch;
}

const diffOptions = ['--no-color', '--no-ext-diff', '--no-textconv'];

function diffHunks(text) {
  const starts = [...text.matchAll(/^@@ .* @@.*$/gm)];
  return {
    header: starts.length ? text.slice(0, starts[0].index) : '',
    hunks: starts.map(({ index }, i) =>
      text.slice(index, starts[i + 1]?.index),
    ),
  };
}

function patchForLines(text, lines, reverse) {
  if (!Array.isArray(lines) || !lines.length || lines.length > 5000)
    throw new Error('Select changed lines in the diff first.');
  const selected = new Set(
    lines.map((line) => {
      if (
        !line ||
        (line.type !== 'insert' && line.type !== 'delete') ||
        !Number.isSafeInteger(line.line) ||
        line.line < 1
      )
        throw new Error('Invalid diff line selection.');
      return line.type + line.line;
    }),
  );
  const { header, hunks } = diffHunks(text);
  const result = [];
  let delta = 0;
  for (const hunk of hunks) {
    const [range, ...sourceLines] = hunk.replace(/\n$/, '').split('\n');
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(range);
    if (!match) continue;
    let oldLine = Number(match[1]);
    let newLine = Number(match[2]);
    const start = reverse ? newLine : oldLine;
    const patch = [];
    let before = 0;
    let after = 0;
    let changed = false;
    let emitted = false;
    for (const line of sourceLines) {
      const prefix = line[0];
      if (prefix === '\\') {
        if (emitted) patch.push(line);
        continue;
      }
      const key = prefix === '-' ? 'delete' + oldLine : 'insert' + newLine;
      if (prefix !== '+') oldLine++;
      if (prefix !== '-') newLine++;
      const change = prefix === '+' || prefix === '-';
      const apply = change && selected.delete(key);
      const inBase = reverse ? prefix !== '-' : prefix !== '+';
      emitted = !change || apply || inBase;
      if (!emitted) continue;
      const output = apply ? (inBase ? '-' : '+') : ' ';
      if (output !== '+') before++;
      if (output !== '-') after++;
      changed ||= apply;
      patch.push(output + line.slice(1));
    }
    if (!changed) continue;
    const ending = start + delta + (before === 0 ? 1 : after === 0 ? -1 : 0);
    result.push(
      `@@ -${start},${before} +${Math.max(0, ending)},${after} @@\n${patch.join(
        '\n',
      )}\n`,
    );
    delta += after - before;
  }
  if (selected.size || !result.length)
    throw new Error(
      'The selected lines changed. Refresh the diff and try again.',
    );
  return (
    header.replace(/^(?:index |old mode |new mode ).*\n/gm, '') +
    result.join('')
  );
}

async function workingDiff(root, entry, staged) {
  const files = [...new Set([entry.path, entry.original].filter(Boolean))];
  if (!staged && entry.working === '?') {
    return git(
      root,
      ['diff', ...diffOptions, '--no-index', '--', devNull, entry.path],
      { accept: [0, 1] },
    );
  }
  return git(root, [
    'diff',
    ...diffOptions,
    ...(staged ? ['--cached'] : []),
    '--',
    ...files,
  ]);
}

function pathsFor(entries, stage) {
  return [
    ...new Set(
      entries.flatMap((entry) => [
        entry.path,
        ...((!stage || entry.working === 'R' || entry.working === 'C') &&
        entry.original
          ? [entry.original]
          : []),
      ]),
    ),
  ];
}

function historyRecords(raw) {
  const fields = raw.split('\0');
  const commits = [];
  for (let i = 0; i + 4 < fields.length; i += 5) {
    commits.push({
      id: fields[i],
      short: fields[i + 1],
      parents: fields[i + 2].split(' ').filter(Boolean),
      date: fields[i + 3],
      subject: fields[i + 4],
    });
  }
  return commits;
}

const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function mergeText(bytes) {
  if (bytes.includes(0)) return;
  try {
    return textDecoder.decode(bytes);
  } catch {
    return;
  }
}

async function assertConflictParent(root, folder) {
  try {
    if ((await fs.realpath(folder)) !== folder)
      throw new Error('Resolve this symbolic-link conflict in Git.');
  } catch (error) {
    if (error.code !== 'ENOENT' || folder === root) throw error;
    await assertConflictParent(root, path.dirname(folder));
  }
}

async function workingConflict(filename) {
  let file;
  try {
    const current = await fs.lstat(filename);
    if (!current.isFile())
      throw new Error('Resolve this file type conflict in Git.');
    file = await fs.open(
      filename,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
    );
  } catch (error) {
    if (error.code === 'ENOENT') return { digest: null, mode: null };
    throw error;
  }
  try {
    const initial = await file.stat();
    let text;
    const hash = createHash('sha256');
    if (initial.size <= maxMergeText) {
      const bytes = await file.readFile();
      hash.update(bytes);
      text = mergeText(bytes);
    } else {
      for await (const block of file.createReadStream({ autoClose: false }))
        hash.update(block);
    }
    const end = await file.stat();
    if (
      initial.size !== end.size ||
      initial.mtimeMs !== end.mtimeMs ||
      initial.mode !== end.mode
    )
      throw new Error('The working file changed. Reopen the conflict.');
    return { digest: hash.digest('hex'), mode: initial.mode & 0o777, text };
  } finally {
    await file.close();
  }
}

async function readConflict(root, entry) {
  if (!entry.conflicted)
    throw new Error('This file has no unresolved conflict.');
  const name = entry.path;
  const parts = name.split('/');
  if (
    parts.some(
      (part) => !validProjectName(part) || part.toLowerCase() === '.git',
    )
  )
    throw new Error('Resolve this file name conflict in Git.');
  const filename = path.join(root, ...parts);
  await assertConflictParent(root, path.dirname(filename));
  const [index, working] = await Promise.all([
    git(root, ['ls-files', '--unmerged', '-z', '--', name]),
    workingConflict(filename),
  ]);
  if (!index) throw new Error('The conflict changed. Refresh Source Control.');
  const entries = index
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [header] = line.split('\t', 1);
      const [mode, id, stage] = header.split(' ');
      if (!/^100(?:644|755)$/.test(mode) || !/^[a-f0-9]{40,64}$/.test(id))
        throw new Error('Resolve this file type conflict in Git.');
      return { mode, id, stage: Number(stage) };
    });
  const versions = await Promise.all(
    [1, 2, 3].map(async (stage) => {
      const version = entries.find((entry) => entry.stage === stage);
      if (!version) return null;
      const size = Number(await git(root, ['cat-file', '-s', version.id]));
      const text =
        size <= maxMergeText
          ? mergeText(
              await git(root, ['cat-file', 'blob', version.id], {
                encoding: 'buffer',
              }),
            )
          : undefined;
      return {
        id: version.id,
        size,
        text,
        executable: version.mode === '100755',
      };
    }),
  );
  const editable =
    !wholeFile.test(name) &&
    versions.every((item) => !item || item.text !== undefined) &&
    (working.digest === null || working.text !== undefined);
  return {
    path: name,
    versions,
    editable,
    result: editable
      ? working.text ?? versions[1]?.text ?? versions[2]?.text ?? ''
      : undefined,
    token: digest(JSON.stringify([index, working.digest, working.mode])),
    filename,
    mode: working.mode,
  };
}

async function resolveConflict(root, entry, request) {
  const conflict = await readConflict(root, entry);
  if (conflict.token !== request.token)
    throw new Error('The conflict changed. Reopen it before resolving.');
  if (request.choice === 'ours' || request.choice === 'theirs') {
    const stage = request.choice === 'ours' ? 2 : 3;
    if (conflict.versions[stage - 1]) {
      await git(root, [
        'checkout-index',
        '--force',
        '--stage=' + stage,
        '--',
        entry.path,
      ]);
      await git(root, ['add', '--', entry.path]);
    } else {
      await git(root, ['rm', '-f', '--', entry.path]);
    }
    return;
  }
  if (
    request.choice !== 'text' ||
    !conflict.editable ||
    typeof request.text !== 'string'
  )
    throw new Error('Select a whole version for this file.');
  if (/^(?:<{7,} |>{7,} |\|{7,} )/m.test(request.text))
    throw new Error(
      'Finish editing the merge markers before saving the result.',
    );
  const source = conflict.result;
  const crlf =
    source.includes('\r\n') && !source.replaceAll('\r\n', '').includes('\n');
  const content = Buffer.from(
    crlf ? request.text.replace(/\r?\n/g, '\r\n') : request.text,
    'utf8',
  );
  if (content.length > maxMergeText)
    throw new Error('The edited result exceeds the merge editor size limit.');
  const folder = path.dirname(conflict.filename);
  await fs.mkdir(folder, { recursive: true });
  const temp = path.join(folder, `.tinycad-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temp, content, {
      flag: 'wx',
      mode: conflict.mode ?? 0o644,
    });
    await fs.rename(temp, conflict.filename);
  } finally {
    await fs.unlink(temp).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  await git(root, ['add', '--', entry.path]);
}

export async function projectWorktrees(folder) {
  const root = await repository(folder);
  if (!root) throw new Error('Open a Git repository first.');
  const output = await git(root, ['worktree', 'list', '--porcelain', '-z']);
  return output
    .split('\0\0')
    .filter(Boolean)
    .map((record) => {
      const fields = record.split('\0');
      const field = (key) =>
        fields
          .find((line) => line.startsWith(key + ' '))
          ?.slice(key.length + 1);
      return {
        id: field('worktree'),
        branch: field('branch')?.replace(/^refs\/heads\//, ''),
        head: field('HEAD'),
        bare: fields.includes('bare'),
        prunable: fields.some(
          (line) => line === 'prunable' || line.startsWith('prunable '),
        ),
      };
    });
}

export async function addProjectWorktree(folder, target, branch, createBranch) {
  const root = await repository(folder);
  if (!root) throw new Error('Open a Git repository first.');
  if (
    typeof branch !== 'string' ||
    !branch ||
    branch.startsWith('-') ||
    branch.includes('@{')
  )
    throw new Error('Enter a valid branch name.');
  await git(root, ['check-ref-format', '--branch', branch]);
  if (!createBranch)
    await git(root, ['show-ref', '--verify', 'refs/heads/' + branch]);
  const exists = await fs.lstat(target).then(
    () => true,
    (error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );
  if (exists) throw new Error('A file or folder already has that name.');
  await git(root, [
    'worktree',
    'add',
    ...(createBranch ? ['-b', branch, '--', target] : ['--', target, branch]),
  ]);
}

async function listStashes(root) {
  const output = await git(root, [
    'stash',
    'list',
    '-z',
    '--format=%H%x00%gd%x00%gs',
  ]);
  const fields = output.split('\0');
  const stashes = [];
  for (let i = 0; i + 2 < fields.length; i += 3)
    stashes.push({ id: fields[i], ref: fields[i + 1], subject: fields[i + 2] });
  return stashes;
}

async function visibleRevision(root, snapshot, id) {
  if (typeof id !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(id))
    throw new Error('Invalid commit identity.');
  const references = snapshot.upstream ? ['HEAD', '@{upstream}'] : ['HEAD'];
  const visible = await Promise.all(
    references.map(async (ref) => {
      try {
        await git(root, ['merge-base', '--is-ancestor', id, ref]);
        return true;
      } catch {
        return false;
      }
    }),
  );
  if (!visible.includes(true))
    throw new Error('This revision is outside the active branch history.');
}

async function comparisonReferences(root) {
  const refs = await git(root, [
    'for-each-ref',
    '--format=%(refname)%00%(refname:short)%00%(symref)',
    'refs/heads',
    'refs/remotes',
    'refs/tags',
  ]);
  return refs
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const [ref, name, symbolic] = line.split('\0');
      return symbolic ? [] : [{ ref, name }];
    });
}

function projectFilePath(snapshot, name) {
  if (
    typeof name !== 'string' ||
    !inside(snapshot.scope, name) ||
    name.split('/').some((part) => !validProjectName(part))
  )
    throw new Error('This file is outside the project.');
  return name;
}

export async function runProjectGit(folder, request) {
  const root = await repository(folder);
  if (request.command === 'status') return root ? status(root, folder) : null;
  if (request.command === 'init') {
    if (root) throw new Error('This folder is already in a Git repository.');
    await git(folder, ['init', '--', '.']);
    return status(folder, folder);
  }
  if (!root) throw new Error('Open a folder with a Git repository first.');
  const snapshot = await status(root, folder);
  const find = (name) => {
    const entry = snapshot.changes.find((change) => change.path === name);
    if (!entry || entry.outside)
      throw new Error('This change is unavailable in the selected project.');
    return entry;
  };
  switch (request.command) {
    case 'stage':
    case 'unstage': {
      const stage = request.command === 'stage';
      const targets =
        request.path === undefined
          ? snapshot.changes.filter(({ outside }) => !outside)
          : [find(request.path)];
      const applicable = targets.filter(
        (entry) =>
          !entry.conflicted &&
          (stage ? entry.working !== '.' : entry.index !== '.'),
      );
      const files = pathsFor(applicable, stage);
      if (!files.length) return snapshot;
      const args = stage
        ? ['add', '--all']
        : snapshot.head === '(initial)'
        ? ['rm', '--cached', '--quiet', '-r', '-f']
        : ['reset', '--quiet', 'HEAD'];
      await git(
        root,
        [...args, '--pathspec-from-file=-', '--pathspec-file-nul'],
        { input: files.join('\0') + '\0' },
      );
      return status(root, folder);
    }
    case 'discard': {
      const entry = find(request.path);
      if (entry.working === '?' || entry.working === '.' || entry.conflicted)
        throw new Error('This change cannot be restored from the Git index.');
      const text = await workingDiff(root, entry, false);
      if (digest(text) !== request.token)
        throw new Error('The diff changed. Refresh it before discarding.');
      await git(root, [
        'restore',
        '--worktree',
        '--',
        ...pathsFor([entry], true),
      ]);
      return status(root, folder);
    }
    case 'conflict': {
      const { filename, mode, ...conflict } = await readConflict(
        root,
        find(request.path),
      );
      return conflict;
    }
    case 'resolve-conflict':
      await resolveConflict(root, find(request.path), request);
      return status(root, folder);
    case 'diff': {
      const entry = find(request.path);
      const text = await workingDiff(root, entry, request.staged === true);
      const partial =
        (request.staged ? entry.index : entry.working) === 'M' &&
        !entry.original &&
        !wholeFile.test(entry.path);
      return {
        text,
        hunks: partial ? diffHunks(text).hunks : [],
        token: digest(text),
      };
    }
    case 'stage-hunk':
    case 'unstage-hunk':
    case 'stage-lines':
    case 'unstage-lines': {
      const entry = find(request.path);
      const reverse = request.command.startsWith('unstage');
      if (
        (reverse ? entry.index : entry.working) !== 'M' ||
        entry.original ||
        wholeFile.test(entry.path)
      )
        throw new Error('Apply this change as a whole file.');
      const text = await workingDiff(root, entry, reverse);
      if (digest(text) !== request.token)
        throw new Error('The diff changed. Refresh it before staging.');
      const part = request.command.endsWith('-lines');
      const { header, hunks } = diffHunks(text);
      if (!part && (!Number.isInteger(request.hunk) || !hunks[request.hunk]))
        throw new Error('The diff changed. Refresh it before staging.');
      await git(
        root,
        [
          'apply',
          '--cached',
          ...(reverse && !part ? ['--reverse'] : []),
          '--whitespace=nowarn',
          '-',
        ],
        {
          input: part
            ? patchForLines(text, request.lines, reverse)
            : header + hunks[request.hunk],
        },
      );
      return status(root, folder);
    }
    case 'commit': {
      const message =
        typeof request.message === 'string' ? request.message.trim() : '';
      if (!message || message.length > 10000)
        throw new Error('Enter a commit message of up to 10,000 characters.');
      if (request.token !== snapshot.stagedToken)
        throw new Error(
          'The staged changes changed. Review them before committing.',
        );
      if (
        !snapshot.changes.some(
          ({ index, conflicted }) => index !== '.' && !conflicted,
        )
      )
        throw new Error('Stage changes before committing.');
      if (snapshot.changes.some(({ conflicted }) => conflicted))
        throw new Error('Resolve conflicts before committing.');
      await git(root, ['commit', '-m', message]);
      return status(root, folder);
    }
    case 'create-branch': {
      const branch = request.branch;
      if (
        typeof branch !== 'string' ||
        branch.startsWith('-') ||
        branch.includes('@{')
      )
        throw new Error('Enter a valid branch name.');
      await git(root, ['check-ref-format', '--branch', branch]);
      await git(root, ['branch', '--', branch]);
      return status(root, folder);
    }
    case 'switch-branch': {
      if (!snapshot.branches.some(({ name }) => name === request.branch))
        throw new Error('Select an existing local branch.');
      await git(root, ['switch', '--no-guess', '--', request.branch]);
      return status(root, folder);
    }
    case 'publish-branch':
      if (
        snapshot.head === '(initial)' ||
        !snapshot.branches.some(({ name }) => name === snapshot.branch) ||
        !snapshot.remotes.includes(request.remote)
      )
        throw new Error('Select a Git remote and a local branch with commits.');
      await git(
        root,
        [
          'push',
          '--set-upstream',
          '--',
          request.remote,
          'HEAD:refs/heads/' + snapshot.branch,
        ],
        { timeout: 180000 },
      );
      return status(root, folder);
    case 'stash-list':
    case 'stash-create':
    case 'stash-apply':
    case 'stash-pop':
    case 'stash-drop': {
      if (snapshot.scope)
        throw new Error('Open the repository root to manage its stashes.');
      if (request.command === 'stash-list') return listStashes(root);
      if (request.command === 'stash-create') {
        const message =
          typeof request.message === 'string'
            ? request.message.trim().slice(0, 1000)
            : '';
        await git(root, [
          'stash',
          'push',
          '--include-untracked',
          ...(message ? ['--message', message] : []),
        ]);
      } else {
        const item = (await listStashes(root)).find(
          ({ id, ref }) => id === request.id && ref === request.ref,
        );
        if (!item)
          throw new Error('The stash list changed. Refresh and try again.');
        const action = request.command.slice('stash-'.length);
        await git(root, [
          'stash',
          action,
          ...(action === 'drop' ? [] : ['--index']),
          item.ref,
        ]);
      }
      return status(root, folder);
    }
    case 'fetch':
      await git(root, ['fetch', '--all', '--no-recurse-submodules'], {
        timeout: 180000,
      });
      return status(root, folder);
    case 'pull':
    case 'push':
    case 'sync': {
      const { remote, target } = upstreamFor(snapshot);
      if (request.command !== 'push')
        await git(
          root,
          [
            'pull',
            '--ff-only',
            '--no-rebase',
            '--no-recurse-submodules',
            '--',
            remote,
            target,
          ],
          { timeout: 180000 },
        );
      if (request.command !== 'pull')
        await git(root, ['push', '--', remote, 'HEAD:' + target], {
          timeout: 180000,
        });
      return status(root, folder);
    }
    case 'incoming':
    case 'outgoing': {
      if (!snapshot.upstream) return [];
      const range =
        request.command === 'incoming'
          ? 'HEAD..@{upstream}'
          : '@{upstream}..HEAD';
      return historyRecords(
        await git(root, [
          'log',
          '-n',
          '50',
          '-z',
          '--format=%H%x00%h%x00%P%x00%as%x00%s',
          range,
          '--',
        ]),
      );
    }
    case 'graph': {
      if (snapshot.head === '(initial)') return [];
      return historyRecords(
        await git(root, [
          'log',
          '--topo-order',
          '-n',
          '50',
          '-z',
          '--format=%H%x00%h%x00%P%x00%as%x00%s',
          'HEAD',
          ...(snapshot.upstream ? ['@{upstream}'] : []),
          '--',
        ]),
      );
    }
    case 'references':
      return comparisonReferences(root);
    case 'compare': {
      await visibleRevision(root, snapshot, request.id);
      const reference = (await comparisonReferences(root)).find(
        ({ ref }) => ref === request.ref,
      );
      if (!reference) throw new Error('Select an existing branch or tag.');
      return git(root, [
        'diff',
        ...diffOptions,
        reference.ref,
        request.id,
        '--',
        snapshot.scope || '.',
      ]);
    }
    case 'blame': {
      const name = projectFilePath(snapshot, request.path);
      if (wholeFile.test(name))
        throw new Error('Line history is available for text files.');
      return git(root, ['blame', '--date=short', '--', name]);
    }
    case 'history': {
      if (snapshot.head === '(initial)') return [];
      const name =
        request.path === undefined
          ? undefined
          : projectFilePath(snapshot, request.path);
      return historyRecords(
        await git(root, [
          'log',
          '-n',
          '50',
          '-z',
          '--format=%H%x00%h%x00%P%x00%as%x00%s',
          ...(name ? ['--follow', '--', name] : []),
        ]),
      );
    }
    case 'revision': {
      await visibleRevision(root, snapshot, request.id);
      return git(root, [
        'show',
        ...diffOptions,
        '--format=fuller',
        request.id,
        '--',
        snapshot.scope || '.',
      ]);
    }
    default:
      throw new Error('Unknown project Git operation.');
  }
}
