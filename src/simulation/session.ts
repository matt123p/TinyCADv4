import { checkSpiceComponents, locateSpiceErrors } from './diagnostics';
import { NetlistData } from '../io/netlists/netlistGenerator';
import { dsnDrawing, DrcError } from '../model/dsnDrawing';
import {
  SimulationSetup,
  SimulationRun,
  ResultData,
  ResultPlot,
  EngineEvent,
  newIdentity,
} from './contracts';
import type { EngineJob } from './engine';
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
import { measure, checkRequirement, metricAlgorithm } from './metrics';
import { resolvedSignals } from './signals';
import { deriveTraces } from './traces';
import { ExplorerSnapshot, MeasurementResult } from './explorerTypes';
import { analysisKey, rememberAnalysis } from './analysisCache';

export interface RunningSession {
  sheetId: string;
  status: string;
  data: ResultData;
  circuitHash?: string;
  requestSetup?: SimulationSetup;
  stop(): void;
}
let active: RunningSession;
let failure = '';
interface DiagnosticsTarget {
  documentId: string;
  sheetId: string;
  runId?: string;
}
let failureTarget: DiagnosticsTarget;
let diagnosticsTarget: DiagnosticsTarget;
let documentEpoch = 0;
export function invalidateSimulationDocument(): void {
  documentEpoch++;
  stopSimulation();
  diagnosticsTarget = undefined;
  dismissSimulationFailure();
}
const listeners = new Set<() => void>();
export const getSession = () => active;
export const getSimulationFailure = () => failure;
export const getSimulationFailureTarget = () => failureTarget;
export const getSimulationDiagnosticsTarget = () => diagnosticsTarget;
export function requestSimulationDiagnostics(): void {
  diagnosticsTarget = failureTarget;
  dismissSimulationFailure();
}
export function clearSimulationDiagnosticsTarget(): void {
  diagnosticsTarget = undefined;
  publish();
}
export function dismissSimulationFailure(): void {
  failure = '';
  failureTarget = undefined;
  publish();
}
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
  reportDiagnostics?: (errors: DrcError[]) => void,
  exploration?: {
    overrides: Record<string, string>;
    settled?: (run?: SimulationRun) => void;
    resistanceTest?: SimulationRun['resistanceTest'];
  },
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
  let netlist: NetlistData;
  let deck = '';
  let diagnosticsReported = false;
  const report = (errors: DrcError[]) => {
    diagnosticsReported = true;
    reportDiagnostics?.(errors);
  };
  reportDiagnostics?.([]);
  failure = '';
  failureTarget = undefined;
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
    netlist = new NetlistWorkerState().init(circuit);
    const errors = checkSpiceComponents(netlist, setup);
    if (errors.length) {
      report(errors);
      throw new Error('Correct the SPICE errors listed below before running.');
    }
    deck = buildDeck(netlist, setup);
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
      exploration?.settled?.();
      return;
    }
    if (setup.runs.length >= 1000)
      throw new Error(
        'This sheet has reached its 1000-run history limit. Duplicate its setup to start a new history.',
      );
    active.circuitHash = circuitHash;
    active.requestSetup = setup;
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
      ...(exploration?.resistanceTest ? { resistanceTest: structuredClone(exploration.resistanceTest) } : {}),
    };
    const finish = (event: Extract<EngineEvent, { type: 'finished' }>) => {
      if (finished) return;
      finished = true;
      if (epoch !== documentEpoch) {
        job?.dispose();
        active = undefined;
        publish();
        exploration?.settled?.();
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
      const definitions = structuredClone(setup.measurements || []);
      const requirements = structuredClone(setup.requirements || []);
      let measured: ResultData;
      if (definitions.length && event.state === 'complete') {
        try {
          measured = deriveTraces(
            resolvedSignals(
              drawing,
              netlist,
              data,
              definitions.flatMap((d) =>
                [d.source, d.reference].filter(Boolean),
              ),
            ),
            setup.traces || [],
          ).data;
        } catch {
          /* Keep the solver acquisition and report unavailable measurements. */
        }
      }
      const results = definitions.map((definition) =>
        measure(definition, event.state === 'complete' ? measured : undefined),
      );
      run.explorer = {
        algorithm: metricAlgorithm,
        traces: structuredClone(setup.traces || []),
        definitions,
        requirements,
        measurements: results,
        checks: requirements.map((rule) => checkRequirement(rule, results)),
        overrides: { ...exploration?.overrides },
        bindings: structuredClone(setup.bindings || []),
      } satisfies ExplorerSnapshot;
      if (event.state === 'failed' && !run.error)
        run.error =
          'ngspice could not complete this analysis. See Diagnostics for details.';
      if (event.state === 'failed')
        report(locateSpiceErrors(netlist, deck, run.error, data.log));
      if (event.state === 'stopped') run.stopMethod = 'terminated';
      try {
        if (data.vectors.length && samples) {
          putResult(run.id, data);
          run.dataState = 'available';
        }
      } catch (error) {
        run.state = 'failed';
        run.error = String(error);
        run.explorer.measurements =
          run.explorer.measurements.map<MeasurementResult>((result) => ({
            ...result,
            state: 'unavailable',
            value: undefined,
            explanation: run.error,
          }));
        run.explorer.checks = run.explorer.checks.map((result) => ({
          ...result,
          state: 'unavailable',
          explanation: run.error,
        }));
      }
      // Keep failure details even when the solver produced no numerical data.
      // Bound text stored in run history independently of numerical buffers.
      if (run.state === 'failed' && data.log)
        run.diagnosticLog =
          data.log.length > 64 * 1024
            ? '[Earlier solver output omitted]\n' +
              data.log.slice(-(64 * 1024 - 32))
            : data.log;
      job?.dispose();
      active = undefined;
      rememberAnalysis(
        analysisKey(
          drawing.documentId,
          sheetId,
          circuitHash,
          setup,
          exploration?.overrides || {},
        ),
        run,
      );
      commit(run);
      if (run.state === 'failed' && !cancelled) {
        failure = run.error;
        failureTarget = {
          documentId: drawing.documentId,
          sheetId,
          runId: run.id,
        };
      }
      publish();
      exploration?.settled?.(run);
    };
    active.status = 'Running…';
    publish();
    const { startEngine } = await import('./engine');
    if (cancelled || epoch !== documentEpoch) {
      active = undefined;
      publish();
      exploration?.settled?.();
      return;
    }
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
              /^(?:stderr\s+)?(?:Error(?:[:\s])|Fatal|doAnalyses:|.*(?:simulation.*aborted|timestep too small))/i.test(
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
    if (!diagnosticsReported)
      report(
        locateSpiceErrors(
          netlist,
          deck,
          error instanceof Error ? error.message : String(error),
        ),
      );
    active = undefined;
    if (epoch === documentEpoch && !cancelled) {
      failure = error instanceof Error ? error.message : String(error);
      failureTarget = { documentId: drawing.documentId, sheetId };
    }
    publish();
    throw error;
  }
}
