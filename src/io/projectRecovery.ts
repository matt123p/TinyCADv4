import type { OpenProjectDrawing } from './projectStorage';
import { MAX_PROJECT_FILE_BYTES } from '../../shared/projectFiles';

const databaseName = 'tinycad-project-recovery';
const storeName = 'drawings';
const referenceStore = 'reference-transactions';
const relocationStore = 'project-relocations';

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
    const request = indexedDB.open(databaseName, 3);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName))
        request.result.createObjectStore(storeName, { keyPath: 'key' });
      if (!request.result.objectStoreNames.contains(referenceStore))
        request.result.createObjectStore(referenceStore, { keyPath: 'key' });
      if (!request.result.objectStoreNames.contains(relocationStore))
        request.result.createObjectStore(relocationStore, { keyPath: 'key' });
    };
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

export interface ReferenceRecoveryJournal {
  key: string;
  source: {
    id: string;
    folder: string;
    name: string;
    data: Uint8Array;
    before: string;
    after: string;
  };
  board: { id: string; before: string; after: string };
}

async function projectJournalRequest<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openRecoveryDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode, { durability: 'strict' });
    const request = operation(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () =>
      reject(
        tx.error ||
          new Error('The project recovery transaction was aborted.'),
      );
  });
}

export function readReferenceJournal(key: string) {
  return projectJournalRequest<ReferenceRecoveryJournal>(
    referenceStore, 'readonly',
    (store) => store.get(key),
  );
}

export async function writeReferenceJournal(
  journal: ReferenceRecoveryJournal,
): Promise<void> {
  await projectJournalRequest(referenceStore, 'readwrite', (store) => store.add(journal));
}

export async function deleteReferenceJournal(key: string): Promise<void> {
  await projectJournalRequest(referenceStore, 'readwrite', (store) => store.delete(key));
}

export interface ProjectRelocationJournal {
  kind?: 'move';
  key: string;
  root: string;
  source: { path: string; folder: string; name: string };
  destination: { path: string; folder: string; name: string };
  directory: boolean;
  identity: string;
  markerBefore: string;
  markerAfter?: string;
  pathsBefore: string;
  pathsAfter?: string;
  rewrites: readonly {
    path: string;
    data: Uint8Array;
    before: string;
    after: string;
  }[];
}

export interface ProjectTrashJournal {
  kind: 'trash';
  key: string;
  root: string;
  markerName: string;
  source: { id: string; path: string; folder: string; name: string; directory: boolean };
  identity: string;
  before: Uint8Array;
  after: Uint8Array;
}

type ProjectFileJournal = ProjectRelocationJournal | ProjectTrashJournal;

export function readProjectFileJournal(key: string) {
  return projectJournalRequest<ProjectFileJournal>(
    relocationStore, 'readonly', (store) => store.get(key),
  );
}

export async function writeProjectFileJournal(journal: ProjectFileJournal) {
  await projectJournalRequest(relocationStore, 'readwrite', (store) => store.add(journal));
}

export async function deleteProjectFileJournal(key: string) {
  await projectJournalRequest(relocationStore, 'readwrite', (store) => store.delete(key));
}

/** PCB recovery uses compare-and-swap so a second editor cannot take over a draft. */
export function replaceBoardRecoveryDraft(
  draft: ProjectRecoveryDraft,
  expectedToken: string | undefined,
): Promise<boolean> {
  if (draft.data.byteLength > MAX_PROJECT_FILE_BYTES)
    return Promise.reject(new Error('The PCB exceeds the recovery size limit.'));
  return withDraft(draft.key, true, (store, existing) => {
    if (existing?.token !== expectedToken) return false;
    store.put(draft);
    return true;
  });
}
