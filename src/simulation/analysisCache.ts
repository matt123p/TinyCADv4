import { SimulationRun, SimulationSetup } from './contracts';
import { getResult } from './resultStore';
// Renderer-session cache: bundled engine identity is fixed until the app reloads.
// Numerical storage and its memory limits remain owned by resultStore.
const cache = new Map<string, SimulationRun>();
export function analysisKey(
  documentId: string,
  sheetId: string,
  hash: string,
  setup: SimulationSetup,
  overrides: Record<string, string>,
): string {
  return JSON.stringify({
    documentId,
    sheetId,
    backend: process.env.TARGET_SYSTEM,
    hash,
    analysis: setup.analysis,
    parameters: setup.parameters,
    metrics: setup.measurements || [],
    traces: setup.traces || [],
    requirements: setup.requirements || [],
    bindings: setup.bindings || [],
    overrides,
  });
}
export function cachedAnalysis(key: string): SimulationRun | undefined {
  const run = cache.get(key);
  if (!run || run.state !== 'complete' || !getResult(run.id)) {
    cache.delete(key);
    return;
  }
  cache.delete(key);
  cache.set(key, run);
  return run;
}
export function rememberAnalysis(key: string, run: SimulationRun): void {
  if (run.state !== 'complete' || run.dataState !== 'available') return;
  cache.set(key, run);
  while (cache.size > 100) cache.delete(cache.keys().next().value);
}
