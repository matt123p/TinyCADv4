function openBrowserWindow(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.click();
}

function canUseElectronShell(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.href);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function openExternalUrl(url: string): void {
  if (window.electronAPI?.openExternal && canUseElectronShell(url)) {
    window.electronAPI.openExternal(url);
    return;
  }

  openBrowserWindow(url);
}

function openElectronAppWindow(searchParams?: URLSearchParams): boolean {
  if (!window.electronAPI?.openNewWindow) {
    return false;
  }

  const action = searchParams?.get('action');
  if (action === 'new-library') {
    window.electronAPI.openNewWindow('new');
    return true;
  }

  const libraryPath = searchParams?.get('library');
  if (libraryPath) {
    window.electronAPI.openNewWindow(libraryPath);
    return true;
  }

  const filePath = searchParams?.get('file');
  if (filePath) {
    window.electronAPI.openNewWindow(filePath);
    return true;
  }

  const stateParam = searchParams?.get('state');
  if (stateParam) {
    try {
      const state = JSON.parse(stateParam);
      if (state?.action === 'newlib') {
        window.electronAPI.openNewWindow('new');
        return true;
      }
      if (state?.action === 'create') {
        window.electronAPI.openNewWindow('');
        return true;
      }
    } catch {
      // Ignore malformed state and fall through to a plain new app window.
    }
  }

  window.electronAPI.openNewWindow('');
  return true;
}

export function openCurrentAppUrl(searchParams?: URLSearchParams): void {
  if (openElectronAppWindow(searchParams)) {
    return;
  }

  const url = new URL(window.location.href);
  url.search = searchParams?.toString() ?? '';
  openBrowserWindow(url.toString());
}