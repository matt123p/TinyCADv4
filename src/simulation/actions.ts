import { SimulationSetup } from './contracts';

export type SimulationAction =
  | { type: 'simulation/add'; name: string }
  | { type: 'simulation/update'; sheetId: string; setup: SimulationSetup }
  | { type: 'simulation/remove-results'; ids?: string[] }
  | { type: 'simulation/format'; representation: 'auto' | 'xml' | 'zip-v1' };
