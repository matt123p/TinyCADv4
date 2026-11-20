import { runG0Fixture } from './g0-fixture';
import type { GeometryCandidate } from './g0-fixture';
import type { GeometryRevision } from '../../src/pcb/geometryRevision';

self.onmessage = async ({
  data,
}: MessageEvent<{
  candidate: GeometryCandidate;
  snapshot: GeometryRevision;
  iterations?: number;
}>) => {
  const { candidate, snapshot } = data;
  self.postMessage({ kind: 'running', snapshot });
  try {
    const response =
      candidate === 'wasm' ? await fetch('./clipper2z.wasm') : null;
    if (response && !response.ok)
      throw new Error('The benchmark WASM binary did not load.');
    const result = await runG0Fixture(
      candidate,
      response ? await response.arrayBuffer() : undefined,
      data.iterations,
    );
    self.postMessage({ kind: 'result', snapshot, result });
  } catch (error) {
    self.postMessage({ kind: 'failure', snapshot, error: String(error) });
  }
};
