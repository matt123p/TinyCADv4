import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadComponent } from './load-component.mjs';
import * as validation from '../../shared/bundledExamples.js';
import { packageExamples } from '../package-examples.mjs';
import { registerBundledExamples } from '../../electron/bundledExamples.js';

const require = createRequire(import.meta.url);
const catalog = {
  version: 1,
  assets: ['images/detail.svg'],
  groups: [
    {
      id: 'getting-started',
      title: 'Get you going examples',
      preview: 'images/group.svg',
      descriptionPath: 'notes/group.md',
      examples: [
        {
          id: 'first',
          title: 'First circuit',
          path: 'drawings/first.dsn',
          preview: 'images/drawing.svg',
          description: '# Full description\n\nExample text.',
        },
      ],
    },
  ],
};
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="blue"/></svg>';
const xml =
  '<TinyCADSheets><TinyCAD><NAME>Example sheet</NAME></TinyCAD></TinyCADSheets>';
const files = new Map([
  ['images/group.svg', svg],
  ['images/drawing.svg', svg],
  ['images/detail.svg', svg],
  [
    'notes/group.md',
    '# Group overview\n\n' +
      'Full Markdown paragraph.\n\n'.repeat(100) +
      'Final paragraph.',
  ],
  ['drawings/first.dsn', xml],
]);
const parsed = validation.parseExampleCatalog(catalog);
assert.equal(parsed.groups[0].examples.length, 1);
assert.equal(validation.exampleResourcePaths(parsed).size, 5);
for (const invalid of [
  '../escape.dsn',
  '/etc/secret.dsn',
  'C:/secret.dsn',
  'a\\b.dsn',
  'a%2fb.dsn',
  'a//b.dsn',
  'a/./b.dsn',
  'a.dsn?x',
  'https://host/a.dsn',
  'a.tclib',
]) {
  assert.throws(() =>
    validation.parseExampleCatalog({
      ...catalog,
      groups: [
        {
          ...catalog.groups[0],
          examples: [{ ...catalog.groups[0].examples[0], path: invalid }],
        },
      ],
    }),
  );
}
assert.throws(() => validation.parseExampleCatalog({ version: 2, groups: [] }));
assert.throws(() =>
  validation.parseExampleCatalog({
    ...catalog,
    groups: [catalog.groups[0], catalog.groups[0]],
  }),
);
assert.throws(() =>
  validation.parseExampleCatalog({
    ...catalog,
    groups: [{ ...catalog.groups[0], description: '# Both options' }],
  }),
);
assert.throws(() =>
  validation.parseExampleCatalog({
    ...catalog,
    groups: [{ ...catalog.groups[0], preview: 'code.js' }],
  }),
);
assert.throws(() =>
  validation.parseExampleCatalog({ ...catalog, assets: ['code.js'] }),
);
const allowed = validation.exampleResourcePaths(parsed);
const spacedImages = new Set(['images/wiring detail.svg']);
assert.equal(
  validation.resolveExampleResource(
    '../images/wiring%20detail.svg',
    'notes/group.md',
    spacedImages,
  ),
  'images/wiring detail.svg',
);
assert.equal(
  validation.resolveExampleResource(
    '%252e%252e/private.svg',
    undefined,
    spacedImages,
  ),
  null,
);
assert.equal(
  validation.resolveExampleResource(
    '../images/detail.svg',
    'notes/group.md',
    allowed,
  ),
  'images/detail.svg',
);
assert.equal(
  validation.resolveExampleResource(
    '../../images/detail.svg',
    'notes/group.md',
    allowed,
  ),
  null,
);
assert.equal(
  validation.resolveExampleResource('file:///etc/secret', undefined, allowed),
  null,
);
assert.equal(
  validation.resolveExampleResource('images/detail.svg', undefined, allowed),
  'images/detail.svg',
);

// Use the actual XML DOM parser; the drawing converter is supplied separately to
// isolate these opening/persistence checks from the renderer's startup graph.
globalThis.DOMParser = require('common-xml-features').DOMParser;
const document = { sheets: [{ name: 'Example sheet', items: [] }] };
const actions = [];
const dispatcher = {
  actionCancelDialog: () => ({ type: 'cancel' }),
  actionSelectDialog: (dlg, props) => ({ type: 'dialog', dlg, props }),
  actionSetDocument: (drawing, name, id, folderId) => ({
    type: 'document',
    drawing,
    name,
    id,
    folderId,
  }),
  actionSetFileData: (name, id, folderId, drawingVersion) => ({
    type: 'file',
    name,
    id,
    folderId,
    drawingVersion,
  }),
};
const read = [];
globalThis.window = {
  electronAPI: {
    exampleCatalog: async () => catalog,
    readExampleResource: async (resource) => {
      read.push(resource);
      return new TextEncoder().encode(files.get(resource));
    },
  },
};
const examples = loadComponent('src/io/examples.ts', {
  '../../shared/bundledExamples': validation,
  '../state/dispatcher/AppDispatcher': dispatcher,
  'redux-undo': {
    ActionCreators: { clearHistory: () => ({ type: 'clear-history' }) },
  },
  './ioXml': {
    ioXML: class {
      from_dsn() {
        return document;
      }
    },
  },
  '../util/xmlbuilder': {
    XMLBuilder: class {
      fromText(value) {
        this.text = value;
      }
    },
  },
});
const { ExampleResources, exampleResources, openExample, commitExample } =
  examples;
await exampleResources.catalog();
assert.deepEqual(
  read,
  [],
  'reading the catalog must not read drawings or descriptions',
);
assert.equal(
  await exampleResources.description(parsed.groups[0].examples[0]),
  '# Full description\n\nExample text.',
);
assert.deepEqual(read, [], 'inline Markdown requires no extra file read');
assert.match(
  await exampleResources.description(parsed.groups[0]),
  /Final paragraph\.$/,
);
assert.deepEqual(read, ['notes/group.md']);
const preview = await exampleResources.image('images/group.svg');
assert.ok(preview.url.startsWith('blob:'));
preview.dispose();
assert.ok(
  !read.includes('drawings/first.dsn'),
  'previews must never open the drawing',
);
await assert.rejects(() => exampleResources.read('../private.dsn'), /Unknown/);
await assert.rejects(
  () => exampleResources.drawing('getting-started', 'missing'),
  /Unknown/,
);
const state = {
  altStore: { savedVersion: 0, show_dialogue: 'open_example' },
  docStore: { present: { drawingVersion: 0 } },
};
await openExample('getting-started', 'first')(
  (action) => actions.push(action),
  () => state,
);
assert.deepEqual(
  actions.map((action) => action.type),
  ['cancel', 'document', 'file', 'clear-history'],
);
assert.equal(actions[1].drawing, document);
assert.equal(
  actions[1].id,
  null,
  'example source must not become the current file handle',
);
assert.equal(actions[2].drawingVersion, 0, 'opening a copy keeps Save enabled');
assert.equal(actions[2].name, 'first.dsn');
actions.length = 0;
state.docStore.present.drawingVersion = 9;
await openExample('getting-started', 'first')(
  (action) => actions.push(action),
  () => state,
);
assert.equal(actions.length, 1);
assert.equal(actions[0].dlg, 'unsaved_changes');
assert.equal(actions[0].props.pendingAction.type, 'file-open-example');
const pending = actions[0].props.pendingAction;
actions.length = 0;
commitExample((action) => actions.push(action), pending);
assert.equal(actions[1].id, null);

let release;
const cancellation = new AbortController();
const delayed = new ExampleResources({
  catalog: async () => catalog,
  read: () =>
    new Promise((resolve) => {
      release = resolve;
    }),
});
const delayedRead = delayed.read('drawings/first.dsn', cancellation.signal);
await new Promise((resolve) => setImmediate(resolve));
cancellation.abort();
release(new TextEncoder().encode(xml));
await assert.rejects(() => delayedRead, /cancelled/);
let attempts = 0;
const recovery = new ExampleResources({
  catalog: async () => {
    if (++attempts === 1) throw new Error('Unavailable');
    return catalog;
  },
  read: async () => new Uint8Array(),
});
await assert.rejects(() => recovery.catalog(), /Unavailable/);
assert.equal(
  (await recovery.catalog()).groups.length,
  1,
  'catalog failures can be retried',
);
state.altStore.show_dialogue = null;
actions.length = 0;
await openExample('getting-started', 'first')(
  (action) => actions.push(action),
  () => state,
);
assert.equal(
  actions.length,
  0,
  'closing the browser must prevent a late drawing from replacing the document',
);
files.set('drawings/first.dsn', '<NotATinyCADDrawing/>');
await assert.rejects(
  () => exampleResources.drawing('getting-started', 'first'),
  /valid TinyCAD/,
);
files.set('drawings/first.dsn', xml);

// Cancelling the unsaved prompt returns to the selected example.
const React = require('react');
const { UnsavedChangesDialog } = loadComponent(
  'src/components/dialogues/unsavedChangesDlg.tsx',
  {
    react: {
      __esModule: true,
      default: React,
      ...React,
      useState: () => [false, () => {}],
      useEffect: () => {},
    },
    'react-redux': {
      useDispatch: () => (action) => actions.push(action),
      useSelector: (selector) =>
        selector({
          ...state,
          altStore: { ...state.altStore, saveInProgress: false },
        }),
    },
    'react-i18next': { useTranslation: () => ({ t: (key) => key }) },
    '../../state/dispatcher/AppDispatcher': dispatcher,
  },
);
const tree = UnsavedChangesDialog({ pendingAction: pending });
const all = (element) =>
  !element || typeof element !== 'object'
    ? []
    : [
        element,
        ...React.Children.toArray(element.props?.children).flatMap(all),
      ];
const cancel = all(tree).find(
  (element) => element.props.children === 'common.cancel',
);
assert.ok(cancel);
actions.length = 0;
cancel.props.onClick();
assert.equal(actions[0].dlg, 'open_example');
assert.deepEqual(actions[0].props, {
  groupId: 'getting-started',
  exampleId: 'first',
});

const temporary = await mkdtemp(path.join(tmpdir(), 'tinycad-examples-'));
try {
  const source = path.join(temporary, 'source');
  const output = path.join(temporary, 'dist');
  await mkdir(source);
  await writeFile(path.join(source, 'config.json'), JSON.stringify(catalog));
  for (const [resource, content] of files) {
    const file = path.join(source, resource);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  await writeFile(path.join(source, 'not-configured.dsn'), 'unused');
  await packageExamples(source, output);
  assert.match(
    await readFile(path.join(output, 'notes/group.md'), 'utf8'),
    /Final paragraph\.$/,
  );
  await assert.rejects(
    () => readFile(path.join(output, 'not-configured.dsn')),
    /ENOENT/,
  );
  const handlers = new Map();
  const window = { webContents: { mainFrame: {} } };
  registerBundledExamples({
    ipcMain: { handle: (key, handler) => handlers.set(key, handler) },
    getWindow: () => window,
    directory: output,
  });
  const event = {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  };
  assert.equal(
    (await handlers.get('bundled-example-catalog')(event)).groups[0].id,
    'getting-started',
  );
  assert.equal(
    new TextDecoder().decode(
      await handlers.get('bundled-example-read')(event, 'drawings/first.dsn'),
    ),
    xml,
  );
  await assert.rejects(
    () => handlers.get('bundled-example-read')(event, '../secret'),
    /Unknown/,
  );
  await assert.rejects(
    () =>
      handlers.get('bundled-example-read')(
        { ...event, senderFrame: {} },
        'drawings/first.dsn',
      ),
    /host main frame/,
  );
  await rm(path.join(source, 'images/group.svg'));
  await assert.rejects(() => packageExamples(source, output), /ENOENT/);
  if (process.platform !== 'win32') {
    const outside = path.join(temporary, 'outside.svg');
    await writeFile(outside, svg);
    await symlink(outside, path.join(source, 'images/group.svg'));
    await assert.rejects(() => packageExamples(source, output), /outside/);
    await rm(path.join(output, 'images/group.svg'));
    await symlink(outside, path.join(output, 'images/group.svg'));
    await assert.rejects(
      () => handlers.get('bundled-example-read')(event, 'images/group.svg'),
      /Invalid/,
    );
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log(
  'Example checks passed: catalog, Markdown resources, packaging, lazy drawing reads, editable copies, unsaved cancellation, load cancellation, retries, and desktop IPC.',
);
