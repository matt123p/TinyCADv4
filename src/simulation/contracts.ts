export type AnalysisKind = 'op' | 'tran' | 'ac' | 'dc' | 'noise' | 'tf' | 'pz';
export type RunState = 'complete' | 'stopped' | 'failed';

export interface AnalysisDefinition {
  kind: AnalysisKind;
  duration: string;
  maxStep: string;
  startFrequency: string;
  stopFrequency: string;
  pointsPerDecade: number;
  source: string;
  sweepStart: string;
  sweepStop: string;
  sweepStep: string;
  input: string;
  output: string;
  reference: string;
  temperature: string;
  initialConditions: boolean;
}

export interface SimulationRun {
  explorer?: import('./explorerTypes').ExplorerSnapshot;
  id: string;
  created: string;
  state: RunState;
  backend: 'wasm' | 'native';
  buildId: string;
  circuitHash: string;
  setupHash: string;
  analysis: AnalysisDefinition;
  parameters: Record<string, string>;
  samples: number;
  pinned: boolean;
  dataState: 'available' | 'removed' | 'not-retained';
  error?: string;
  stopMethod?: string;
}

export interface SimulationSetup {
  measurements?: import('./explorerTypes').MeasurementDefinition[];
  requirements?: import('./explorerTypes').RequirementDefinition[];
  bindings?: import('./explorerTypes').ParameterBinding[];
  sweep?: import('./explorerTypes').SweepDefinition;
  sweeps?: import('./explorerTypes').SweepRun[];
  version: 1;
  instructions: string;
  analysis: AnalysisDefinition;
  signals: string[];
  parameters: Record<string, string>;
  models: Record<string, string>;
  runs: SimulationRun[];
  retainResults: boolean;
  traces?: import('./traces').TraceDefinition[];
}

export interface ResultVector {
  name: string;
  unit: string;
  real: number[];
  imaginary?: number[];
}

export interface ResultPlot {
  vectors: ResultVector[];
  scale: string;
}

export interface ResultData extends ResultPlot {
  log: string;
  plots?: ResultPlot[];
}

export interface EngineInfo {
  backend: 'wasm' | 'native';
  buildId: string;
  version: string;
  protocol: 1;
  capabilities: { live: boolean; pause: boolean; xspice: boolean };
}

export type EngineEvent =
  | { type: 'ready'; info: EngineInfo }
  | { type: 'vectors'; names: string[] }
  | { type: 'data'; rows: number[][]; imaginary?: number[][] }
  | { type: 'log'; message: string }
  | { type: 'finished'; state: RunState; error?: string };

export interface EngineRequest {
  runId: string;
  deck: string;
  files: Record<string, string>;
  maxBytes: number;
}

export const defaultAnalysis = (): AnalysisDefinition => ({
  kind: 'op',
  duration: '5ms',
  maxStep: '10us',
  startFrequency: '10Hz',
  stopFrequency: '100kHz',
  pointsPerDecade: 100,
  source: '',
  sweepStart: '0',
  sweepStop: '5',
  sweepStep: '0.1',
  input: '',
  output: '',
  reference: '0',
  temperature: '27',
  initialConditions: false,
});

export const defaultSetup = (): SimulationSetup => ({
  version: 1,
  instructions: '',
  analysis: defaultAnalysis(),
  signals: [],
  parameters: {},
  models: {},
  runs: [],
  retainResults: true,
  traces: [],
});

export function newIdentity(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID)
    return crypto.randomUUID();
  throw new Error('TinyCAD simulation requires a secure browser context.');
}
