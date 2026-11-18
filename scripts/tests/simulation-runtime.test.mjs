import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

test('native renderer waits for process cleanup and preserves the first terminal event', async () => {
  const compiled = await build({
    entryPoints: ['src/simulation/engine.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
    define: { 'process.env.TARGET_SYSTEM': '"electron"' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', compiled.outputFiles[0].text)(
    module,
    module.exports,
  );
  let listener,
    resolveStart,
    stops = 0,
    unsubscribed = false;
  globalThis.window = {
    electronAPI: {
      onSimulation: (callback) => {
        listener = callback;
        return () => {
          unsubscribed = true;
        };
      },
      startSimulation: () =>
        new Promise((resolve) => {
          resolveStart = resolve;
        }),
      stopSimulation: () => {
        stops++;
      },
    },
  };
  try {
    const events = [],
      request = { runId: 'run', deck: '', files: {}, maxBytes: 1024 };
    const job = module.exports.startEngine(request, (event) =>
      events.push(event),
    );
    listener('another', { type: 'log', message: 'wrong acquisition' });
    assert.equal(events.length, 0);
    listener('run', { type: 'vectors', names: ['out'] });
    listener('run', { type: 'finished', state: 'complete' });
    listener('run', { type: 'finished', state: 'stopped' });
    assert.deepEqual(events, [{ type: 'vectors', names: ['out'] }]);
    assert.ok(stops > 0);
    resolveStart();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events.at(-1), { type: 'finished', state: 'complete' });
    job.dispose();
    assert.equal(unsubscribed, true);

    // Electron can deliver an invoke reply before the queued stream events.
    // Keep listening until the final samples and terminal event have arrived.
    events.length = 0;
    const next = module.exports.startEngine(
      { ...request, runId: 'next' },
      (event) => events.push(event),
    );
    resolveStart();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, []);
    listener('next', { type: 'vectors', names: ['out'] });
    listener('next', { type: 'data', rows: [[3.333333333]] });
    listener('next', { type: 'finished', state: 'complete' });
    listener('next', { type: 'finished', state: 'stopped' });
    assert.deepEqual(events, [
      { type: 'vectors', names: ['out'] },
      { type: 'data', rows: [[3.333333333]] },
      { type: 'finished', state: 'complete' },
    ]);
    next.dispose();

    events.length = 0;
    const cancelled = module.exports.startEngine(request, (event) =>
      events.push(event),
    );
    cancelled.dispose();
    resolveStart();
    listener('run', { type: 'finished', state: 'complete' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      events,
      [],
      'disposed acquisitions must ignore late callbacks',
    );
  } finally {
    delete globalThis.window;
  }
});
