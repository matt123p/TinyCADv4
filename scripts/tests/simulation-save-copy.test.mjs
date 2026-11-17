import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadComponent } from './load-component.mjs';
import {
  drawingFileName,
  isCompressedDrawing,
} from '../../shared/drawingFiles.js';

async function fixture(failure) {
  const original = {
    sheets: [{ simulation: { runs: [{ dataState: 'available' }] } }],
  };
  const compact = {
    sheets: [{ simulation: { runs: [{ dataState: 'removed' }] } }],
  };
  const state = {
    docStore: { present: { drawing: original } },
    altStore: {
      file: { name: 'example.dzn', id: 'original', folderId: 'folder' },
      saveInProgress: false,
      savedVersion: 7,
    },
  };
  const actions = [],
    saves = [];
  const files = loadComponent('src/io/files.tsx', {
    '../../shared/drawingFiles.js': { drawingFileName, isCompressedDrawing },
    '../simulation/document': {
      withoutResults(drawing) {
        assert.equal(drawing, original);
        return compact;
      },
    },
    './dsnCodec': {
      async encodeDrawing(drawing) {
        assert.equal(drawing, compact);
        return Uint8Array.of(80, 75, 3, 4);
      },
    },
    '../state/dispatcher/AppDispatcher': {
      actionSetSaveInProgress: (busy, version) => ({
        type: 'busy',
        busy,
        version,
      }),
      actionSelectDialog: (dialog, data) => ({ type: 'dialog', dialog, data }),
    },
    './filesystem/filesystemUserManager': {
      FileSystemUserManager: class {
        async initialize() {}
        async saveFile(bytes, file) {
          saves.push({ bytes, file });
          if (failure) throw failure;
          return { name: file.name, id: 'copy' };
        }
      },
    },
  });
  await files.initialise()(
    () => {},
    () => state,
  );
  return {
    files,
    state,
    original,
    actions,
    saves,
    dispatch: (action) => actions.push(action),
  };
}

test('save without results creates a separate copy and preserves the open file, results and saved version', async () => {
  const f = await fixture();
  await f.files.fileSaveWithoutResults(f.dispatch, () => f.state);
  assert.equal(f.saves.length, 1);
  assert.equal(f.saves[0].file.id, null);
  assert.equal(f.saves[0].file.name, 'example-without-results.dzn');
  assert.equal(f.saves[0].file.folderId, 'folder');
  assert.equal(f.state.altStore.file.id, 'original');
  assert.equal(f.original.sheets[0].simulation.runs[0].dataState, 'available');
  assert.equal(f.state.altStore.savedVersion, 7);
  assert.deepEqual(f.actions, [
    { type: 'busy', busy: true, version: null },
    { type: 'busy', busy: false, version: null },
  ]);
});

test('save-copy failure reports the error and clears the saving state', async () => {
  const f = await fixture(new Error('Disk full'));
  await f.files.fileSaveWithoutResults(f.dispatch, () => f.state);
  assert.equal(f.actions[1].dialog, 'io_failure');
  assert.match(f.actions[1].data.message, /Disk full/);
  assert.equal(f.actions.at(-1).busy, false);
});

test('save-copy ignores requests while saving or editing a library', async () => {
  const f = await fixture();
  f.state.altStore.saveInProgress = true;
  await f.files.fileSaveWithoutResults(f.dispatch, () => f.state);
  f.state.altStore.saveInProgress = false;
  f.state.docStore.present.editLibrary = {};
  await f.files.fileSaveWithoutResults(f.dispatch, () => f.state);
  assert.deepEqual(f.saves, []);
  assert.deepEqual(f.actions, []);
});
