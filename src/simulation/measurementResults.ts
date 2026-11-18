import { dsnDrawing } from '../model/dsnDrawing';
import { NetlistData } from '../io/netlists/netlistGenerator';
import { ResultData, SimulationRun, SimulationSetup } from './contracts';
import { MeasurementResult } from './explorerTypes';
import { applyBindings } from './bindings';
import { resolvedSignals } from './signals';
import { deriveTraces } from './traces';
import { measure, metricAlgorithm } from './metrics';
import { sameMeasurementDefinitions } from './measurementPresentation';
import { NetlistWorkerState } from '../web-worker/netlistState';

export function evaluateMeasurements({
  drawing,
  net,
  data,
  setup,
  run,
  fresh,
  checking = false,
  running = false,
}: {
  drawing: dsnDrawing;
  net?: NetlistData;
  data?: ResultData;
  setup: SimulationSetup;
  run?: SimulationRun;
  fresh: boolean;
  checking?: boolean;
  running?: boolean;
}): { data?: ResultData; results: MeasurementResult[]; captured: boolean } {
  const definitions = setup.measurements || [];
  const unavailable = (explanation: string) => ({
    captured: false,
    results: definitions.map((def) => ({
      id: def.id,
      state: 'unavailable' as const,
      unit: '',
      explanation,
    })),
  });
  if (running)
    return unavailable(
      'The acquisition is still running. Measurements are available after it completes.',
    );
  if (checking)
    return unavailable(
      'Checking whether this acquisition matches the circuit.',
    );
  if (!data) {
    const missing = unavailable(
      run
        ? `Numerical data for the selected ${run.analysis.kind} acquisition is not available. Run the simulation again.`
        : 'No acquisition selected. Run a simulation or select a recorded acquisition.',
    );
    if (
      run?.explorer &&
      sameMeasurementDefinitions(run.explorer.definitions, definitions)
    )
      return {
        captured: true,
        results: missing.results.map((result) => {
          const saved = run.explorer.measurements.find(
            (item) => item.id === result.id,
          );
          return saved?.state === 'valid' && Number.isFinite(saved.value)
            ? saved
            : result;
        }),
      };
    return missing;
  }
  if (!net)
    return unavailable(
      'The circuit netlist could not be built. Correct component references and pin definitions before measuring.',
    );
  if (!fresh)
    return unavailable(
      'The circuit has changed since this acquisition. Run the simulation again before measuring.',
    );
  try {
    const captured =
      !!run?.explorer &&
      sameMeasurementDefinitions(run.explorer.definitions, definitions);
    const configured =
      run?.explorer && Object.keys(run.explorer.overrides).length
        ? applyBindings(
            drawing,
            { ...setup, bindings: run.explorer.bindings },
            run.explorer.overrides,
          ).drawing
        : drawing;
    const capturedNet =
      configured === drawing
        ? net
        : new NetlistWorkerState().init({
            ...configured,
            sheets: configured.sheets.filter((s) => s.kind !== 'simulation'),
          });
    const traces = captured
      ? run.explorer.traces || setup.traces || []
      : setup.traces || [];
    const derived = deriveTraces(
      resolvedSignals(configured, capturedNet, data, [
        ...definitions.flatMap((def) =>
          [def.source, def.reference].filter(Boolean),
        ),
        ...traces.flatMap((trace) => [trace.left, trace.right]),
      ]),
      traces,
    );
    const resolved = derived.data;
    return {
      data: resolved,
      results: definitions.map((def) => {
        const saved =
          captured && run.explorer.algorithm === metricAlgorithm
            ? run.explorer.measurements.find((result) => result.id === def.id)
            : undefined;
        // Preserve reproducible captured values; retry failures so older parser
        // errors are replaced by the current, specific diagnosis.
        if (saved?.state === 'valid' && Number.isFinite(saved.value))
          return saved;
        const result = measure(def, resolved);
        const traceError = derived.errors.find((error) =>
          [def.source, def.reference].some(
            (source) => source && error.startsWith(`Trace ${source}:`),
          ),
        );
        return result.state !== 'valid' && traceError
          ? { ...result, explanation: traceError }
          : result;
      }),
      captured,
    };
  } catch (error) {
    return unavailable(
      `Measurement signals could not be resolved: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
