const startupKey = 'tinycad.showWelcomeOnStartup';

export function showWelcomeOnStartup(): boolean {
  try {
    return localStorage.getItem(startupKey) !== 'false';
  } catch {
    return true;
  }
}

export function setShowWelcomeOnStartup(show: boolean): void {
  localStorage.setItem(startupKey, String(show));
}
