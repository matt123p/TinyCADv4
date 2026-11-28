import type { GitRequest, GitResult, GitWorktree } from './projectGit';
import type { DesktopDesignExport } from './designExports';
import type { NormalizedUserConfig } from './libraryConfig';
import type { tclib } from '../model/tclib';
import type { Coordinate } from '../model/dsnItem';
export const projectFilesChanged = 'tinycad:project-files-changed';
export const projectFolderOpened = 'tinycad:project-folder-opened';
export const checkProjectOpen = 'tinycad:check-project-open';
export const hierarchyDragType = 'application/x-tinycad-hierarchy';
export const hierarchyDropEvent = 'tinycad:drop-project-hierarchy';

export interface ProjectLocation {
  id: string;
  name: string;
}

export interface ProjectOpenLocation extends ProjectLocation {
  initialDrawing?: ProjectLocation;
}

declare global {
  interface WindowEventMap {
    'tinycad:project-folder-opened': CustomEvent<ProjectOpenLocation>;
    [hierarchyDropEvent]: CustomEvent<{ project: string; id: string; point: Coordinate }>;
  }
}

export interface ProjectItem extends ProjectLocation {
  folder: boolean;
  unsupported?: boolean;
}

export interface ProjectFile extends ProjectLocation {
  version: string;
}

export interface HierarchyLink {
  filename: string;
  reference: string;
}

export interface HierarchyScan {
  drawings: {
    path: string;
    hasSymbol: boolean;
    hasSymbolSheet?: boolean;
    unreadable?: boolean;
    links: HierarchyLink[];
  }[];
  limited: boolean;
  unreadable: number;
  cacheUnavailable: boolean;
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
  | { operation: 'project-library-config'; project: string }
  | { operation: 'save-project-library-config'; project: string; config: NormalizedUserConfig; initialOnly?: boolean }
  | { operation: 'choose-project-libraries'; project: string; id?: string }
  | { operation: 'read-project-library'; project: string; id: string }
  | { operation: 'scan-project-hierarchy'; project: string }
  | { operation: 'choose-project-folder' }
  | { operation: 'install-project-example'; groupId: string; exampleId: string }
  | { operation: 'recent-project-folder' }
  | { operation: 'open-recent-project-folder'; id: string }
  | { operation: 'open-launch' }
  | { operation: 'activate-launch'; ticket: string }
  | { operation: 'choose'; containProject?: string }
  | { operation: 'list'; folder: string; tree?: boolean }
  | { operation: 'chat-list'; project: string; relative?: string; offset?: number }
  | { operation: 'chat-read'; project: string; relative: string }
  | { operation: 'read-hierarchical-drawing'; project: string; owner?: string; filename: string }
  | { operation: 'choose-hierarchical-drawing'; project: string }
  | { operation: 'choose-hierarchical-save'; project: string; owner?: string; name: string; compressed: boolean }
  | { operation: 'rebase-hierarchical-links'; project: string; owner: string; links: { owner?: string; filename: string }[] }
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
  'project-library-config': { saved: boolean; config: unknown };
  'save-project-library-config': void;
  'choose-project-libraries': ProjectLocation[];
  'read-project-library': tclib;
  'scan-project-hierarchy': HierarchyScan;
  'open-launch': {
    ticket: string;
    root: ProjectLocation;
    marker: ProjectLocation;
    data: Uint8Array;
  } | null;
  'activate-launch': ProjectLocation;
  'choose-project-folder': ProjectLocation | null;
  'install-project-example': ProjectOpenLocation | null;
  'recent-project-folder': ProjectLocation | null;
  'open-recent-project-folder': ProjectLocation;
  choose: ProjectLocation | null;
  list: ProjectItem[];
  'chat-list': { entries: { path: string; kind: 'file' | 'folder' }[]; nextOffset: number | null };
  'chat-read': Uint8Array;
  'read-hierarchical-drawing': { id: string; folder: string; relative: string; data: Uint8Array; version?: string };
  'choose-hierarchical-drawing': ProjectLocation | null;
  'choose-hierarchical-save': (ProjectLocation & { folder: string; version?: string }) | null;
  'rebase-hierarchical-links': string[];
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
