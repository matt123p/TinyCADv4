import { tclib } from '../model/tclib';

class LibCache {
  private db: IDBDatabase;

  constructor() {}

  public init() {
    return new Promise<void>((resolve) => {
      if (this.db) {
        // Db already opened
        resolve();
      }

      if (!window.indexedDB) {
        console.log(
          "Your browser doesn't support a stable version of IndexedDB. Cached libraries feature will not be available.",
        );
        resolve();
        return;
      }

      let request = window.indexedDB.open('tcLibCache', 1);
      request.onerror = (event) => {
        console.log('could not open db', event);
        resolve();
      };
      request.onsuccess = (event: any) => {
        // Success, so we can use the database
        this.db = event.target.result;
        resolve();
      };
      request.onupgradeneeded = (event: any) => {
        // Save the IDBDatabase interface
        this.db = event.target.result;

        // Create an objectStore for this database
        let objectStore = this.db.createObjectStore('libraries', {
          keyPath: 'fileId',
        });

        objectStore.transaction.oncomplete = (event) => {
          // Wait for the store to be created
          resolve();
        };
      };
    });
  }

  public getAllLibraries() {
    return new Promise<tclib[]>((resolve) => {
      if (!this.db) {
        // Ignore as we don't have a valid object store
        resolve([]);
        return;
      }

      const request = this.db
        .transaction(['libraries'])
        .objectStore('libraries')
        .getAll();
      request.onsuccess = (event: any) => {
        resolve(event.target.result);
      };
      request.onerror = function (event) {
        // Not found or an error
        console.log(event);
        resolve([]);
      };
    });
  }

  public getLibrary(fileId: string) {
    return new Promise<tclib>((resolve) => {
      if (!this.db) {
        // Ignore as we don't have a valid object store
        resolve(null);
        return;
      }

      const id = fileId;

      const request = this.db
        .transaction(['libraries'])
        .objectStore('libraries')
        .get(id);
      request.onsuccess = (event: any) => {
        resolve(event.target.result);
      };
      request.onerror = function (event) {
        resolve(null);
      };
    });
  }

  public addLibrary(lib: tclib) {
    return new Promise<tclib>((resolve) => {
      if (!this.db) {
        // Ignore as we don't have a valid object store
        resolve(lib);
        return;
      }

      const request = this.db
        .transaction(['libraries'], 'readwrite')
        .objectStore('libraries')
        .put(lib);
      request.onsuccess = function (event) {
        resolve(lib);
      };
      request.onerror = function (event) {
        // We can't do much in the event of errors, and as this is just
        // a cache we don't really need to do anything...
        console.log(event);
        resolve(lib);
      };
    });
  }

  public deleteLibrary(fileId: string) {
    return new Promise<void>((resolve) => {
      if (!this.db) {
        // Ignore as we don't have a valid object store
        resolve();
        return;
      }

      const request = this.db
        .transaction(['libraries'])
        .objectStore('libraries')
        .delete(fileId);
      request.onsuccess = (event: any) => {
        resolve();
      };
      request.onerror = function (event) {
        resolve();
      };
    });
  }
}

export function libCache() {
  return new Promise<LibCache>((resolve) => {
    const r = new LibCache();
    return r.init().then(() => resolve(r));
  });
}
