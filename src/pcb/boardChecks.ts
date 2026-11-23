import { checkPlacementAreas } from './placementAreaChecks';
import { mountingKeepouts } from './boardMechanical';
import type { BoardDocument } from './board';
import type { BoardWaiver, WaivableCheck } from './boardWaivers';
import { boardArtwork } from './boardArtwork';
import { checkBoardArtwork } from './boardArtworkChecks';
import { boardCopperGeometry } from './boardCopperGeometry';
import { boardRuleResolver, validateBoardRules } from './boardRules';
import { trackWidthViolation } from './routing';
import { routingRegionApplies, routingRegionPolygon, routingRegionViolation } from './routingRegions';
import { regionalClearance } from './regionalClearance';
import { checkFabrication } from './boardFabricationChecks';
import { fabricationProfileFor } from './fabricationProfiles';
import type { BoardStackup } from './fabricationProfiles';
import { openingCopperClearance } from './fabricationOpenings';
import { inspectFabricationOutline } from './fabricationOutline';
import { boundaryDistance, bounds, indexBounds, near, someNearby } from './regionDistances';
import { checkAppliedCircuit, checkProjectCircuit } from './boardParity';
import type {
  ProjectCircuitInput,
  SchematicCheckEvidence,
} from './boardParity';
import { boardZoneGeometry } from './boardZoneGeometry';
import { profileRegion, TESSELLATION_TOLERANCE_NM } from './contours';
import type { PolygonRegion } from './contours';
import { analyseCopper, openingRegion, regionsTouch } from './copper';
import type { BoardPoint } from './geometry';
import type { PolygonKernel } from './polygonKernel';
import { digest } from '../util/sha256';
import { boardFindings } from './boardFindings';
import type { BoardFinding } from './boardFindings';
import { checkCoverageResults } from './boardCheckCoverage';
import type { CheckCoverage } from './boardCheckCoverage';

const checkEngine = 'tinycad-board-checks/18';
// Keep existing geometry waivers tied to the same unchanged evidence.
const waiverFingerprintVersion = 'tinycad-board-checks/2';
const encoder = new TextEncoder();
const uncertaintyNm = 2 * TESSELLATION_TOLERANCE_NM;

function rectangleBounds(regions: readonly PolygonRegion[]) {
  if (regions.length !== 1) return;
  const [region] = regions;
  if (region.holes.length || region.outer.length !== 4) return;
  const box = bounds(region);
  // Require axis-aligned sides as well as corners on the bounding rectangle.
  if (region.outer.every((point, index) => {
    const next = region.outer[(index + 1) % 4];
    return (point.x === box.minX || point.x === box.maxX) &&
      (point.y === box.minY || point.y === box.maxY) &&
      (point.x === next.x) !== (point.y === next.y);
  })) return box;
}

function outsideInterior(
  kernel: PolygonKernel, region: PolygonRegion, box: ReturnType<typeof bounds>,
  interior: { regions: readonly PolygonRegion[]; rectangle?: ReturnType<typeof bounds> },
) {
  const { rectangle, regions } = interior;
  if (rectangle && box.minX >= rectangle.minX && box.maxX <= rectangle.maxX &&
      box.minY >= rectangle.minY && box.maxY <= rectangle.maxY) return false;
  return kernel.boolean('difference', [region], regions).length !== 0;
}

export interface BoardIssue {
  readonly code: string;
  readonly objects: readonly string[];
  readonly message: string;
  readonly location?: BoardPoint;
  readonly layers?: readonly string[];
  readonly signalIds?: readonly string[];
  readonly ruleIds?: readonly string[];
  readonly measurement?: BoardFinding['measurement'];
  readonly requiredNm?: number;
  readonly measuredNm?: number;
  readonly clearanceRules?: readonly { id: string; name: string; clearanceNm: number }[];
  readonly advisory?: {
    code: WaivableCheck;
    fingerprint: string;
    waiver?: BoardWaiver;
  };
}

export interface BoardCheckReport {
  readonly boardId: string;
  readonly revision: number;
  readonly inputDigest: string;
  readonly engine: string;
  readonly generatedAt: string;
  readonly schematic?: SchematicCheckEvidence;
  readonly issues: readonly BoardFinding[];
  readonly jumperConnectivity?: {
    readonly bareOpenNets: readonly string[];
    readonly assembledOpenNets: readonly string[];
  };
  readonly coverage: Readonly<ReturnType<typeof checkCoverageResults>>;
  readonly fabrication: {
    profileId?: string;
    revision?: string;
    thicknessNm?: number;
    stackup?: BoardStackup;
  };
  readonly inactiveWaivers: readonly BoardWaiver[];
}

export async function checkBoard(
  board: BoardDocument,
  kernel: PolygonKernel,
  {
    geometry = boardCopperGeometry(board),
    zones: currentZones,
    artwork = boardArtwork(board, kernel),
    projectCircuit,
  }: {
    geometry?: ReturnType<typeof boardCopperGeometry>;
    zones?: ReturnType<typeof boardZoneGeometry>;
    artwork?: ReturnType<typeof boardArtwork>;
    projectCircuit?: ProjectCircuitInput;
  } = {},
): Promise<BoardCheckReport> {
  validateBoardRules(board);
  const resolver = boardRuleResolver(board);
  const rules = resolver.net();
  const profile = board.profile
    ? profileRegion(board.profile)
    : { outer: board.outline, holes: [] };
  const fabrication = fabricationProfileFor(board);
  const parity =
    projectCircuit && (await checkProjectCircuit(board, projectCircuit));
  const resolvedSource =
    parity?.evidence.state === 'current' ||
    parity?.evidence.state === 'pending';
  const placementChecks = checkPlacementAreas(
    board,
    artwork.courtyards,
    kernel,
  );
  const issues: BoardIssue[] = [
    ...placementChecks.issues,
    ...(resolvedSource
      ? parity.issues
      : [...checkAppliedCircuit(board), ...(parity?.issues ?? [])]),
    ...checkBoardArtwork(
      kernel,
      artwork,
      geometry,
      profile,
      fabrication?.limits,
    ),
    ...(fabrication
      ? checkFabrication(board, kernel, geometry, profile, fabrication)
      : []),
  ];
  const waivers = new Map(
    board.waivers?.map((waiver) => [waiver.fingerprint, waiver]),
  );
  const usedWaivers = new Set<string>();
  async function advisory(code: WaivableCheck, evidence: unknown) {
    const fingerprint = await digest(
      encoder.encode(
        JSON.stringify([
          waiverFingerprintVersion,
          board.boardId,
          code,
          rules,
          evidence,
        ]),
      ),
    );
    const waiver = waivers.get(fingerprint);
    if (waiver?.code === code) usedWaivers.add(waiver.id);
    return { code, fingerprint, ...(waiver?.code === code ? { waiver } : {}) };
  }
  const hasZones = !!board.zones?.length;
  const hasThermals = board.zones?.some(
    ({ padConnection, viaConnection }) =>
      padConnection === 'thermal' || viaConnection === 'thermal',
  );
  const courtyardComponents = new Set(artwork.courtyards.map(
    ({ componentId, side }) => componentId + ':' + side,
  ));
  const missingCourtyards = (board.footprints ?? []).filter(({ componentId, side }) =>
    !courtyardComponents.has(componentId + ':' + side),
  ).length;
  const outlineChecks = fabrication ? inspectFabricationOutline(kernel, profile, fabrication.limits) : [];
  for (const check of outlineChecks) {
    if (check.result === 'passed') continue;
    issues.push({
      code: check.result === 'failed' ? 'fabrication-outline-width' : 'fabrication-outline-unverified',
      objects: [board.boardId],
      location: check.location,
      measuredNm: check.measuredNm,
      requiredNm: check.requiredNm,
      layers: ['profile'],
      ruleIds: [check.rule],
      message: check.result === 'failed'
        ? check.name + ' has a feature narrower than the fabrication minimum.'
        : check.name + ' could not be verified. ' + check.detail,
    });
  }
  const outlineStatus = !fabrication ? 'unavailable'
    : outlineChecks.some(({ result }) => result === 'unverified') ? 'limited' : 'checked';
  const coverage: CheckCoverage[] = [
    {
      check: 'Routed outline and cutouts',
      status: outlineStatus,
      detail: fabrication
        ? 'Checks board material webs, open notches and cutouts against the profile width limits.'
        : 'Select a fabrication profile to check routed outline features.',
    },
    {
      check: 'Copper clearance, edges, track width and via ring',
      status: 'checked',
    },
    {
      check: 'Drills and slots',
      status: !geometry.drills.length ? 'not applicable' : fabrication ? 'checked' : 'limited',
      detail: !geometry.drills.length
        ? 'The board has no drilled or routed openings.'
        : fabrication
        ? 'Overlap, containment, configured opening widths, spacing and annular rings are checked.'
        : 'Overlap, containment and explicit mounting clearances are checked. Select a fabrication profile to check opening sizes and spacing.',
    },
    {
      check: 'Schematic parity',
      status: resolvedSource
        ? 'checked'
        : board.appliedCircuit
        ? 'limited'
        : 'unavailable',
      detail: resolvedSource
        ? 'Parts, references, purchasing details and signal membership are compared with the current project schematic.'
        : board.appliedCircuit
        ? 'Parts, references, purchasing details and signal membership are compared with the embedded circuit.'
        : 'No schematic snapshot is available for comparison.',
    },
    {
      check: 'Mask and paste',
      status: fabrication ? 'checked' : 'unavailable',
      detail: fabrication
        ? 'Checks explicit openings against the board profile, mask webs, mask expansion, minimum paste aperture and paste coverage of associated copper lands.'
        : 'Select a fabrication profile to check mask and paste.',
    },
    {
      check: 'Silkscreen and courtyard',
      status: !board.footprints?.length ? 'not applicable'
        : missingCourtyards || (!fabrication && artwork.silk.length) ? 'limited' : 'checked',
      detail: !board.footprints?.length
        ? 'The board has no placed footprints.'
        : [
            'Checks legend stroke and text height, clearance to mask and board edges, and closed courtyards for overlap and containment.',
            missingCourtyards ? `${missingCourtyards} placed footprints lack a closed courtyard on their mounted side.` : '',
            !fabrication && artwork.silk.length ? 'Select a fabrication profile to check minimum legend stroke, text height and clearances.' : '',
          ].filter(Boolean).join(' '),
    },
  ];
  if (board.placementAreas?.length || mountingKeepouts(board).length) {
    coverage.push({
      check: 'Placement keep-in and keep-out areas',
      status: placementChecks.originsChecked ? 'limited' : 'checked',
      detail: placementChecks.originsChecked
        ? 'Uses authored courtyards where present and checks footprint origins on sides with no closed courtyard.'
        : 'Checks authored courtyard shapes against the placement areas on each side.',
    });
  }
  const refs = new Map<string, string>();
  const placed = new Set(
    board.footprints?.map(({ componentId }) => componentId),
  );
  const devices = new Map(
    board.deviceDefinitions?.map((device) => [device.id, device]),
  );
  for (const component of board.components ?? []) {
    const { id, reference, deviceId, signals } = component;
    if (!placed.has(id)) {
      issues.push({
        code: 'unplaced',
        objects: [id],
        message: (reference ?? id) + ' is unplaced.',
      });
    }
    if (reference?.trim()) {
      const key = reference.trim().toLowerCase();
      const first = refs.get(key);
      if (first)
        issues.push({
          code: 'duplicate-reference',
          objects: [first, id],
          message: 'Duplicate reference ' + reference + '.',
        });
      else refs.set(key, id);
    }
    const device = devices.get(deviceId);
    const missing =
      signals?.filter(
        ({ signalId }) => !device?.signalIds.includes(signalId),
      ) ?? [];
    if (missing.length)
      issues.push({
        code: 'unmapped-signals',
        objects: [id, ...missing.map(({ signalId }) => signalId)],
        signalIds: missing.map(({ signalId }) => signalId),
        message: (reference ?? id) + ' has unmapped circuit signals.',
      });
  }

  for (const track of board.tracks ?? []) {
    const violation = trackWidthViolation(track.widthNm, resolver.net(track.netId));
    if (violation) {
      issues.push({
        ...violation,
        objects: [track.id],
        location: track.start,
        measuredNm: track.widthNm,
      });
    }
  }
  for (const via of board.vias ?? []) {
    const { minViaAnnulusNm } = resolver.net(via.netId);
    const ring = (via.diameterNm - via.drillNm) / 2;
    if (ring < minViaAnnulusNm)
      issues.push({
        code: 'via-ring',
        objects: [via.id],
        location: via.positionNm,
        requiredNm: minViaAnnulusNm,
        measuredNm: ring,
        message: 'Via annular ring is below the board minimum.',
      });
  }
  for (const route of [...(board.tracks ?? []), ...(board.vias ?? [])]) {
    if (!route.netId || route.reviewRequired)
      issues.push({
        code: 'route-review',
        objects: [route.id],
        message: 'Route assignment needs review.',
      });
  }

  const drillInterior = { regions: [profile], rectangle: rectangleBounds([profile]) };
  const holes = geometry.drills.map((drill) => {
    const region = openingRegion(drill);
    return { drill, region, box: bounds(region) };
  });
  let intersects = false;
  for (let i = 0; i < holes.length; i++) {
    const { drill, region, box } = holes[i];
    if (outsideInterior(kernel, region, box, drillInterior))
      issues.push({
        code: 'drill-outside',
        objects: [drill.id],
        location: drill.start,
        message: 'Drill or slot goes outside the board.',
      });
    for (let j = i + 1; j < holes.length; j++) {
      const other = holes[j];
      if (!near(box, other.box, 0) || !regionsTouch(region, other.region))
        continue;
      intersects = true;
      issues.push({
        code: 'drill-overlap',
        objects: [drill.id, other.drill.id],
        location: drill.start,
        message: 'Drill or slot overlaps another opening.',
      });
    }
  }

  let zones: ReturnType<typeof boardZoneGeometry> | undefined;
  try {
    zones =
      currentZones?.integrityChecked
        ? currentZones
        : boardZoneGeometry(board, kernel, geometry, true);
    const unverifiedWidth = zones.issues.find(({ code }) => code === 'zone-width-unverified');
    coverage.push({
      check: 'Thermal and zone integrity',
      status: !hasZones ? 'not applicable'
        : unverifiedWidth ? 'limited' : 'checked',
      detail: unverifiedWidth ? unverifiedWidth.detail : hasThermals
        ? 'Checks zone connectivity and width, and each filled thermal spoke for a connection and minimum bridge width.'
        : hasZones
        ? 'Checks zone connectivity, width, priority and the selected island policy.'
        : 'The board has no copper zones.',
    });
  } catch (error) {
    coverage.push({
      check: 'Thermal and zone integrity',
      status: 'unavailable',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  const features = [...geometry.features, ...(zones?.fills ?? [])];
  const copper = features.map((feature, index) => ({ feature, box: bounds(feature.region), index }));
  const mountingClearance = new Map(
    board.mechanicalHoles?.map(({ id, clearanceNm }) => [id, clearanceNm ?? 0]),
  );
  for (const { drill, region, box } of holes) {
    if (drill.plated && !mountingClearance.get(drill.id)) continue;
    const clearance = openingCopperClearance(
      board, drill, geometry.features, mountingClearance.get(drill.id) ?? 0, resolver.clearance,
    );
    for (const { feature, box: featureBox } of copper) {
      const required = clearance(feature);
      if (!required || !near(box, featureBox, required + uncertaintyNm)) continue;
      const measured = regionsTouch(feature.region, region)
        ? 0
        : boundaryDistance(feature.region, region);
      if (measured < required)
        issues.push({
          code: 'drill-clearance',
          objects: [drill.id, feature.id],
          location: drill.start,
          requiredNm: required,
          measuredNm: measured,
          message: 'Copper violates drill or slot clearance.',
        });
    }
  }

  const headKeepouts = mountingKeepouts(board);
  for (const { id, side, location, copper: keepout } of headKeepouts) {
    const headBounds = bounds(keepout);
    for (const { feature, box } of copper) {
      if (
        feature.layerId !== side ||
        feature.id.slice(0, feature.id.lastIndexOf(':')) === id ||
        !near(headBounds, box, 0) ||
        !regionsTouch(keepout, feature.region)
      ) continue;
      issues.push({
        code: 'mounting-screw-copper',
        objects: [id, feature.id],
        location,
        message: 'Copper enters a mounting screw-head keep-out on the ' + side + ' side.',
      });
    }
  }

  const edgeInteriors = new Map<number, { regions: PolygonRegion[]; rectangle?: ReturnType<typeof bounds> }>();
  const widestClearance = Math.max(
    copper.reduce((maximum, { feature }) => Math.max(maximum, resolver.net(feature.netId).clearanceNm), 0),
    (board.clearanceRules ?? []).reduce((maximum, rule) => Math.max(maximum, rule.clearanceNm), 0),
    (board.routingRegions ?? []).reduce((maximum, region) => Math.max(maximum, region.clearanceNm ?? 0), 0),
    [...(zones?.clearanceByFill?.values() ?? [])].reduce((maximum, value) => Math.max(maximum, value), 0),
  ) + uncertaintyNm;
  const regionGeometry = (board.routingRegions ?? []).map((region) => {
    const polygon = routingRegionPolygon(region);
    return { region, polygon, box: bounds(polygon) };
  });
  const classByNet = new Map(board.nets?.map(({ id, classId }) => [id, classId]));
  const tracksById = new Map(board.tracks?.map((track) => [track.id, track]));
  const regional = regionalClearance(board, kernel);
  const clearanceIndex = {
    top: indexBounds(copper.filter(({ feature }) => feature.layerId === 'top')),
    bottom: indexBounds(copper.filter(({ feature }) => feature.layerId === 'bottom')),
  };
  const candidates: typeof copper = [];
  for (let i = 0; i < copper.length; i++) {
    const { feature, box } = copper[i];
    if (feature.kind === 'track' || feature.kind === 'via' || feature.kind === 'zone') {
      const widthNm = tracksById.get(feature.id)?.widthNm;
      for (const item of regionGeometry) {
        if (!routingRegionApplies(item.region, feature.layerId, classByNet.get(feature.netId)) ||
          !near(box, item.box, 0)) continue;
        const violation = routingRegionViolation(item.region, feature.kind, widthNm);
        if (!violation || !regionsTouch(feature.region, item.polygon)) continue;
        const overlap = kernel.boolean('intersection', [feature.region], [item.polygon]);
        issues.push({
          ...violation,
          message: violation.message + ' Region: ' + item.region.name,
          objects: [item.region.id, feature.id],
          location: overlap[0]?.outer[0] ?? item.polygon.outer[0],
          ...(violation.requiredNm === undefined ? {} : { measuredNm: widthNm }),
        });
      }
    }
    const { edgeClearanceNm } = resolver.net(feature.netId);
    let edgeInterior = edgeInteriors.get(edgeClearanceNm);
    if (!edgeInterior) {
      const regions = kernel.offset([profile], -edgeClearanceNm);
      edgeInterior = { regions, rectangle: rectangleBounds(regions) };
      edgeInteriors.set(edgeClearanceNm, edgeInterior);
    }
    if (outsideInterior(kernel, feature.region, box, edgeInterior))
      issues.push({
        code: 'copper-edge',
        objects: [feature.id],
        location: feature.region.outer[0],
        requiredNm: edgeClearanceNm,
        message: 'Copper crosses the required board edge clearance.',
      });
    candidates.length = 0;
    someNearby(clearanceIndex[feature.layerId], box, widestClearance, (other) => {
      if (other.index > i && (!feature.netId || feature.netId !== other.feature.netId) &&
          (!feature.artworkId || feature.artworkId !== other.feature.artworkId))
        candidates.push(other);
      return false;
    });
    // Keep findings in board order, independent of the spatial index traversal.
    candidates.sort((a, b) => a.index - b.index);
    for (const other of candidates) {
      const required = Math.max(
        resolver.copperClearance(feature, other.feature),
        zones?.clearanceByFill?.get(feature.id) ?? 0,
        zones?.clearanceByFill?.get(other.feature.id) ?? 0,
      );
      if (regional.hasRules) {
        for (const { rule, measuredNm, requiredNm, location } of regional.violations(feature, box, other.feature, other.box, required))
          issues.push({
            code: 'region-copper-clearance',
            objects: [rule.id, ...[feature.id, other.feature.id].sort()],
            location, requiredNm, measuredNm,
            message: 'Copper clearance is below the minimum in ' + rule.name + '.',
          });
      }
      if (!near(box, other.box, required + uncertaintyNm)) continue;
      const touching = regionsTouch(feature.region, other.feature.region);
      const measured = touching
        ? 0
        : boundaryDistance(feature.region, other.feature.region);
      if (measured < required) {
        const matched = resolver.matchingClearanceRules(feature, other.feature);
        issues.push({
          code: 'copper-clearance',
          objects: [feature.id, other.feature.id].sort(),
          location: feature.region.outer[0],
          requiredNm: required,
          measuredNm: measured,
          message: matched.length
            ? 'Copper clearance is below the effective minimum for this pair.'
            : 'Copper clearance is below the board minimum.',
          ...(matched.length ? { clearanceRules: matched.map(({ id, name, clearanceNm }) =>
            ({ id, name, clearanceNm })) } : {}),
        });
      }
    }
  }

  for (const {
    zoneId,
    code,
    objectId,
    direction,
    location,
    measuredNm,
    requiredNm,
    detail,
  } of zones?.issues ?? []) {
    const messages = {
      'missing-net': 'Zone refers to a retired net.',
      island: 'Zone contains flagged disconnected copper.',
      'thermal-anchor': 'Thermal relief has no usable anchor.',
      'thermal-disconnected': 'Thermal relief does not connect.',
      'thermal-spoke-missing':
        'Thermal spoke does not bridge the land and pour.',
      'thermal-spoke-width':
        'Filled thermal spoke is below the required bridge width.',
      'zone-minimum-width': 'Filled zone copper is below the required minimum width.',
      'zone-width-unverified': 'Could not verify the width of filled zone copper.',
      'equal-priority': 'Different nets overlap at the same zone priority.',
    };
    issues.push({
      code,
      objects: objectId ? [zoneId, objectId] : [zoneId],
      message: detail ? messages[code] + ' ' + detail : direction
        ? direction[0].toUpperCase() +
          direction.slice(1) +
          ' · ' +
          messages[code]
        : messages[code],
      location,
      measuredNm,
      requiredNm,
      ...(code === 'island'
        ? {
            advisory: await advisory(code, [
              board.zones.find(({ id }) => id === zoneId),
              zones.fills.find(({ id }) => id === objectId),
            ]),
          }
        : {}),
    });
  }

  let jumperConnectivity: BoardCheckReport['jumperConnectivity'];
  let fragments: Map<string, ReturnType<typeof analyseCopper>['copper'][number]> | undefined;
  const activeNets = new Set(board.nets?.map(({ id }) => id));
  for (const jumper of board.jumpers ?? []) {
    const annulus = (jumper.landWidthNm - jumper.drillNm) / 2;
    const minimum =
      fabrication?.limits.minPadAnnulusNm ?? rules.minViaAnnulusNm;
    if (annulus < minimum)
      issues.push({
        code: 'jumper-ring',
        objects: [jumper.id],
        message:
          jumper.reference + ' jumper annular ring is below the board minimum.',
        location: jumper.start,
        measuredNm: annulus,
        requiredNm: minimum,
      });
    if (!activeNets.has(jumper.netId))
      issues.push({
        code: 'jumper-net',
        objects: [jumper.id],
        message:
          jumper.reference + ' needs reassignment to a current board net.',
        location: jumper.start,
      });
  }
  try {
    if (!zones) throw new Error('Current zone copper is unavailable.');
    if (intersects)
      throw new Error(
        'Intersecting drill openings prevent connectivity extraction.',
      );
    const topology = analyseCopper(
      kernel,
      features,
      geometry.drills,
      geometry.assemblyLinks,
    );
    coverage.push({ check: 'Physical connectivity', status: 'checked' });
    for (const short of topology.shorts)
      issues.push({
        code: 'short',
        objects: short.fragments,
        message: 'A physical copper island joins distinct nets.',
      });
    for (const contact of topology.fragileContacts) {
      issues.push({
        code: 'copper-point-contact',
        objects: contact.fragments,
        location: contact.location,
        measuredNm: 0,
        requiredNm: resolver.net(contact.netId).minWidthNm,
        message: 'Copper on the same net meets only at isolated points.',
      });
    }
    const assembledOpenNets = new Set(
      topology.assembledOpens.nets.map(({ netId }) => netId),
    );
    if (board.jumpers?.length)
      jumperConnectivity = {
        bareOpenNets: topology.bareOpens.nets.map(({ netId }) => netId),
        assembledOpenNets: [...assembledOpenNets],
      };
    for (const { netId, terminalGroups } of topology.bareOpens.nets) {
      const assembledOpen = assembledOpenNets.has(netId);
      const jumper = board.jumpers?.find(
        (part) => part.netId === netId && part.fitted,
      );
      const label = board.nets?.find(({ id }) => id === netId)?.name ?? netId;
      issues.push({
        code: assembledOpen ? 'open' : 'bare-open-bridged',
        objects: [netId, ...terminalGroups.flat()],
        ...(!assembledOpen && jumper ? { location: jumper.start } : {}),
        message: assembledOpen
          ? 'Required terminals remain in separate copper islands.'
          : 'Separate bare copper islands require fitted wire jumpers to complete ' +
            label +
            '.',
      });
    }
    for (const terminal of topology.bareOpens.missingTerminals)
      issues.push({
        code: 'missing-terminal',
        objects: [terminal],
        message: 'A required terminal has no remaining copper.',
      });
    if (issues.length || topology.floatingFragments.length) {
      fragments = new Map(topology.copper.map((fragment) => [fragment.id, fragment]));
    }
    const floating = new Set(topology.floatingFragments);
    for (const island of topology.connectedSets) {
      const objects = island.filter(
        (id) => floating.has(id) && ['track', 'via'].includes(fragments.get(id).feature.kind),
      );
      if (!objects.length) continue;
      const evidence = [...island].sort().map((id) => {
        const { feature, region } = fragments.get(id);
        return { id, layer: feature.layerId, net: feature.netId, region };
      });
      issues.push({
        code: 'floating-copper',
        objects,
        location: fragments.get(objects[0]).region.outer[0],
        message: 'Copper is disconnected from every required terminal.',
        advisory: await advisory('floating-copper', evidence),
      });
    }
  } catch (error) {
    coverage.push({
      check: 'Physical connectivity',
      status: 'unavailable',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const source = projectCircuit?.state === 'resolved'
    ? projectCircuit.snapshot : board.appliedCircuit;
  const findings = boardFindings(board, issues, geometry, features, artwork, fragments, source);
  return {
    boardId: board.boardId,
    revision: board.revision,
    inputDigest: await digest(new TextEncoder().encode(JSON.stringify(board))),
    generatedAt: new Date().toISOString(),
    ...(parity ? { schematic: parity.evidence } : {}),
    engine: checkEngine,
    issues: findings,
    ...(jumperConnectivity ? { jumperConnectivity } : {}),
    coverage: checkCoverageResults(coverage, findings, !!fabrication),
    fabrication: {
      ...(board.fabrication?.profileId
        ? {
            profileId: board.fabrication.profileId,
            revision: fabrication?.revision,
          }
        : {}),
      ...(board.fabrication
        ? { thicknessNm: board.fabrication.thicknessNm }
        : {}),
      ...(board.fabrication?.stackup ? { stackup: board.fabrication.stackup } : {}),
    },
    inactiveWaivers: (board.waivers ?? []).filter(
      ({ id }) => !usedWaivers.has(id),
    ),
  };
}
