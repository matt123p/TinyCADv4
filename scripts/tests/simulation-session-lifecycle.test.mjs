import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadComponent } from './load-component.mjs';

function fixture(digest) {
  let events,
    starts = 0,
    stops = 0,
    sequence = 0;
  const commits = [];
  const module = loadComponent('src/simulation/session.ts', {
    './diagnostics': {
      checkSpiceComponents: () => [],
      locateSpiceErrors: () => [],
    },
    './engine': {
      startEngine: (_request, callback) => {
        starts++;
        events = callback;
        return {
          stop() {
            stops++;
          },
          dispose() {},
        };
      },
    },
    './deck': { buildDeck: () => 'title\nR1 1 0 1k\n.op\n.end' },
    '../io/dsnContainer': { digest: digest || (async () => 'hash') },
    './contracts': { newIdentity: () => 'run-' + ++sequence },
    './resultStore': {
      activateResultDocument() {},
      vectorUnit: () => 'V',
      resultBytes: () => 0,
      putResult() {},
      MAX_RUN_BYTES: 1024,
    },
    '../web-worker/netlistState': {
      NetlistWorkerState: class {
        init() {
          return { symbols: [] };
        }
      },
    },
  });
  return {
    module,
    commits,
    get events() {
      return events;
    },
    get starts() {
      return starts;
    },
    get stops() {
      return stops;
    },
    run: (documentId = 'doc') =>
      module.runSimulation(
        { documentId, sheets: [] },
        'sim',
        { models: {}, runs: [] },
        (run) => commits.push(run),
      ),
  };
}

test('Stop during checking cancels startup and permits a new acquisition', async () => {
  let release;
  let calls = 0;
  const f = fixture(() =>
    ++calls === 1
      ? new Promise((resolve) => {
          release = resolve;
        })
      : Promise.resolve('hash'),
  );
  const pending = f.run();
  f.module.stopSimulation();
  release('hash');
  await pending;
  assert.equal(f.starts, 0);
  assert.equal(f.module.getSession(), undefined);
  await f.run();
  assert.equal(f.starts, 1);
  f.events({ type: 'finished', state: 'stopped' });
  assert.equal(f.module.getSession(), undefined);
});

test('switching drawings rejects late results and allows a fresh run after cleanup', async () => {
  const f = fixture();
  await f.run('old');
  f.events({ type: 'vectors', names: ['out'] });
  f.events({ type: 'data', rows: [[2.5]] });
  f.module.invalidateSimulationDocument();
  assert.equal(f.stops, 1);
  f.events({ type: 'finished', state: 'complete' });
  assert.deepEqual(f.commits, []);
  assert.equal(f.module.getSession(), undefined);
  await f.run('new');
  f.events({ type: 'vectors', names: ['out'] });
  f.events({ type: 'data', rows: [[3.3]] });
  f.events({ type: 'finished', state: 'complete' });
  assert.equal(f.commits.length, 1);
  assert.equal(f.commits[0].state, 'complete');
});

test('repeated stopped runs preserve accepted samples and clear the active job', async () => {
  const f = fixture();
  for (let i = 0; i < 3; i++) {
    await f.run();
    f.events({ type: 'vectors', names: ['out'] });
    f.events({ type: 'data', rows: [[i]] });
    f.module.stopSimulation();
    f.events({ type: 'finished', state: 'stopped' });
    assert.equal(f.module.getSession(), undefined);
  }
  assert.equal(new Set(f.commits.map((run) => run.id)).size, 3);
  assert.ok(
    f.commits.every(
      (run) =>
        run.state === 'stopped' &&
        run.samples === 1 &&
        run.dataState === 'available',
    ),
  );
});
