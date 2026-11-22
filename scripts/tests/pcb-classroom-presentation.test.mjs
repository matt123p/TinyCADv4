import assert from 'node:assert/strict';
import test from 'node:test';
import { classroomPresentationSample } from '../pcb/classroom-presentation.mjs';

const begin = { name: 'tinycad-classroom-pan-begin', pid: 10, ts: 100_000 };
const end = { name: 'tinycad-classroom-pan-end', pid: 10, ts: 150_000 };

function reporter(id, start, finish, options = {}) {
  const { pid = 10, layer = 2, state = 'STATE_PRESENTED_ALL' } = options;
  const track = { name: 'PipelineReporter', pid, tid: 15, id2: { local: id } };
  return [
    { ...track, ph: 'b', ts: start, args: { frame_reporter: { state, layer_tree_host_id: layer } } },
    { ...track, ph: 'e', ts: finish },
  ];
}

test('counts renderer presentation feedback once and only inside the input window', () => {
  const sample = classroomPresentationSample([
    ...reporter('prior', 99_000, 101_000),
    begin,
    ...reporter('a', 101_000, 110_000),
    ...reporter('fork', 102_000, 110_000),
    ...reporter('foreign', 102_000, 120_000, { pid: 11 }),
    ...reporter('drop', 103_000, 122_000, { state: 'STATE_DROPPED' }),
    ...reporter('a', 112_000, 130_000, { state: 'STATE_PRESENTED_PARTIAL' }),
    ...reporter('tail', 131_000, 150_000),
    end,
  ], 'pan', { inputs: 3, viewChanges: 3 });

  assert.equal(sample.status, 'measured');
  assert.equal(sample.frames, 2);
  assert.equal(sample.durationMs, 50);
  assert.equal(sample.fps, 40);
  assert.deepEqual(sample.presentationMs, [10, 30]);
  assert.equal(sample.intervalMs.p95, 20);
});

test('reports unavailable when feedback is missing or different layer trees overlap', () => {
  const callbacksOnly = classroomPresentationSample([begin, end], 'pan', { viewChanges: 10 });
  assert.equal(callbacksOnly.status, 'unavailable');
  assert.equal(callbacksOnly.fps, undefined);

  const ambiguous = classroomPresentationSample([
    begin,
    ...reporter('a', 101_000, 110_000),
    ...reporter('other', 102_000, 120_000, { layer: 3 }),
    end,
  ], 'pan', { viewChanges: 10 });
  assert.equal(ambiguous.status, 'unavailable');
  assert.equal(ambiguous.fps, undefined);
});
