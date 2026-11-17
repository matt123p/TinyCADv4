import { dsnDrawing, DrcError } from '../model/dsnDrawing';
import { SimulationSetup, SimulationRun, ResultData } from './contracts';
import { applyBindings } from './bindings';
import { runSimulation, getSession, stopSimulation } from './session';
import { getResult } from './resultStore';
import { buildDeck } from './deck';
import { NetlistWorkerState } from '../web-worker/netlistState';
import { digest } from '../io/dsnContainer';
import { analysisKey, cachedAnalysis } from './analysisCache';
import { SweepRun } from './explorerTypes';

export interface ExplorationPoint {
  value: number;
  run: SimulationRun;
  data?: ResultData;
}
export function restoredSweep(
  batch: SweepRun | undefined,
  setup: SimulationSetup,
): ExplorationPoint[] {
  return (
    batch?.points.flatMap((point) => {
      const run = setup.runs.find((r) => r.id === point.runId);
      return run
        ? [
            {
              value: point.value,
              run,
              data:
                run.dataState === 'available' ? getResult(run.id) : undefined,
            },
          ]
        : [];
    }) || []
  );
}
export async function exploreOnce(
  drawing: dsnDrawing,
  sheetId: string,
  setup: SimulationSetup,
  overrides: Record<string, string>,
  commit: (run: SimulationRun) => void,
  signal: AbortSignal,
  diagnostics?: (errors: DrcError[]) => void,
): Promise<SimulationRun> {
  if (signal.aborted) throw new Error('Exploration cancelled.');
  if (getSession())
    throw new Error('Wait for the current simulation or stop it first.');
  const changed = applyBindings(drawing, setup, overrides);
  const net = new NetlistWorkerState().init({
    ...changed.drawing,
    sheets: changed.drawing.sheets.filter((s) => s.kind !== 'simulation'),
  });
  const circuitHash = await digest(
    new TextEncoder().encode(
      buildDeck(net, changed.setup) + JSON.stringify(changed.setup.models),
    ),
  );
  if (signal.aborted) throw new Error('Exploration cancelled.');
  const key = analysisKey(
    drawing.documentId,
    sheetId,
    circuitHash,
    changed.setup,
    overrides,
  );
  const previous = cachedAnalysis(key);
  if (
    previous &&
    setup.runs.some((r) => r.id === previous.id && r.dataState === 'available')
  ) {
    return previous;
  }
  return new Promise<SimulationRun>((resolve, reject) => {
    const abort = () => stopSimulation();
    signal.addEventListener('abort', abort, { once: true });
    let settled = false;
    const complete = (run?: SimulationRun) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      if (!run || signal.aborted) reject(new Error('Exploration cancelled.'));
      else {
        resolve(run);
      }
    };
    runSimulation(
      changed.drawing,
      sheetId,
      changed.setup,
      commit,
      diagnostics,
      {
        overrides,
        settled: complete,
      },
    ).catch((error) => {
      signal.removeEventListener('abort', abort);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}
export async function runSweep(
  values: number[],
  execute: (value: number) => Promise<SimulationRun>,
  publish: (point: ExplorationPoint, index: number) => void,
  signal: AbortSignal,
): Promise<void> {
  if (!values.length || values.length > 100)
    throw new Error('Sweep requires 1–100 values.');
  for (let i = 0; i < values.length; i++) {
    if (signal.aborted) break;
    const run = await execute(values[i]);
    if (signal.aborted) break;
    publish({ value: values[i], run, data: getResult(run.id) }, i);
    if (run.state === 'stopped') break;
  }
}
