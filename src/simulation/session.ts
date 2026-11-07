import { dsnDrawing } from '../model/dsnDrawing';
import {
  SimulationSetup,
  SimulationRun,
  ResultData,
  ResultPlot,
  EngineEvent,
  newIdentity,
} from './contracts';
import { startEngine, EngineJob } from './engine';
import { buildDeck } from './deck';
import { digest } from '../io/dsnContainer';
import {
  putResult,
  vectorUnit,
  MAX_RUN_BYTES,
  resultBytes,
  activateResultDocument,
} from './resultStore';
import { NetlistWorkerState } from '../web-worker/netlistState';

export interface RunningSession {
  sheetId: string;
  status: string;
  data: ResultData;
  stop(): void;
}
let active: RunningSession;
let documentEpoch = 0;
export function invalidateSimulationDocument(): void {
  documentEpoch++;
  stopSimulation();
}
const listeners = new Set<() => void>();
export const getSession = () => active;
export const subscribeSession = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function publish() {
  listeners.forEach((listener) => listener());
}
export function stopSimulation() {
  active?.stop();
}

export async function runSimulation(
  drawing: dsnDrawing,
  sheetId: string,
  setup: SimulationSetup,
  commit: (run: SimulationRun) => void,
): Promise<void> {
  if (active)
    throw new Error(
      'A simulation is already running. Stop it before starting another.',
    );
  const epoch = documentEpoch;
  activateResultDocument(drawing.documentId);
  const data: ResultData = { vectors: [], scale: '', log: '' };
  let plot: ResultPlot = data;
  let cancelled = false,
    job: EngineJob,
    finished = false,
    samples = 0,
    lastPublished = 0;
  let solverFailure = '';
  active = {
    sheetId,
    data,
    status: 'Checking circuit…',
    stop() {
      cancelled = true;
      if (job) job.stop();
    },
  };
  publish();
  try {
    const circuit = {
      ...drawing,
      sheets: drawing.sheets.filter((sheet) => sheet.kind !== 'simulation'),
    };
    const netlist = new NetlistWorkerState().init(circuit);
    const deck = buildDeck(netlist, setup);
    if (process.env.TARGET_SYSTEM !== 'electron' && /^\s*A\S*\s/im.test(deck))
      throw new Error(
        'This circuit uses XSPICE code models. Run it in the Electron desktop app; the browser engine supports analogue models only.',
      );
    const circuitHash = await digest(
      new TextEncoder().encode(deck + JSON.stringify(setup.models)),
    );
    const setupHash = await digest(
      new TextEncoder().encode(
        JSON.stringify({
          analysis: setup.analysis,
          parameters: setup.parameters,
          models: setup.models,
        }),
      ),
    );
    if (cancelled) {
      active = undefined;
      publish();
      return;
    }
    if (setup.runs.length >= 1000)
      throw new Error(
        'This sheet has reached its 1000-run history limit. Duplicate its setup to start a new history.',
      );
    const run: SimulationRun = {
      id: newIdentity(),
      created: new Date().toISOString(),
      state: 'failed',
      backend: process.env.TARGET_SYSTEM === 'electron' ? 'native' : 'wasm',
      buildId: 'unavailable',
      circuitHash,
      setupHash,
      analysis: { ...setup.analysis },
      parameters: { ...setup.parameters },
      samples: 0,
      pinned: false,
      dataState: 'not-retained',
    };
    const finish = (event: Extract<EngineEvent, { type: 'finished' }>) => {
      if (finished) return;
      finished = true;
      if (epoch !== documentEpoch) {
        job?.dispose();
        active = undefined;
        publish();
        return;
      }
      if (event.state === 'complete' && (solverFailure || !samples))
        event = {
          ...event,
          state: 'failed',
          error:
            solverFailure ||
            'The solver produced no numerical samples. See Diagnostics for details.',
        };
      run.state = event.state;
      run.error = event.error;
      run.samples = samples;
      if (event.state === 'failed' && !run.error)
        run.error =
          'ngspice could not complete this analysis. See Diagnostics for details.';
      if (event.state === 'stopped') run.stopMethod = 'terminated';
      try {
        if (data.vectors.length && samples) {
          putResult(run.id, data);
          run.dataState = 'available';
        }
      } catch (error) {
        run.state = 'failed';
        run.error = String(error);
      }
      job?.dispose();
      active = undefined;
      commit(run);
      publish();
    };
    active.status = 'Running…';
    publish();
    job = startEngine(
      { runId: run.id, deck, files: setup.models, maxBytes: MAX_RUN_BYTES },
      (event) => {
        if (finished) return;
        try {
          if (event.type === 'ready') {
            run.buildId = event.info.buildId;
          } else if (event.type === 'vectors') {
            if (
              !Array.isArray(event.names) ||
              event.names.length > 128 ||
              (data.plots?.length || 0) > 8
            )
              throw new Error('Unexpected solver vector definitions.');
            if (plot.vectors.length) {
              plot = { vectors: [], scale: '' };
              (data.plots ||= []).push(plot);
            }
            plot.vectors = event.names.map((name) => ({
              name,
              unit:
                /^Transfer_function$/i.test(name) &&
                /^i/i.test(setup.analysis.input)
                  ? 'Ohm'
                  : /^inoise/.test(name) && /^i/i.test(setup.analysis.input)
                  ? /total/.test(name)
                    ? 'A RMS'
                    : 'A/√Hz'
                  : vectorUnit(name),
              real: [] as number[],
              imaginary: [] as number[],
            }));
            plot.scale =
              event.names.find((name) =>
                /^(?:time|frequency|v-sweep|i-sweep|temp-sweep)$/.test(name),
              ) || '';
          } else if (event.type === 'data') {
            if (
              !plot.vectors.length ||
              resultBytes(data) + event.rows.length * plot.vectors.length * 16 >
                MAX_RUN_BYTES
            )
              throw new Error('Simulation exceeded its 64 MiB result limit.');
            event.rows.forEach((row, index) => {
              if (
                row.length !== plot.vectors.length ||
                row.some((value) => !Number.isFinite(value))
              )
                throw new Error('Invalid solver values.');
              row.forEach((value, column) => {
                plot.vectors[column].real.push(value);
                const im = event.imaginary?.[index]?.[column] || 0;
                if (!Number.isFinite(im))
                  throw new Error('Invalid imaginary value.');
                plot.vectors[column].imaginary.push(im);
              });
            });
            if (plot === data) samples += event.rows.length;
          } else if (event.type === 'log') {
            if (
              /^stderr\s+(?:Error(?:[:\s])|Fatal|doAnalyses:|.*(?:simulation.*aborted|timestep too small))/i.test(
                event.message,
              )
            )
              solverFailure ||= event.message;
            if (data.log.length < 2 * 1024 * 1024)
              data.log += event.message + '\n';
          } else if (event.type === 'finished') {
            finish(event);
            return;
          }
          if (Date.now() - lastPublished > 100) {
            lastPublished = Date.now();
            publish();
          }
        } catch (error) {
          finish({ type: 'finished', state: 'failed', error: String(error) });
          job?.stop();
        }
      },
    );
    if (finished) job.dispose();
  } catch (error) {
    active = undefined;
    publish();
    throw error;
  }
}
