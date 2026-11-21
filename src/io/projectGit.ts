import { projectRequest } from './projects';
import { projectFolderOpened } from './projectStorage';

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

export type GitDiff = { text: string; hunks: string[]; token: string };
export type GitCommit = {
  id: string;
  short: string;
  parents: string[];
  date: string;
  subject: string;
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
        | 'outgoing';
    }
  | { command: 'create-branch' | 'switch-branch'; branch: string }
  | { command: 'stage' | 'unstage' | 'history'; path?: string }
  | { command: 'conflict'; path: string }
  | ({
      command: 'resolve-conflict';
      path: string;
      token: string;
    } & GitResolution)
  | { command: 'diff'; path: string; staged: boolean }
  | { command: 'stage-hunk'; path: string; hunk: number; token: string }
  | { command: 'commit'; message: string; token: string }
  | { command: 'revision'; id: string };

export interface GitResult {
  status: GitSnapshot | null;
  init: GitSnapshot;
  'create-branch': GitSnapshot;
  'switch-branch': GitSnapshot;
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
  commit: GitSnapshot;
  history: GitCommit[];
  revision: string;
}

export function projectGit<T extends GitRequest>(folder: string, request: T) {
  return projectRequest({ operation: 'git', folder, request }) as Promise<
    GitResult[T['command']]
  >;
}

export async function cloneProject(source: string, name: string) {
  const root = await projectRequest({ operation: 'git-clone', source, name });
  if (root)
    window.dispatchEvent(
      new CustomEvent(projectFolderOpened, { detail: root }),
    );
  return root;
}
