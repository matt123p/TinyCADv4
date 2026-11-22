import { once } from 'node:events';
import { stats } from './classroom-performance.mjs';

const marker = (phase, edge) => `tinycad-classroom-${phase}-${edge}`;
const presented = new Set(['STATE_PRESENTED_ALL', 'STATE_PRESENTED_PARTIAL']);

export function classroomPresentationSample(events, phase, updates) {
  const unavailable = (reason) => ({ status: 'unavailable', reason, ...updates });
  const begin = events.find(({ name }) => name === marker(phase, 'begin'));
  const end = events.find(({ name }) => name === marker(phase, 'end'));
  if (!begin || !end || begin.pid !== end.pid || end.ts <= begin.ts)
    return unavailable('Chromium did not report the two page timing markers.');

  const reports = new Map();
  const framesByLayerTree = new Map();
  for (const event of events) {
    if (event.pid !== begin.pid || event.name !== 'PipelineReporter') continue;
    const id = event.id2?.local ?? event.id2?.global ?? event.id;
    if (id === undefined) continue;
    const track = `${event.tid}:${id}`;
    if (event.ph === 'b') {
      reports.set(track, event);
    } else if (event.ph === 'e') {
      const report = reports.get(track);
      reports.delete(track);
      const frame = report?.args?.frame_reporter;
      if (!presented.has(frame?.state) || frame.layer_tree_host_id === undefined ||
          report.ts < begin.ts || event.ts < report.ts || event.ts >= end.ts) continue;
      const timestamps = framesByLayerTree.get(frame.layer_tree_host_id) ?? new Set();
      // Forked pipeline reports can share the same presentation feedback.
      timestamps.add(event.ts);
      framesByLayerTree.set(frame.layer_tree_host_id, timestamps);
    }
  }
  if (framesByLayerTree.size !== 1)
    return unavailable(framesByLayerTree.size
      ? 'Chromium reported more than one renderer layer tree in this sample.'
      : 'Chromium reported no presented compositor frames in this sample.');
  const [timestamps] = framesByLayerTree.values();
  const presentationMs = [...timestamps].sort((a, b) => a - b).map((ts) => (ts - begin.ts) / 1000);
  if (presentationMs.length < 2)
    return unavailable('Chromium reported too few compositor frames to measure delivery.');
  const durationMs = (end.ts - begin.ts) / 1000;
  return {
    status: 'measured',
    ...updates,
    durationMs,
    frames: presentationMs.length,
    fps: presentationMs.length * 1000 / durationMs,
    presentationMs,
    intervalMs: stats(presentationMs.slice(1).map((time, index) => time - presentationMs[index])),
  };
}

export async function measureClassroomPresentation(page, cdp) {
  const canvas = page.getByRole('img', { name: 'Board layout' });
  const workloads = ['pan', 'zoom'].map((phase) => ({
    phase, begin: marker(phase, 'begin'), end: marker(phase, 'end'),
  }));
  const events = [];
  const collect = ({ value }) => { events.push(...value); };
  cdp.on('Tracing.dataCollected', collect);
  let updates;
  let complete;
  try {
    await cdp.send('Tracing.start', {
      traceConfig: { includedCategories: ['benchmark', 'blink.user_timing'] },
    });
    try {
      updates = await canvas.evaluate(async (svg, workloads) => {
        const { x, y, width, height } = svg.getBoundingClientRect();
        const phases = [];
        const inputs = 120;
        for (const { phase, begin, end } of workloads) {
          await new Promise(requestAnimationFrame);
          let view = svg.getAttribute('data-view-box');
          let viewChanges = 0;
          performance.mark(begin);
          for (let i = 0; i < inputs; i++) {
            svg.dispatchEvent(new WheelEvent('wheel', {
              clientX: x + width / 2,
              clientY: y + height / 2,
              deltaY: (i % 2 ? -1 : 1) * (phase === 'zoom' ? 120 : 24),
              shiftKey: phase === 'zoom',
              bubbles: true,
              cancelable: true,
            }));
            await new Promise(requestAnimationFrame);
            const next = svg.getAttribute('data-view-box');
            if (next !== view) viewChanges++;
            view = next;
          }
          performance.mark(end);
          performance.clearMarks(begin);
          performance.clearMarks(end);
          if (!viewChanges) throw new Error('The classroom board did not respond to ' + phase + '.');
          phases.push({ phase, inputs, viewChanges });
        }
        return phases;
      }, workloads, { timeout: 20_000 });
    } finally {
      const [completionEvents] = await Promise.all([
        once(cdp, 'Tracing.tracingComplete', { signal: AbortSignal.timeout(15_000) }),
        cdp.send('Tracing.end'),
      ]);
      [complete] = completionEvents;
    }
  } finally {
    cdp.off('Tracing.dataCollected', collect);
  }
  return updates.map(({ phase, ...work }) => ({
    phase,
    ...(complete.dataLossOccurred
      ? { status: 'unavailable', reason: 'Chromium reported trace data loss.', ...work }
      : classroomPresentationSample(events, phase, work)),
  }));
}
