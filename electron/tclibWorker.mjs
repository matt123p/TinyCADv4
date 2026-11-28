import { parentPort } from 'node:worker_threads';
import { readTclib } from '../shared/tclibSqlite.mjs';

parentPort.on('message', ({ id, file }) => {
  try {
    parentPort.postMessage({ id, library: readTclib(file) });
  } catch (error) {
    parentPort.postMessage({ id, error });
  }
});
