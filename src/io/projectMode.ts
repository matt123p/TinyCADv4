export type StartupMode = 'single' | 'project';

const startupKey = 'tinycad.startupMode';

export const confirmProjectClose = 'tinycad:confirm-project-close';
export const saveActiveProjectFile = 'tinycad:save-project-file';
export const saveProjectTabs = 'tinycad:save-project-tabs';
export const editProjectHistory = 'tinycad:edit-project-history';
export const closeProjectMode = 'tinycad:close-project';
export const newProjectDesign = 'tinycad:new-project-design';

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
