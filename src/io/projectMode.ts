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
