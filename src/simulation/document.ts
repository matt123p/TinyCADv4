import { dsnDrawing, dsnSheet } from '../model/dsnDrawing';
import { defaultSetup, newIdentity, SimulationSetup } from './contracts';
import { getResult, resultBytes } from './resultStore';

export function isSimulationSheet(sheet: dsnSheet): boolean {
  return sheet?.kind === 'simulation';
}

export function createSimulationSheet(base: dsnSheet, name: string): dsnSheet {
  return {
    ...base,
    id: newIdentity(),
    kind: 'simulation',
    name,
    items: [],
    symbols: {},
    images: {},
    hatches: [],
    hierarchicalSymbol: false,
    simulation: defaultSetup(),
  };
}

export function validateSetup(value: unknown): SimulationSetup {
  const setup = value as SimulationSetup;
  if (
    !setup ||
    setup.version !== 1 ||
    !setup.analysis ||
    !Array.isArray(setup.runs) ||
    !Array.isArray(setup.signals)
  ) {
    throw new Error('Unsupported or damaged simulation sheet.');
  }
  if (
    !['op', 'tran', 'ac', 'dc', 'noise', 'tf', 'pz'].includes(
      setup.analysis.kind,
    )
  )
    throw new Error('Unsupported analysis type.');
  if (setup.runs.length > 1000 || setup.signals.length > 128)
    throw new Error('Simulation sheet exceeds its data limits.');
  if (
    typeof setup.instructions !== 'string' ||
    setup.instructions.length > 100000 ||
    typeof setup.retainResults !== 'boolean' ||
    setup.signals.some((s) => typeof s !== 'string' || s.length > 256)
  )
    throw new Error('Invalid simulation sheet metadata.');
  for (const field of ['models', 'parameters'] as const) {
    const values = setup[field];
    if (
      !values ||
      typeof values !== 'object' ||
      Array.isArray(values) ||
      Object.keys(values).length > 100 ||
      Object.entries(values).some(
        ([name, value]) =>
          typeof value !== 'string' ||
          name.length > 256 ||
          value.length > 8 * 1024 * 1024,
      )
    )
      throw new Error('Invalid simulation model or parameter data.');
  }
  for (const key of Object.keys(
    defaultSetup().analysis,
  ) as (keyof typeof setup.analysis)[]) {
    if (typeof setup.analysis[key] !== typeof defaultSetup().analysis[key])
      throw new Error(`Invalid analysis field: ${key}`);
  }
  if (
    setup.traces &&
    (!Array.isArray(setup.traces) ||
      setup.traces.length > 16 ||
      setup.traces.some(
        (trace) =>
          !trace ||
          typeof trace.name !== 'string' ||
          trace.name.length > 256 ||
          typeof trace.left !== 'string' ||
          typeof trace.right !== 'string' ||
          !['subtract', 'multiply', 'divide'].includes(trace.operation),
      ))
  )
    throw new Error('Invalid derived traces.');
  for (const run of setup.runs) {
    if (
      !run ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(run.id) ||
      !Number.isSafeInteger(run.samples) ||
      run.samples < 0 ||
      !['complete', 'stopped', 'failed'].includes(run.state) ||
      !['available', 'removed', 'not-retained'].includes(run.dataState) ||
      !['wasm', 'native'].includes(run.backend) ||
      !run.analysis ||
      typeof run.parameters !== 'object' ||
      !Number.isFinite(Date.parse(run.created)) ||
      typeof run.buildId !== 'string' ||
      typeof run.circuitHash !== 'string' ||
      typeof run.setupHash !== 'string'
    )
      throw new Error('Invalid saved simulation run.');
  }
  return { ...defaultSetup(), ...setup };
}

export function withoutResults(
  drawing: dsnDrawing,
  ids?: string[],
): dsnDrawing {
  return {
    ...drawing,
    sheets: drawing.sheets.map((sheet) =>
      !isSimulationSheet(sheet)
        ? sheet
        : {
            ...sheet,
            simulation: {
              ...sheet.simulation,
              runs: sheet.simulation.runs.map((run) =>
                ids && !ids.includes(run.id)
                  ? run
                  : {
                      ...run,
                      dataState: 'removed' as const,
                    },
              ),
            },
          },
    ),
  };
}

export function storedResultBytes(drawing: dsnDrawing): number {
  return drawing.sheets.reduce(
    (sum, sheet) =>
      sum +
      (sheet.simulation?.runs || []).reduce((n, run) => {
        const result = run.dataState === 'available' && getResult(run.id);
        return n + (result ? resultBytes(result) : 0);
      }, 0),
    0,
  );
}
