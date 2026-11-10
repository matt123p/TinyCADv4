import type { tclib } from '../model/tclib';
import { applyBundledSymbolFolders } from '../model/symbolFolders';
import { normalizeTclibLoadError } from '../model/tclib';
import {
  parseBundledLibraryCatalog,
  BundledLibraryCatalog,
  BundledLibraryEntry,
} from '../../shared/bundledLibraries';

export const BUNDLED_LIBRARY_PREFIX = 'bundled:';
const selectionKey = 'tinycad.bundledLibraries.v1';

export interface BundledLibrarySnapshot {
  catalog: BundledLibraryCatalog | null;
  selected: string[];
  libraries: tclib[];
  loading: string[];
  errors: Record<string, string>;
  error: string;
  saving: boolean;
}

interface BundledLibrarySource {
  catalog(): Promise<unknown>;
  selection(): Promise<unknown>;
  saveSelection(ids: string[]): Promise<void>;
  load(entry: BundledLibraryEntry): Promise<tclib>;
}

async function fetchResource(file: string) {
  // Resolve relative to the HTML page, including deployments under /fs/ or /ga/.
  const url = new URL(
    'bundled-libraries/' + file.split('/').map(encodeURIComponent).join('/'),
    document.baseURI,
  );
  const response = await fetch(url.href, { credentials: 'same-origin' });
  if (!response.ok)
    throw new Error(`Unable to load bundled libraries (${response.status}).`);
  return response;
}

const source: BundledLibrarySource = {
  async catalog() {
    if (window.electronAPI?.bundledLibraryCatalog)
      return window.electronAPI.bundledLibraryCatalog();
    return (await fetchResource('config.json')).json();
  },
  async selection() {
    if (window.electronAPI?.bundledLibrarySelection)
      return window.electronAPI.bundledLibrarySelection();
    const value = localStorage.getItem(selectionKey);
    return value ? JSON.parse(value) : [];
  },
  async saveSelection(ids) {
    if (window.electronAPI?.bundledLibrarySelection)
      await window.electronAPI.bundledLibrarySelection(ids);
    else localStorage.setItem(selectionKey, JSON.stringify(ids));
  },
  async load(entry) {
    const bytes = window.electronAPI?.readBundledLibrary
      ? await window.electronAPI.readBundledLibrary(entry.id)
      : new Uint8Array(await (await fetchResource(entry.path)).arrayBuffer());
    // SQLite and library bytes are only requested after a library is selected.
    const { loadTcLibrary } = await import('./tclib');
    return loadTcLibrary(
      BUNDLED_LIBRARY_PREFIX + entry.id,
      entry.name,
      null,
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    );
  },
};

export class BundledLibraryManager {
  private snapshot: BundledLibrarySnapshot = {
    catalog: null,
    selected: [],
    libraries: [],
    loading: [],
    errors: {},
    error: '',
    saving: false,
  };
  private listeners = new Set<() => void>();
  private initialization: Promise<void> | null = null;
  private requests = new Map<string, object>();

  constructor(private source: BundledLibrarySource) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(changes: Partial<BundledLibrarySnapshot>) {
    this.snapshot = { ...this.snapshot, ...changes };
    this.listeners.forEach((listener) => listener());
  }
  initialize(): Promise<void> {
    if (!this.initialization) {
      this.publish({ error: '' });
      this.initialization = this.initializeSource().catch((error) => {
        this.initialization = null;
        this.publish({ error: normalizeTclibLoadError(error).summary });
      });
    }
    return this.initialization;
  }
  private async initializeSource() {
    const catalog = parseBundledLibraryCatalog(await this.source.catalog());
    let saved: unknown = [];
    let error = '';
    try {
      saved = await this.source.selection();
    } catch (reason) {
      error = normalizeTclibLoadError(reason).summary;
    }
    const selected = catalog.libraries
      .filter((entry) => Array.isArray(saved) && saved.includes(entry.id))
      .map((entry) => entry.id);
    this.publish({ catalog, selected, error });
    await Promise.all(selected.map((id) => this.load(id)));
  }
  async select(ids: string[]) {
    if (!this.snapshot.catalog || this.snapshot.saving) return;
    const selected = this.snapshot.catalog.libraries
      .filter((entry) => ids.includes(entry.id))
      .map((entry) => entry.id);
    this.publish({ saving: true, error: '' });
    try {
      // Commit the preference before updating memory; a failed write leaves the selection intact.
      await this.source.saveSelection(selected);
      for (const id of this.requests.keys())
        if (!selected.includes(id)) this.requests.delete(id);
      this.publish({
        selected,
        saving: false,
        libraries: this.snapshot.libraries.filter((lib) =>
          selected.includes(
            String(lib.fileId).slice(BUNDLED_LIBRARY_PREFIX.length),
          ),
        ),
        loading: this.snapshot.loading.filter((id) => selected.includes(id)),
        errors: Object.fromEntries(
          Object.entries(this.snapshot.errors).filter(([id]) =>
            selected.includes(id),
          ),
        ),
      });
      await Promise.all(selected.map((id) => this.load(id)));
    } catch (reason) {
      this.publish({
        saving: false,
        error: normalizeTclibLoadError(reason).summary,
      });
    }
  }
  async load(id: string) {
    const entry = this.snapshot.catalog?.libraries.find(
      (entry) => entry.id === id,
    );
    if (
      !entry ||
      !this.snapshot.selected.includes(id) ||
      this.requests.has(id) ||
      this.snapshot.libraries.some(
        (lib) => lib.fileId === BUNDLED_LIBRARY_PREFIX + id,
      )
    )
      return;
    const request = {};
    this.requests.set(id, request);
    const errors = { ...this.snapshot.errors };
    delete errors[id];
    this.publish({ loading: [...this.snapshot.loading, id], errors });
    try {
      const library = applyBundledSymbolFolders(await this.source.load(entry), entry.symbolFolders);
      if (this.requests.get(id) !== request) return;
      this.publish({
        libraries: [
          ...this.snapshot.libraries,
          {
            ...library,
            fileId: BUNDLED_LIBRARY_PREFIX + id,
            name: entry.name,
            readOnly: true,
          },
        ],
      });
    } catch (reason) {
      if (this.requests.get(id) === request)
        this.publish({
          errors: {
            ...this.snapshot.errors,
            [id]: normalizeTclibLoadError(reason).summary,
          },
        });
    } finally {
      if (this.requests.get(id) === request) {
        this.requests.delete(id);
        this.publish({
          loading: this.snapshot.loading.filter((item) => item !== id),
        });
      }
    }
  }
}

export const bundledLibraries = new BundledLibraryManager(source);
