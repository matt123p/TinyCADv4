import { activateProjectFolder, assertProjectCanOpen, projectRequest } from './projects';
import type { docDrawing } from '../state/undo/undo';

export type GitChange = {
  path: string;
  original?: string;
  index: string;
  working: string;
  conflicted: boolean;
  outside: boolean;
};

export type GitSnapshot = {
  root: string;
  scope: string;
  branch: string;
  head: string;
  upstream?: string;
  ahead: number;
  behind: number;
  branches: { name: string; id: string; upstream?: string }[];
  remotes: string[];
  changes: GitChange[];
  stagedToken: string;
};

export type GitConflict = {
  path: string;
  versions: (null | {
    id: string;
    size: number;
    text?: string;
    executable: boolean;
  })[];
  editable: boolean;
  result?: string;
  token: string;
};

export type GitResolution =
  | { choice: 'ours' | 'theirs' }
  | { choice: 'text'; text: string };

export type GitDiffLine = { type: 'insert' | 'delete'; line: number };
export type GitDiff = { text: string; hunks: string[]; token: string };
export type GitCommit = {
  id: string;
  short: string;
  parents: string[];
  date: string;
  subject: string;
};

export type GitStash = { id: string; ref: string; subject: string };
export type GitWorktree = {
  id: string;
  branch?: string;
  head?: string;
  bare: boolean;
  prunable: boolean;
};

export type GitRequest =
  | {
      command:
        | 'status'
        | 'init'
        | 'fetch'
        | 'pull'
        | 'push'
        | 'sync'
        | 'incoming'
        | 'outgoing'
        | 'graph'
        | 'branch-graph'
        | 'stash-list'
        | 'references';
    }
  | { command: 'create-branch' | 'switch-branch'; branch: string }
  | { command: 'merge-branch'; branch: string; into: string }
  | { command: 'stage' | 'unstage' | 'history'; path?: string }
  | { command: 'publish-branch'; remote: string }
  | { command: 'stash-create'; message?: string }
  | ({ command: 'stash-apply' | 'stash-pop' | 'stash-drop' } & Pick<
      GitStash,
      'id' | 'ref'
    >)
  | { command: 'conflict'; path: string }
  | ({
      command: 'resolve-conflict';
      path: string;
      token: string;
    } & GitResolution)
  | { command: 'diff'; path: string; staged: boolean }
  | {
      command: 'stage-hunk' | 'unstage-hunk';
      path: string;
      hunk: number;
      token: string;
    }
  | {
      command: 'stage-lines' | 'unstage-lines';
      path: string;
      lines: GitDiffLine[];
      token: string;
    }
  | { command: 'discard'; path: string; token: string }
  | { command: 'commit'; message: string; token: string }
  | { command: 'revision'; id: string }
  | { command: 'compare'; id: string; ref: string }
  | { command: 'blame'; path: string };

export interface GitResult {
  status: GitSnapshot | null;
  init: GitSnapshot;
  'create-branch': GitSnapshot;
  'switch-branch': GitSnapshot;
  'merge-branch': GitSnapshot;
  fetch: GitSnapshot;
  pull: GitSnapshot;
  push: GitSnapshot;
  sync: GitSnapshot;
  incoming: GitCommit[];
  outgoing: GitCommit[];
  stage: GitSnapshot;
  unstage: GitSnapshot;
  conflict: GitConflict;
  'resolve-conflict': GitSnapshot;
  diff: GitDiff;
  'stage-hunk': GitSnapshot;
  'unstage-hunk': GitSnapshot;
  'stage-lines': GitSnapshot;
  'unstage-lines': GitSnapshot;
  discard: GitSnapshot;
  graph: GitCommit[];
  'branch-graph': GitCommit[];
  'publish-branch': GitSnapshot;
  'stash-list': GitStash[];
  'stash-create': GitSnapshot;
  'stash-apply': GitSnapshot;
  'stash-pop': GitSnapshot;
  'stash-drop': GitSnapshot;
  commit: GitSnapshot;
  history: GitCommit[];
  revision: string;
  references: { ref: string; name: string }[];
  compare: string;
  blame: string;
}

export function projectGit<T extends GitRequest>(folder: string, request: T) {
  return projectRequest({ operation: 'git', folder, request }) as Promise<
    GitResult[T['command']]
  >;
}

export async function openProjectWorktree(
  getState: () => docDrawing,
  folder: string,
  request:
    | { id: string }
    | { name: string; branch: string; createBranch: boolean },
) {
  assertProjectCanOpen(getState());
  const root = await projectRequest(
    'id' in request
      ? { operation: 'worktree-open', folder, ...request }
      : { operation: 'worktree-add', folder, ...request },
  );
  if (root) {
    assertProjectCanOpen(getState());
    activateProjectFolder(root);
  }
}

export async function cloneProject(getState: () => docDrawing, source: string, name: string) {
  assertProjectCanOpen(getState());
  const root = await projectRequest({ operation: 'git-clone', source, name });
  if (root) {
    assertProjectCanOpen(getState());
    activateProjectFolder(root);
  }
  return root;
}
