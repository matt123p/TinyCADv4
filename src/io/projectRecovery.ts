import type { OpenProjectDrawing } from './projectStorage';
import { MAX_PROJECT_FILE_BYTES } from '../../shared/projectFiles';

const databaseName = 'tinycad-project-recovery';
const storeName = 'drawings';

export function projectRecoveryKey(
  account: string,
  file: Pick<OpenProjectDrawing, 'id' | 'entryId'>,
): string {
  return JSON.stringify([account, file.id, file.entryId]);
}

export interface ProjectRecoveryDraft {
  key: string;
  token: string;
  sourceVersion: string;
  time: number;
  data: Uint8Array;
}

let connection: Promise<IDBDatabase>;

function openRecoveryDatabase(): Promise<IDBDatabase> {
  if (connection) return connection;
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(storeName, { keyPath: 'key' });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        connection = undefined;
      };
      resolve(database);
    };
  }).catch((error) => {
    connection = undefined;
    throw error;
  });
  return connection;
}

async function withDraft<T>(
  key: string,
  write: boolean,
  operation: (store: IDBObjectStore, existing: ProjectRecoveryDraft) => T,
): Promise<T> {
  const db = await openRecoveryDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = write
      ? db.transaction(storeName, 'readwrite', { durability: 'strict' })
      : db.transaction(storeName);
    const store = tx.objectStore(storeName);
    let result: T;
    tx.onabort = () =>
      reject(tx.error || new Error('The recovery transaction was aborted.'));
    tx.oncomplete = () => resolve(result);
    const read = store.get(key);
    read.onsuccess = () => {
      result = operation(store, read.result);
    };
  });
}

export function readRecoveryDraft(
  key: string,
): Promise<ProjectRecoveryDraft | undefined> {
  return withDraft(key, false, (_, draft) => draft);
}

export function writeRecoveryDraft(
  draft: ProjectRecoveryDraft,
): Promise<boolean> {
  if (draft.data.byteLength > MAX_PROJECT_FILE_BYTES)
    return Promise.reject(
      new Error('The drawing exceeds the recovery size limit.'),
    );
  return withDraft(draft.key, true, (store, existing) => {
    if (existing && existing.time > draft.time) return false;
    store.put(draft);
    return true;
  });
}

export function deleteRecoveryDraft(key: string, token: string): Promise<void> {
  return withDraft(key, true, (store, draft) => {
    if (draft?.token === token) store.delete(key);
  });
}
