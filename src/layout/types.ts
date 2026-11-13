import { DocItem } from '../model/dsnItem';
import { dsnSheet } from '../model/dsnDrawing';

export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export type Point = [number, number];
export type LayoutPhase =
  | 'symbol-text'
  | 'net-labels'
  | 'routing'
  | 'placement'
  | 'compaction'
  | 'junctions';
export interface LayoutOptions {
  phases?: LayoutPhase[];
  /** Share a bounded search across phases instead of exhausting it on the first one. */
  balancePhases?: boolean;
  /** Input was just constructed by the native XML reader; retain its fresh text caches. */
  prepared?: boolean;
  /** Host resource fraction remaining (0..1), used to return a safe partial proposal. */
  remainingBudget?: () => number;
  disturbance?: 'low' | 'medium' | 'high';
  /** Optional classification override for the editor/MCP caller. */
  largeSymbolIds?: number[];
  /** Omitted means all supported circuit items. An empty list selects nothing. */
  selectedIds?: number[];
  lockedIds?: number[];
  grid?: number;
  clearance?: number;
  /** Separation between unrelated annotations, beyond literal collision avoidance. */
  annotationClearance?: number;
  pinLead?: number;
  /** Preferred space between rigid objects after removing empty strips. */
  corridor?: number;
  maxPasses?: number;
  maxEvaluations?: number;
  /** Optional reproducible exploration of text positions. Zero disables it. */
  annealingSteps?: number;
  seed?: number;
  cancelled?: () => boolean;
}
export interface LayoutSettings extends LayoutOptions {
  /** Original verified topology, reused while scoring connectivity-preserving proposals. */
  symbolConnections?: { a: number; b: number; weight: number }[];
  physicalPartition?: string;
  fixedSymbolIds?: number[];
  grid: number;
  clearance: number;
  annotationClearance: number;
  pinLead: number;
  corridor: number;
  maxPasses: number;
  maxEvaluations: number;
  annealingSteps: number;
  seed: number;
}
export interface LayoutDiagnostic {
  code: string;
  itemIds: number[];
  message: string;
}
export interface LayoutMetrics {
  bodyCollisions: number;
  wireBodyCollisions: number;
  crossings: number;
  overlaps: number;
  diagonalSegments: number;
  pinExitViolations: number;
  textCollisions: number;
  annotationCrowding: number;
  componentDisorder: number;
  labelOverhangs: number;
  netLabelPosition: number;
  labelAlignment: number;
  junctionIssues: number;
  bundleDisorder: number;
  connectedDistance: number;
  logicalProximity: number;
  inlineImbalance: number;
  wireLength: number;
  bends: number;
  area: number;
  labelDistance: number;
}
export interface LayoutAnalysis {
  metrics: LayoutMetrics;
  diagnostics: LayoutDiagnostic[];
}
export interface LayoutChange {
  id: number;
  before?: DocItem;
  after?: DocItem;
}
export interface LayoutResult {
  /** New native segments mapped to the original routed wire for partition checks. */
  wireOrigins: Record<number, number>;
  sheet: dsnSheet;
  changes: LayoutChange[];
  before: LayoutAnalysis;
  after: LayoutAnalysis;
  evaluations: number;
  phaseProgress: { phase: LayoutPhase; pass: number; evaluations: number; budgetExhausted: boolean }[];
  stopped: 'converged' | 'budget' | 'cancelled' | 'pass-limit';
  connectivityPreserved: boolean;
}
