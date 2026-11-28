import path from 'node:path';
import { Worker } from 'node:worker_threads';

let worker;
let nextId = 0;
const pending = new Map();

export function unpackedResource(file) {
  const archive = process.resourcesPath && path.join(process.resourcesPath, 'app.asar');
  // SQLite opens the OS file directly, outside Electron's virtual ASAR filesystem.
  return archive && file.startsWith(archive + path.sep)
    ? `${archive}.unpacked${file.slice(archive.length)}`
    : file;
}

function startWorker() {
  const filename = unpackedResource(path.join(import.meta.dirname, 'tclibWorker.mjs'));
  const reader = new Worker(filename);
  const fail = (error) => {
    if (worker !== reader) return;
    worker = undefined;
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  reader.on('error', fail);
  reader.on('exit', (code) => fail(new Error(`Library reader exited (${code}).`)));
  reader.on('message', ({ id, library, error }) => {
    const request = pending.get(id);
    pending.delete(id);
    if (!pending.size) reader.unref();
    if (error) request?.reject(error);
    else request?.resolve(library);
  });
  return reader;
}

export async function readNativeLibrary(file) {
  worker ??= startWorker();
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    worker.postMessage({ id, file });
    worker.ref();
    pending.set(id, { resolve, reject });
  });
}
