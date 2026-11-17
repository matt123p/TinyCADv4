import test from 'node:test';
import assert from 'node:assert/strict';
import { loadComponent } from './load-component.mjs';

test('desktop image import reads the native selection and handles cancellation and picker failures', async () => {
  const target = process.env.TARGET_SYSTEM;
  const oldWindow = globalThis.window;
  const oldReader = globalThis.FileReader;
  process.env.TARGET_SYSTEM = 'electron';
  try {
    const { importImageFromFile } = loadComponent('src/io/files.tsx', {
      '../state/dispatcher/AppDispatcher': { actionSelectDialog: (name, props) => ({ name, ...props }) },
    });
    const content = Buffer.from('selected image bytes');
    globalThis.window = { electronAPI: { openImageImport: async () => ({
      fileName: 'reference.png', mime: 'image/png', content: content.toString('base64'),
    }) } };
    let read;
    globalThis.FileReader = class { readAsDataURL(file) { read = file; } };
    const actions = [];
    const dispatch = action => typeof action === 'function' ? action(dispatch, () => ({})) : actions.push(action);
    await importImageFromFile()(dispatch);
    assert.equal(read.name, 'reference.png');
    assert.equal(read.type, 'image/png');
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), content);
    read = undefined;
    window.electronAPI.openImageImport = async () => null;
    await importImageFromFile()(dispatch);
    assert.equal(read, undefined);
    assert.deepEqual(actions, []);
    window.electronAPI.openImageImport = async () => { throw Error('Read failed'); };
    await importImageFromFile()(dispatch);
    assert.deepEqual(actions, [{ name: 'io_failure', message: 'Could not open the image file.' }]);
  } finally {
    if (target === undefined) delete process.env.TARGET_SYSTEM;
    else process.env.TARGET_SYSTEM = target;
    globalThis.window = oldWindow;
    globalThis.FileReader = oldReader;
  }
});
