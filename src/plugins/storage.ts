import type { Json, PluginPackage } from './types';

/** Both adapters store only host-owned data. Plugin frames never receive these handles. */
export class PluginStorage {
  private db?: Promise<IDBDatabase>;
  private open() {
    if (!this.db) this.db = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('tinycad.plugins', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('values');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.db = undefined; reject(request.error || new Error('Plugin storage unavailable.')); };
      request.onblocked = () => reject(new Error('Close other TinyCAD tabs to upgrade plugin storage.'));
    });
    return this.db;
  }
  async get<T>(key: string): Promise<T | undefined> {
    if (window.electronAPI?.pluginStorage) return (await window.electronAPI.pluginStorage('get', key)) as T;
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const request = db.transaction('values').objectStore('values').get(key);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  async set(key: string, value: unknown): Promise<void> {
    if (window.electronAPI?.pluginStorage) { await window.electronAPI.pluginStorage('set', key, value); return; }
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('values', 'readwrite'); tx.objectStore('values').put(value, key);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Plugin storage write aborted.'));
    });
  }
  async remove(key: string): Promise<void> {
    if (window.electronAPI?.pluginStorage) { await window.electronAPI.pluginStorage('remove', key); return; }
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('values', 'readwrite'); tx.objectStore('values').delete(key);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
  }
  getPackage(digest: string) { return this.get<PluginPackage>('package-' + digest); }
  setPackage(pkg: PluginPackage) { return this.set('package-' + pkg.digest, pkg); }
  getSettings(id: string) { return this.get<Record<string, Json>>('settings-' + id).then(value => value || {}); }
  setSettings(id: string, value: Record<string, Json>) { return this.set('settings-' + id, value); }
}
export const pluginStorage = new PluginStorage();
