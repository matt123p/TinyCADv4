import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadComponent } from './load-component.mjs';
import { loadLayoutModule } from './layout-module.mjs';

test('netlist worker ignores unrelated messages and still answers valid requests', async () => {
  const responses = [];
  const { sandbox } = loadLayoutModule('src/web-worker/main.ts', {
    '../layout': { optimiseLayout() { throw new Error('Unexpected layout request'); } },
    './netlistState': {
      NetlistWorkerState: class {
        get() { return 'current netlist'; }
        init() { throw new Error('Invalid drawing'); }
      },
    },
  }, {
    onmessage: null,
    postMessage: response => responses.push(structuredClone(response)),
  });
  for (const data of [null, undefined, '', 42, {}, { id: 1 },
    { id: '1', command: 'netlist-get' }, { id: 1.5, command: 'netlist-get' }]) {
    await assert.doesNotReject(() => sandbox.onmessage({ data }));
  }
  assert.deepEqual(responses, []);
  await sandbox.onmessage({ data: { id: 2, command: 'netlist-get' } });
  await sandbox.onmessage({ data: { id: 3, command: 'unknown' } });
  await sandbox.onmessage({ data: { id: 4, command: 'netlist-init', payload: { drawing: {} } } });
  assert.deepEqual(responses, [
    { id: 2, ok: true, data: 'current netlist' },
    { id: 3, ok: false, error: 'Unknown worker command: unknown' },
    { id: 4, ok: false, error: 'Invalid drawing' },
  ]);
});

test('initial netlist publication does not repeatedly initialize a version-zero drawing', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduled = new Map();
  let timerId = 0, initializeCount = 0, notify;
  const drawing = { documentId: 'first', sheets: [{ name: 'Sheet 1', items: [] }] };
  let present = { drawing, drawingVersion: 0 };
  globalThis.setTimeout = callback => {
    scheduled.set(++timerId, callback);
    return timerId;
  };
  globalThis.clearTimeout = id => scheduled.delete(id);
  try {
    const { initializeNetlistSync } = loadComponent('src/io/netlists/netlistSync.ts', {
      '../../model/dsnItem': { DocItemTypes: {} },
      '../../web-worker/worker': {
        wkrInitNetlist: async () => { initializeCount++; return {}; },
      },
      '../../state/dispatcher/AppDispatcher': {
        actionStampWireNetTypes: () => ({ type: 'stamp' }),
      },
    });
    initializeNetlistSync({
      getState: () => ({ docStore: { present } }),
      subscribe: callback => { notify = callback; },
      dispatch: () => notify(),
    });
    const flush = async () => {
      const tasks = [...scheduled.values()];
      scheduled.clear();
      tasks.forEach(callback => callback());
      // Allow both async worker and scheduling continuations to finish.
      for (let i = 0; i < 5; i++) await Promise.resolve();
    };
    await flush();
    await flush();
    assert.equal(initializeCount, 1);
    assert.equal(scheduled.size, 0, 'internal publication must settle');
    present = { drawing: { ...drawing, documentId: 'second' }, drawingVersion: 0 };
    notify();
    await flush();
    await flush();
    assert.equal(initializeCount, 2, 'a new version-zero document still initializes');
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
