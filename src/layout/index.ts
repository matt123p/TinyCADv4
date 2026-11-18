export { optimiseLayout } from './optimise';
export { analyseLayout } from './analyse';
export { connectivitySignature, sameConnectivity } from './connectivity';
export type {
  LayoutOptions,
  LayoutResult,
  LayoutAnalysis,
  LayoutMetrics,
  LayoutDiagnostic,
  LayoutChange,
  LayoutPhase,
} from './types';
import { optimiseLayout } from './optimise';
import { LayoutOptions } from './types';
import { dsnSheet } from '../model/dsnDrawing';

export const autoPlaceSymbolText = (
  sheet: dsnSheet,
  options: LayoutOptions = {},
) => optimiseLayout(sheet, { ...options, phases: ['symbol-text'] });
export const compactLayout = (sheet: dsnSheet, options: LayoutOptions = {}) =>
  optimiseLayout(sheet, {
    ...options,
    phases: ['symbol-text', 'net-labels', 'placement', 'compaction'],
  });
export const repairWiring = (sheet: dsnSheet, options: LayoutOptions = {}) =>
  optimiseLayout(sheet, {
    ...options,
    phases: ['routing', 'net-labels', 'junctions'],
  });
