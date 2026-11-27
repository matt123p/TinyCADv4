import type { GitRequest, GitResult } from './projectGit';
export const projectFilesChanged = 'tinycad:project-files-changed';
export const projectFolderOpened = 'tinycad:project-folder-opened';

export interface ProjectLocation {
  id: string;
  name: string;
}

declare global {
  interface WindowEventMap {
    'tinycad:project-folder-opened': CustomEvent<ProjectLocation>;
  }
}

export interface ProjectItem extends ProjectLocation {
  folder: boolean;
  unsupported?: boolean;
}

export interface ProjectFile extends ProjectLocation {
  version: string;
}

export type ProjectStorageRequest =
  | { operation: 'root' }
  | { operation: 'git-clone'; source: string; name: string }
  | { operation: 'git'; folder: string; request: GitRequest }
  | { operation: 'choose-project-folder' }
  | { operation: 'recent-project-folder' }
  | { operation: 'open-recent-project-folder'; id: string }
  | { operation: 'open-launch' }
  | { operation: 'activate-launch'; ticket: string }
  | { operation: 'choose'; containProject?: string }
  | { operation: 'list'; folder: string; tree?: boolean }
  | { operation: 'watch-folders'; folders: string[] }
  | { operation: 'read' | 'fingerprint' | 'folder-identity'; id: string }
  | { operation: 'copy'; id: string; folder: string; name: string }
  | { operation: 'mkdir'; folder: string; name: string }
  | { operation: 'trash'; id: string; directory: boolean }
  | {
      operation: 'rename' | 'move';
      id: string;
      from: string;
      folder: string;
      name: string;
      directory: boolean;
    }
  | {
      operation: 'write';
      folder: string;
      name: string;
      data: Uint8Array;
      mediaType?: string;
      id?: string;
      version?: string;
    };

export interface ProjectStorageResult {
  root: ProjectLocation;
  'git-clone': ProjectLocation | null;
  git: GitResult[keyof GitResult];
  'open-launch': {
    ticket: string;
    root: ProjectLocation;
    marker: ProjectLocation;
    data: Uint8Array;
  } | null;
  'activate-launch': ProjectLocation;
  'choose-project-folder': ProjectLocation | null;
  'recent-project-folder': ProjectLocation | null;
  'open-recent-project-folder': ProjectLocation;
  choose: ProjectLocation | null;
  list: ProjectItem[];
  'watch-folders': void;
  read: { data: Uint8Array; version: string };
  mkdir: ProjectLocation;
  copy: void;
  fingerprint: string;
  'folder-identity': string;
  trash: void;
  rename: ProjectLocation;
  move: ProjectLocation;
  write: ProjectFile;
}
