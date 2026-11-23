import type { OpenProjectDrawing } from './projectStorage';

type LinkedDrawing = Pick<OpenProjectDrawing, 'id' | 'name' | 'rootId' | 'entryId' | 'folderId'>;

export type ProjectTabLocation =
  | { kind: 'schematic'; location: LinkedDrawing }
  | { kind: 'board'; rootId: string; boardId: string }
  | { kind: 'file'; id: string; folder: string; path?: string; ancestors?: readonly string[] };

export interface ProjectTabSession {
  tabs: ProjectTabLocation[];
  active?: number;
}

export interface ProjectTabRestore {
  root: string;
  session: ProjectTabSession;
}

const sessionPrefix = 'tinycad.projectTabs.';
const maxSessions = 50;
// Count UTF-16 bytes for keys and values, leaving room for other preferences.
const maxSessionBytes = 256 * 1024;
const sessionKey = (root: string, account: string) => sessionPrefix + JSON.stringify([account, root]);
const storageBytes = (key: string, value: string) => (key.length + value.length) * 2;

function parseStoredSession(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    // Treat a malformed preference as missing.
  }
}

function saveSession(key: string, session: ProjectTabSession) {
  const value = JSON.stringify({ lastUsed: Date.now(), session });
  const bytes = storageBytes(key, value);
  if (bytes > maxSessionBytes) {
    localStorage.removeItem(key);
    return;
  }

  // Collect keys before removing anything because Storage indices can change.
  const older = [];
  let totalBytes = bytes;
  for (let index = 0; index < localStorage.length; index++) {
    const otherKey = localStorage.key(index);
    if (!otherKey?.startsWith(sessionPrefix) || otherKey === key) continue;
    const stored = localStorage.getItem(otherKey);
    if (stored === null) continue;
    const data = parseStoredSession(stored);
    const lastUsed = Number.isFinite(data?.lastUsed) ? data.lastUsed : 0;
    const bytes = storageBytes(otherKey, stored);
    older.push({ key: otherKey, lastUsed, bytes });
    totalBytes += bytes;
  }
  older.sort((first, second) => first.lastUsed - second.lastUsed);
  while (older.length >= maxSessions || totalBytes > maxSessionBytes) {
    const entry = older.shift();
    localStorage.removeItem(entry.key);
    totalBytes -= entry.bytes;
  }

  // Other features can consume the remaining quota. Reclaim only tab sessions.
  for (;;) {
    try {
      localStorage.setItem(key, value);
      return;
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError' || !older.length) throw error;
      localStorage.removeItem(older.shift().key);
    }
  }
}

function validLocation(tab: ProjectTabLocation): boolean {
  if (tab?.kind === 'schematic') return typeof tab.location?.rootId === 'string' &&
    typeof tab.location.id === 'string' && typeof tab.location.entryId === 'string' &&
    typeof tab.location.name === 'string';
  if (tab?.kind === 'board') return typeof tab.rootId === 'string' && typeof tab.boardId === 'string';
  return tab?.kind === 'file' && typeof tab.id === 'string' && typeof tab.folder === 'string' &&
    (tab.path === undefined || typeof tab.path === 'string') &&
    (tab.ancestors === undefined || Array.isArray(tab.ancestors) && tab.ancestors.every((id) => typeof id === 'string'));
}

export function readProjectTabSession(root: string, account: string): ProjectTabSession | undefined {
  try {
    const key = sessionKey(root, account);
    const stored = parseStoredSession(localStorage.getItem(key));
    const data = stored?.session ?? stored;
    if (!Array.isArray(data?.tabs)) return;
    const tabs: ProjectTabLocation[] = [];
    let active: number;
    for (const [index, tab] of data.tabs.entries()) {
      if (!validLocation(tab)) continue;
      if (index === data.active) active = tabs.length;
      tabs.push(tab);
    }
    const session = { tabs, active };
    try {
      saveSession(key, session);
    } catch {
      // Restore the session even when its recency could not be saved.
    }
    return session;
  } catch {
    // An unavailable preference does not prevent opening a project.
  }
}

export function writeProjectTabSession(root: string, account: string, session: ProjectTabSession) {
  try {
    const key = sessionKey(root, account);
    const stored = parseStoredSession(localStorage.getItem(key));
    if (JSON.stringify(stored?.session) === JSON.stringify(session)) return;
    saveSession(key, session);
  } catch {
    // Tabs remain usable without local preferences.
  }
}
