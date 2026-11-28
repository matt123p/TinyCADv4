const storageName = 'tinycad.recentDrawings';
const storeName = 'drawings';
const listKey = 'recent';
const maxRecent = 10;

let database: Promise<IDBDatabase>;
let storageUnavailable = false;
let recentDrawings: FileSystemFileHandle[] = [];
let pending = Promise.resolve();

function openDatabase() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(storageName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

export async function readRecentDrawings(): Promise<FileSystemFileHandle[]> {
  if (storageUnavailable) return recentDrawings;
  try {
    const db = await openDatabase();
    recentDrawings = await new Promise<FileSystemFileHandle[]>(
      (resolve, reject) => {
        const request = db
          .transaction(storeName)
          .objectStore(storeName)
          .get(listKey);
        request.onsuccess = () => resolve(request.result ?? []);
        request.onerror = () => reject(request.error);
      },
    );
  } catch {
    // Keep the session list available if browser storage is unavailable.
    storageUnavailable = true;
  }
  return recentDrawings;
}

export function updateRecentDrawings(
  handle: FileSystemFileHandle,
  remove = false,
) {
  const update = async () => {
    const existing = await readRecentDrawings();
    const matches = await Promise.all(
      existing.map((entry) => entry.isSameEntry(handle).catch(() => false)),
    );
    const others = existing.filter((_, index) => !matches[index]);
    recentDrawings = (remove ? others : [handle, ...others]).slice(
      0,
      maxRecent,
    );

    if (storageUnavailable) return recentDrawings;
    try {
      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
        transaction.objectStore(storeName).put(recentDrawings, listKey);
      });
    } catch {
      // A storage failure does not prevent opening or saving the drawing.
      storageUnavailable = true;
    }
    return recentDrawings;
  };

  // Comparing handles is asynchronous. Serialize the full read/update/write
  // sequence so two tabs cannot overwrite one another's recent files.
  const updated = pending.then(
    () => navigator.locks?.request(storageName, update) ?? update(),
  );
  pending = updated.then(
    () => {},
    () => {},
  );
  return updated;
}
