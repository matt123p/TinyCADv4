import { DrcError } from '../model/dsnDrawing';
import { SimulationSetup } from './contracts';

export type SimulationAction =
  | { type: 'simulation/diagnostics'; documentId: string; errors: DrcError[] }
  | { type: 'simulation/add'; name: string }
  | { type: 'simulation/duplicate'; sheetId: string }
  | { type: 'simulation/update'; sheetId: string; setup: SimulationSetup }
  | { type: 'simulation/remove-results'; ids?: string[] }
  | { type: 'simulation/format'; representation: 'auto' | 'xml' | 'zip-v1' };
