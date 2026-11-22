import type { BoardDocument } from './board';
import type { boardArtwork } from './boardArtwork';
import type { BoardIssue } from './boardChecks';
import type { boardCopperGeometry } from './boardCopperGeometry';
import type { CircuitSnapshot } from './circuitSnapshot';
import type { PolygonRegion } from './contours';
import type { analyseCopper, CopperFeature } from './copper';
import { boardPadSources } from './boardPadSources';
import { bounds } from './regionDistances';

export type CheckResult = 'passed' | 'failed' | 'waived' | 'not-run' | 'stale' | 'not-applicable';
type FindingSeverity = 'blocker' | 'error' | 'warning' | 'info' | 'unknown';
type SourcePin = ReturnType<typeof boardPadSources>[number]['source'] & { readonly label: string };

export interface BoardFinding extends BoardIssue {
  readonly boardId: string;
  readonly revision: number;
  readonly severity: FindingSeverity;
  readonly result: CheckResult;
  readonly layers: readonly string[];
  readonly boundsNm?: ReturnType<typeof bounds>;
  readonly measurement?: {
    readonly unit: 'nm' | 'permille';
    readonly measured?: number;
    readonly required?: number;
  };
  readonly ruleIds: readonly string[];
  readonly sourcePins: readonly SourcePin[];
}

const blockers = new Set([
  'short', 'unmapped-signals', 'duplicate-reference', 'duplicate-component',
  'schematic-update-pending', 'fabrication-applicability', 'silk-geometry', 'layer-artwork',
  'silk-text', 'drill-overlap',
]);
const unknowns = new Set(['schematic-unavailable', 'zone-width-unverified', 'fabrication-outline-unverified']);

function severityFor(code: string): FindingSeverity {
  if (blockers.has(code)) return 'blocker';
  if (unknowns.has(code)) return 'unknown';
  if (code === 'bare-open-bridged') return 'warning';
  return 'error';
}

export function findingBlocksRelease(finding: BoardFinding) {
  return finding.result !== 'waived' &&
    ['blocker', 'error', 'unknown'].includes(finding.severity);
}

export function boardFindings(
  board: BoardDocument,
  issues: readonly BoardIssue[],
  geometry: ReturnType<typeof boardCopperGeometry>,
  features: readonly CopperFeature[],
  artwork: ReturnType<typeof boardArtwork>,
  fragments: ReadonlyMap<string, ReturnType<typeof analyseCopper>['copper'][number]> | undefined,
  source: CircuitSnapshot | undefined,
): BoardFinding[] {
  if (!issues.length) return [];
  const copper = new Map(features.map((feature) => [feature.id, feature]));
  const drills = new Map(geometry.drills.map((drill) => [drill.id, drill]));
  const apertures = new Map(geometry.apertures.map((aperture) => [aperture.id, aperture]));
  const prints = new Map([...artwork.silk, ...artwork.courtyards].map((item) => [item.id, item]));
  const placements = new Map(board.footprints?.map((item) => [item.componentId, item]));
  const ruleIds = new Set(board.routingRegions?.map(({ id }) => id));
  const terminals = new Map<string, CopperFeature[]>();
  const pads = new Map<string, CopperFeature[]>();
  for (const feature of features) {
    if (feature.terminalId) addToIndex(terminals, feature.terminalId, feature);
    if (feature.kind === 'pad') addToIndex(pads, padKey(feature.id), feature);
  }
  const padSources = new Map<string, SourcePin[]>();
  const signalSources = new Map<string, SourcePin[]>();
  if (source) {
    for (const { footprintId, padId, reference, signal, source: pin } of boardPadSources(board, source))
      addToIndex(padSources, footprintId + ':' + padId, { ...pin, label: reference + ' · ' + signal });
    const parts = new Map(source.components.map((item) => [item.id, item]));
    for (const { id, logicalId } of board.components ?? []) {
      const part = parts.get(logicalId ?? id);
      for (const signal of part?.signals ?? [])
        for (const { unitId, pinId } of signal.terminals) {
          const locator = source.sources?.[unitId.toLowerCase()];
          if (locator) addToIndex(signalSources, id + ':' + signal.id, {
            ...locator, pinId, label: part.reference + ' · ' + signal.name,
          });
        }
    }
  }
  return issues.map((issue) => {
    const layers = new Set(issue.layers);
    const pins = new Map<string, SourcePin>();
    let box: BoardFinding['boundsNm'];
    const addRegion = (region: PolygonRegion) => {
      const next = bounds(region);
      box = box ? {
        minX: Math.min(box.minX, next.minX), minY: Math.min(box.minY, next.minY),
        maxX: Math.max(box.maxX, next.maxX), maxY: Math.max(box.maxY, next.maxY),
      } : next;
    };
    const addPins = (sources: readonly SourcePin[] | undefined) => {
      for (const pin of sources ?? []) pins.set(pin.unitId + ':' + pin.pinId, pin);
    };
    let geometryLocation: BoardIssue['location'];
    const addLand = (feature: CopperFeature, region = feature.region) => {
      layers.add('copper-' + feature.layerId);
      addRegion(region);
      geometryLocation ??= region.outer[0];
      if (feature.kind === 'pad') addPins(padSources.get(padKey(feature.id)));
    };
    let location = issue.location;
    for (const id of issue.objects) {
      const fragment = fragments?.get(id);
      const feature = copper.get(id);
      const drill = drills.get(id);
      const aperture = apertures.get(id);
      const print = prints.get(id);
      const placement = placements.get(id);
      if (fragment) addLand(fragment.feature, fragment.region);
      if (feature) addLand(feature);
      if (drill) {
        layers.add(drill.plated ? 'plated-drill' : 'non-plated-drill');
        const { start, end, widthNm } = drill;
        const half = widthNm / 2;
        addRegion({ outer: [
          { x: Math.floor(Math.min(start.x, end.x) - half), y: Math.floor(Math.min(start.y, end.y) - half) },
          { x: Math.ceil(Math.max(start.x, end.x) + half), y: Math.ceil(Math.max(start.y, end.y) + half) },
        ], holes: [] });
        addPins(padSources.get(id));
        if (!issue.layers)
          for (const land of pads.get(id) ?? []) layers.add('copper-' + land.layerId);
      }
      if (aperture) {
        layers.add(aperture.kind + '-' + aperture.side);
        addRegion({ outer: aperture.polygon, holes: [] });
        addPins(padSources.get(padKey(aperture.landId ?? '')));
      }
      if (print) {
        layers.add((issue.code.startsWith('courtyard-') ? 'courtyard-' : 'silk-') + print.side);
        for (const region of print.regions) addRegion(region);
      }
      if (placement) location ??= placement.positionNm;
      for (const land of terminals.get(id) ?? []) addLand(land);
      addPins(signalSources.get(id));
    }
    for (const id of issue.signalIds ?? [])
      addPins(signalSources.get(issue.objects[0] + ':' + id));
    location = issue.location ?? geometryLocation ?? location;
    const severity = severityFor(issue.code);
    const result = issue.advisory?.waiver ? 'waived'
      : issue.code === 'schematic-update-pending' ? 'stale'
      : severity === 'unknown' ? 'not-run' : 'failed';
    const measurement = issue.measurement ??
      (issue.measuredNm !== undefined || issue.requiredNm !== undefined
        ? { unit: 'nm' as const, measured: issue.measuredNm, required: issue.requiredNm }
        : undefined);
    return {
      ...issue,
      boardId: board.boardId,
      revision: board.revision,
      severity,
      result,
      layers: [...layers].sort(),
      location,
      ...(box ? { boundsNm: box } : {}),
      ...(measurement ? { measurement } : {}),
      ruleIds: [...new Set([
        issue.code,
        ...(issue.ruleIds ?? []),
        ...(issue.clearanceRules?.map(({ id }) => id) ?? []),
        ...issue.objects.filter((id) => ruleIds.has(id)),
      ])],
      sourcePins: [...pins.values()],
    };
  });
}

function addToIndex<T>(index: Map<string, T[]>, key: string, value: T) {
  const items = index.get(key);
  if (items) items.push(value);
  else index.set(key, [value]);
}

function padKey(landId: string) {
  return landId.slice(0, landId.lastIndexOf(':'));
}
