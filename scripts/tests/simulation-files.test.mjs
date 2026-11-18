import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import * as formats from '../../shared/drawingFiles.js';
import { loadComponent } from './load-component.mjs';

const zip = new Uint8Array([80, 75, 3, 4, 1, 2, 3]);
const xml = new TextEncoder().encode('<TinyCADSheets/>');
const shared = { '../../../shared/drawingFiles.js': formats };

test('filesystem Save suggests .dzn on compression and preserves the original .dsn', async () => {
  const { FileSystemUserManager } = loadComponent(
    'src/io/filesystem/filesystemUserManager.ts',
    shared,
  );
  let options, written;
  const old = {
    name: 'lesson.dsn',
    createWritable() {
      throw new Error('Original file must not be overwritten');
    },
  };
  const selected = {
    name: 'lesson.dzn',
    createWritable: async () => ({
      write: async (bytes) => {
        written = bytes;
      },
      close: async () => {},
    }),
  };
  globalThis.window = {
    showSaveFilePicker: async (opts) => {
      options = opts;
      return selected;
    },
  };
  try {
    const result = await new FileSystemUserManager().saveFile(zip, {
      name: 'lesson.dsn',
      id: old,
    });
    assert.equal(options.suggestedName, 'lesson.dzn');
    assert.deepEqual(options.types[0].accept['application/octet-stream'], [
      '.dzn',
    ]);
    assert.equal(result.name, 'lesson.dzn');
    assert.equal(result.mimeType, formats.COMPRESSED_DRAWING_MIME);
    assert.deepEqual(written, zip);
  } finally {
    delete globalThis.window;
  }
});

test('filesystem Open accepts both extensions and sends bytes to header detection', async () => {
  const decoded = [],
    actions = [];
  const { FileSystemUserManager } = loadComponent(
    'src/io/filesystem/filesystemUserManager.ts',
    {
      ...shared,
      '../dsnCodec': {
        decodeDrawing: async (bytes) => {
          decoded.push(new Uint8Array(bytes));
          return {};
        },
      },
      '../../state/dispatcher/AppDispatcher': {
        actionSetDocument: () => ({ type: 'loaded' }),
      },
      'redux-undo': {
        ActionCreators: { clearHistory: () => ({ type: 'clear' }) },
      },
    },
  );
  let options;
  try {
    for (const [name, bytes] of [
      ['renamed.dsn', zip],
      ['renamed.dzn', xml],
    ]) {
      globalThis.window = {
        showOpenFilePicker: async (opts) => {
          options = opts;
          return [
            {
              getFile: async () => ({
                name,
                arrayBuffer: async () => bytes.buffer,
              }),
            },
          ];
        },
      };
      new FileSystemUserManager().fileOpen((action) => actions.push(action));
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.deepEqual(options.types[0].accept['application/octet-stream'], [
      '.dsn',
      '.dzn',
    ]);
    assert.deepEqual(decoded, [zip, xml]);
    assert.equal(actions.filter((a) => a.type === 'loaded').length, 2);
  } finally {
    delete globalThis.window;
  }
});

test('Drive uploads update the extension and MIME with content while preserving file ID', async () => {
  const { GoogleUserManager } = loadComponent(
    'src/io/google/googleUserManager.ts',
    shared,
  );
  const manager = new GoogleUserManager();
  manager.getToken = () => 'test-token';
  const original = globalThis.fetch,
    requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return requests.length % 2
      ? new Response(null, {
          status: 200,
          headers: {
            Location:
              'https://www.googleapis.com/upload/drive/v3/files/existing?upload_id=test',
          },
        })
      : new Response(JSON.stringify({ id: 'existing' }), { status: 200 });
  };
  try {
    const zipped = await manager.saveFile(zip, {
      name: 'lesson.dsn',
      id: 'existing',
    });
    assert.equal(requests[0].options.method, 'PATCH');
    assert.match(requests[0].url, /existing\?uploadType=resumable/);
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      name: 'lesson.dzn',
      mimeType: formats.COMPRESSED_DRAWING_MIME,
    });
    assert.equal(requests[1].options.method, 'PUT');
    assert.deepEqual(
      new Uint8Array(await requests[1].options.body.arrayBuffer()),
      zip,
    );
    assert.equal(zipped.id, 'existing');
    assert.equal(zipped.name, 'lesson.dzn');
    const plain = await manager.saveFile(xml, {
      name: 'lesson.dzn',
      id: 'existing',
    });
    assert.equal(plain.name, 'lesson.dsn');
    assert.deepEqual(JSON.parse(requests[2].options.body), {
      name: 'lesson.dsn',
      mimeType: 'application/xml',
    });
  } finally {
    globalThis.fetch = original;
  }
});

test('Electron packaging and Drive UI registration include .dzn', async () => {
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
  for (const associations of [
    pkg.build.fileAssociations,
    pkg.build.linux.fileAssociations,
  ])
    assert.ok(associations.some((a) => a.ext === 'dzn'));
  assert.ok(pkg.build.files.includes('shared/**/*'));
  const drive = JSON.parse(
    await fs.readFile('config/google-drive-ui.json', 'utf8'),
  );
  assert.ok(drive.defaultFileExtensions.includes('dzn'));
  for (const name of ['a.dsn', 'a.dzn', 'A.DZN'])
    assert.ok(formats.isDrawingFile(name));
  assert.equal(formats.isDrawingFile('a.tclib'), false);
});

test('Electron Open lists both extensions and Save suggests the format-matching sibling', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'tinycad-dzn-dialog-'),
  );
  let openOptions, saveOptions, completed;
  globalThis.drawingDialogMock = {
    showOpenDialog: async (options) => {
      openOptions = options;
      return { canceled: true };
    },
    showSaveDialog: async (options) => {
      saveOptions = options;
      return { filePath: path.join(directory, 'lesson.dzn') };
    },
    showErrorBox: () => {},
  };
  try {
    const bundle = await build({
      entryPoints: ['electron/io.js'],
      bundle: true,
      format: 'esm',
      platform: 'node',
      write: false,
      plugins: [
        {
          name: 'desktop-services',
          setup(builder) {
            builder.onResolve(
              { filter: /^(?:electron|electron-store)$/ },
              (args) => ({ path: args.path, namespace: 'mock' }),
            );
            builder.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
              contents:
                args.path === 'electron'
                  ? 'export const dialog=globalThis.drawingDialogMock;'
                  : 'export default class Store {get(){return [];} set(){}}',
            }));
          },
        },
      ],
    });
    const io = await import(
      `data:text/javascript;base64,${Buffer.from(
        bundle.outputFiles[0].text,
      ).toString('base64')}`
    );
    const window = {
      webContents: {
        send: (channel, data) => {
          if (channel === 'file-saved') completed(data);
        },
      },
    };
    io.loadFile(window, null, false, () => {});
    assert.deepEqual(openOptions.filters[0].extensions, ['dsn', 'dzn']);
    const original = path.join(directory, 'lesson.dsn');
    await fs.writeFile(original, xml);
    const saved = new Promise((resolve) => {
      completed = resolve;
    });
    io.saveFile(window, {
      id: original,
      name: 'lesson.dsn',
      folderId: original,
      content: zip,
    });
    assert.equal((await saved).success, true);
    assert.equal(saveOptions.defaultPath, path.join(directory, 'lesson.dzn'));
    assert.deepEqual(saveOptions.filters[0].extensions, ['dzn']);
    assert.deepEqual(new Uint8Array(await fs.readFile(original)), xml);
    assert.deepEqual(
      new Uint8Array(await fs.readFile(path.join(directory, 'lesson.dzn'))),
      zip,
    );
  } finally {
    delete globalThis.drawingDialogMock;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
