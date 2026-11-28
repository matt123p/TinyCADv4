import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadComponent } from './load-component.mjs';

const { readProjectTabSession, writeProjectTabSession } = loadComponent('src/io/projectTabSession.ts', {});
const account = 'test-account';
const key = (root) => 'tinycad.projectTabs.' + JSON.stringify([account, root]);
const empty = { tabs: [], active: undefined };
const size = (items) => [...items].reduce((total, [name, value]) => total + 2 * (name.length + value.length), 0);

function mockStorage(t) {
  const items = new Map();
  const storage = {
    quota: Infinity,
    get length() { return items.size; },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (name) => items.get(name) ?? null,
    removeItem: (name) => items.delete(name),
    setItem(name, value) {
      const next = new Map(items).set(name, value);
      if (size(next) > this.quota) throw new DOMException('Storage full', 'QuotaExceededError');
      items.set(name, value);
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
  let now = 1;
  t.mock.method(Date, 'now', () => now++);
  return { items, storage };
}

test('opening a legacy empty session protects it from eviction by project count', (t) => {
  const { items } = mockStorage(t);
  for (let index = 0; index < 50; index++) items.set(key(String(index)), JSON.stringify(empty));
  assert.deepEqual(readProjectTabSession('0', account), empty);
  writeProjectTabSession('new', account, empty);
  assert.equal(items.size, 50);
  assert.equal(items.has(key('1')), false);
  assert.deepEqual(readProjectTabSession('0', account), empty);
  assert.deepEqual(readProjectTabSession('new', account), empty);
});

test('restores pin and preview indices after filtering an invalid tab', (t) => {
  const { items } = mockStorage(t);
  const pinned = { kind: 'file', id: 'pinned.xml', folder: 'root' };
  const preview = { kind: 'drawing', id: 'preview.dsn', folder: 'root', name: 'preview.dsn' };
  const session = { tabs: [pinned, null, preview], active: 2, pinned: [0, 1], preview: 2 };
  writeProjectTabSession('root', account, session);
  assert.deepEqual(readProjectTabSession('root', account), {
    tabs: [pinned, preview], active: 1, pinned: [0], preview: 1,
  });
  assert.ok(items.has(key('root')));
});

test('prunes sessions to the byte budget, including when a single session is oversized', (t) => {
  const { items } = mockStorage(t);
  const session = (length) => ({ tabs: [{ kind: 'file', folder: 'root', id: 'x'.repeat(length) }], active: 0 });
  writeProjectTabSession('first', account, session(70_000));
  writeProjectTabSession('second', account, session(70_000));
  assert.equal(items.has(key('first')), false);
  assert.deepEqual(readProjectTabSession('second', account), session(70_000));
  writeProjectTabSession('third', account, session(140_000));
  assert.equal(items.has(key('third')), false);
  assert.equal(items.has(key('second')), true);
  assert.ok(size(items) <= 256 * 1024);
});

test('a quota error evicts the oldest tab session and leaves other preferences intact', (t) => {
  const { items, storage } = mockStorage(t);
  storage.setItem('tinycad.language', 'en');
  writeProjectTabSession('oldest', account, empty);
  writeProjectTabSession('recent', account, empty);
  storage.quota = size(items);
  writeProjectTabSession('new', account, empty);
  assert.equal(items.has(key('oldest')), false);
  assert.equal(items.has(key('recent')), true);
  assert.equal(items.has(key('new')), true);
  assert.equal(storage.getItem('tinycad.language'), 'en');
});
