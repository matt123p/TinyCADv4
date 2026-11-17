import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadComponent } from './load-component.mjs';

function fixture(digest, onEngineLoad) {
  let events,
    loads = 0,
    starts = 0,
    stops = 0,
    sequence = 0;
  const commits = [];
  const module = loadComponent('src/simulation/session.ts', {
    './diagnostics': {
      checkSpiceComponents: () => [],
      locateSpiceErrors: () => [],
    },
    get './engine'() {
      loads++;
      onEngineLoad?.();
      return {
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
      };
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
    get loads() {
      return loads;
    },
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

test('engine module stays unloaded until a validated run and Stop cancels module startup', async () => {
  const f = fixture(undefined, () => f.module.stopSimulation());
  assert.equal(
    f.loads,
    0,
    'opening the application must not import the engine',
  );
  await f.run();
  assert.equal(f.loads, 1);
  assert.equal(f.starts, 0, 'Stop while importing must not launch a worker');
  assert.equal(f.module.getSession(), undefined);
});

test('failed validation never imports the engine', async () => {
  const f = fixture(async () => {
    throw new Error('invalid circuit');
  });
  await assert.rejects(f.run(), /invalid circuit/);
  assert.equal(f.loads, 0);
  assert.equal(f.module.getSimulationFailure(), 'invalid circuit');
});

test('failed runs notify once, can be dismissed, and reset before a new run', async () => {
  const f = fixture();
  const notifications = [];
  const unsubscribe = f.module.subscribeSession(() =>
    notifications.push(f.module.getSimulationFailure()),
  );
  assert.equal(f.module.getSimulationFailure(), '');
  await f.run();
  f.events({ type: 'finished', state: 'failed' });
  const message = f.commits[0].error;
  assert.match(message, /ngspice could not complete/);
  assert.equal(notifications.at(-1), message);
  f.module.dismissSimulationFailure();
  assert.equal(notifications.at(-1), '');
  f.events({ type: 'finished', state: 'failed', error: 'Duplicate event' });
  assert.equal(f.module.getSimulationFailure(), '');
  await f.run();
  f.events({ type: 'finished', state: 'failed', error: 'Another failure' });
  assert.equal(f.module.getSimulationFailure(), 'Another failure');
  await f.run();
  assert.equal(f.module.getSimulationFailure(), '');
  f.events({ type: 'vectors', names: ['out'] });
  f.events({ type: 'data', rows: [[2.5]] });
  f.events({ type: 'finished', state: 'complete' });
  assert.equal(f.module.getSimulationFailure(), '');
  unsubscribe();
});

test('switching documents clears failure popups and ignores late solver failures', async () => {
  const f = fixture();
  await f.run();
  f.events({ type: 'finished', state: 'failed', error: 'Old failure' });
  f.module.invalidateSimulationDocument();
  assert.equal(f.module.getSimulationFailure(), '');
  await f.run();
  f.module.invalidateSimulationDocument();
  f.events({ type: 'finished', state: 'failed', error: 'Late failure' });
  assert.equal(f.module.getSimulationFailure(), '');
});

test('diagnostics navigation targets the failed run and is consumed once', async () => {
  const f = fixture();
  await f.run('circuit');
  f.events({ type: 'log', message: 'stderr Error: invalid model' });
  f.events({ type: 'finished', state: 'failed' });
  const target = { documentId: 'circuit', sheetId: 'sim', runId: f.commits[0].id };
  assert.deepEqual(f.module.getSimulationFailureTarget(), target);
  assert.match(f.commits[0].diagnosticLog, /invalid model/);
  f.module.requestSimulationDiagnostics();
  assert.equal(f.module.getSimulationFailure(), '');
  assert.equal(f.module.getSimulationFailureTarget(), undefined);
  assert.deepEqual(f.module.getSimulationDiagnosticsTarget(), target);
  f.module.clearSimulationDiagnosticsTarget();
  assert.equal(f.module.getSimulationDiagnosticsTarget(), undefined);
});

test('retained failure logs are bounded and preserve the final solver error', async () => {
  const f = fixture();
  await f.run();
  f.events({ type: 'log', message: 'x'.repeat(70 * 1024) });
  f.events({ type: 'log', message: 'stderr Error: invalid model' });
  f.events({ type: 'finished', state: 'failed' });
  const log = f.commits[0].diagnosticLog;
  assert.ok(log.length <= 64 * 1024);
  assert.match(log, /^\[Earlier solver output omitted\]/);
  assert.match(log, /stderr Error: invalid model\n$/);
});

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
    assert.equal(f.module.getSimulationFailure(), '');
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
