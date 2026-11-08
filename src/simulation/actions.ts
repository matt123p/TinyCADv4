import { DrcError } from '../model/dsnDrawing';
import { SimulationSetup } from './contracts';
import { SpiceControl } from './controls';
import { ControlTool } from './controlSymbols';

export type SimulationAction =
  | { type: 'simulation/insert-control'; tool: ControlTool | 'ground' }
  | { type: 'simulation/configure-control'; config: SpiceControl }
  | { type: 'simulation/compact-control' }
  | { type: 'simulation/control-reference'; value: string }
  | { type: 'simulation/diagnostics'; documentId: string; errors: DrcError[] }
  | { type: 'simulation/add'; name: string }
  | { type: 'simulation/duplicate'; sheetId: string }
  | { type: 'simulation/update'; sheetId: string; setup: SimulationSetup }
  | { type: 'simulation/remove-results'; ids?: string[] }
  | { type: 'simulation/format'; representation: 'auto' | 'xml' | 'zip-v1' };
