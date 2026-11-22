import type { ProjectLocation } from './projectStorage';

export type StartupMode = 'single' | 'project';

const startupKey = 'tinycad.startupMode';

export const projectModeSupported =
  process.env.TARGET_SYSTEM === 'electron' ||
  process.env.TARGET_SYSTEM === 'google';

export const chooseProjectFolder = 'tinycad:choose-project-folder';
export const saveProjectTabs = 'tinycad:save-project-tabs';
export const closeProjectMode = 'tinycad:close-project';

export function startupMode(): StartupMode {
  try {
    return localStorage.getItem(startupKey) === 'project'
      ? 'project'
      : 'single';
  } catch {
    return 'single';
  }
}

export function saveStartupMode(mode: StartupMode) {
  try {
    localStorage.setItem(startupKey, mode);
  } catch {
    // Editing still works when browser preferences cannot be stored.
  }
}

export function recentDriveProjectFolders(account: string): ProjectLocation[] {
  try {
    const history = localStorage.getItem(`tinycad.recentDriveProjects.${account}`);
    const folders: unknown = history === null
      ? [JSON.parse(localStorage.getItem(`tinycad.driveProjectFolder.${account}`))]
      : JSON.parse(history);
    if (!Array.isArray(folders)) return [];
    return folders.filter((folder): folder is ProjectLocation =>
      typeof folder?.id === 'string' && typeof folder.name === 'string').slice(0, 10);
  } catch {
    return [];
  }
}

export function rememberDriveProjectFolder(account: string, folder: ProjectLocation) {
  try {
    const history = recentDriveProjectFolders(account).filter(({ id }) => id !== folder.id);
    localStorage.setItem(`tinycad.recentDriveProjects.${account}`, JSON.stringify([folder, ...history].slice(0, 10)));
  } catch {
    // The current folder remains available for this session.
  }
}
