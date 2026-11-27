import type { GitRequest, GitResult, GitWorktree } from './projectGit';
import type { DesktopDesignExport } from './designExports';
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
  | { operation: 'worktree-list'; folder: string }
  | { operation: 'worktree-open'; folder: string; id: string }
  | {
      operation: 'worktree-add';
      folder: string;
      name: string;
      branch: string;
      createBranch: boolean;
    }
  | { operation: 'git'; folder: string; request: GitRequest }
  | ({ operation: 'export-destination' } & DesktopDesignExport)
  | ({
      operation: 'save-design-export';
      saveAs: boolean;
      text: string;
    } & DesktopDesignExport)
  | ({ operation: 'bind-design-exports' } & Omit<DesktopDesignExport, 'format'>)
  | { operation: 'choose-project-folder' }
  | { operation: 'recent-project-folder' }
  | { operation: 'open-recent-project-folder'; id: string }
  | { operation: 'open-launch' }
  | { operation: 'activate-launch'; ticket: string }
  | { operation: 'choose'; containProject?: string }
  | { operation: 'list'; folder: string; tree?: boolean }
  | { operation: 'chat-list'; project: string; relative?: string; offset?: number }
  | { operation: 'chat-read'; project: string; relative: string }
  | { operation: 'watch-folders'; folders: string[] }
  | { operation: 'read' | 'fingerprint' | 'folder-identity'; id: string }
  | {
      operation: 'copy';
      id: string;
      folder: string;
      name: string;
      directory?: boolean;
    }
  | {
      operation: 'create-entry';
      folder: string;
      directory: boolean;
      extension?: string;
    }
  | {
      operation: 'reveal';
      id: string;
      directory: boolean;
      openFolder?: boolean;
    }
  | { operation: 'edit-library'; id: string }
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
  'worktree-list': GitWorktree[];
  'worktree-open': ProjectLocation;
  'worktree-add': ProjectLocation | null;
  git: GitResult[keyof GitResult];
  'export-destination': string | null;
  'save-design-export': boolean;
  'bind-design-exports': void;
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
  'chat-list': { entries: { path: string; kind: 'file' | 'folder' }[]; nextOffset: number | null };
  'chat-read': Uint8Array;
  'watch-folders': void;
  read: { data: Uint8Array; version: string };
  mkdir: ProjectLocation;
  copy: ProjectLocation;
  'create-entry': ProjectLocation;
  reveal: void;
  'edit-library': void;
  fingerprint: string;
  'folder-identity': string;
  trash: boolean;
  rename: ProjectLocation;
  move: ProjectLocation;
  write: ProjectFile;
}
