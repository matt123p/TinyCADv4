import {
  ClipType,
  EndType,
  FillRule,
  JoinType,
  booleanOp,
  inflatePaths,
} from 'clipper2-ts';
import type { CamSnapshot } from '../../src/pcb/camWriter';
import { writeCamFiles } from '../../src/pcb/camWriter';
import { verifyCamFiles } from '../../src/pcb/camReadback';
import {
  circlePolygon,
  profileRegion,
  TESSELLATION_TOLERANCE_NM,
} from '../../src/pcb/contours';
import type {
  BoardProfile,
  ContourEdge,
  PolygonRegion,
} from '../../src/pcb/contours';
import { analyseCopper } from '../../src/pcb/copper';
import type { CopperFeature } from '../../src/pcb/copper';
import { placeFootprintPoint } from '../../src/pcb/footprint';
import { importKicadFootprint } from '../../src/pcb/kicadFootprint';
import { placeDevice } from '../../src/pcb/padstack';
import {
  loadPolygonKernel,
  orientedPolygonRings,
  regionsFromOrientedRings,
} from '../../src/pcb/polygonKernel';
import type { PolygonKernel } from '../../src/pcb/polygonKernel';
import { routeBoard } from '../../src/pcb/routing';
import { fillZone } from '../../src/pcb/zoneFill';

const mm = (x: number, y: number) => ({
  x: Math.round(x * 1e6),
  y: Math.round(y * 1e6),
});
const rectangle = (
  x: number,
  y: number,
  right: number,
  top: number,
): PolygonRegion => ({
  outer: [mm(x, y), mm(right, y), mm(right, top), mm(x, top)],
  holes: [],
});
const footprint = `(footprint "G0 hybrid"
  (version 20241229) (generator tinycad_g0) (layer "F.Cu")
  (pad "01" thru_hole oval (at 0 0) (size 2.1 1.3) (drill oval 1.3 0.5) (layers "*.Cu" "*.Mask"))
  (pad "EP" smd custom (at 2.5 -0.8) (size 0.2 0.2) (layers "F.Cu" "F.Paste" "F.Mask")
    (options (clearance outline) (anchor rect))
    (primitives (gr_poly (pts (xy -0.45 -0.3) (xy 0.35 -0.3) (xy 0.45 0.2) (xy -0.1 0.45) (xy -0.45 0.3)) (width 0) (fill yes)))))`;

const paths = (regions: readonly PolygonRegion[]) =>
  orientedPolygonRings(regions).map((ring) => [...ring]);

function loadTypeScriptKernel(): PolygonKernel {
  return {
    boolean(operation, subjects, clips) {
      const operations = {
        intersection: ClipType.Intersection,
        union: ClipType.Union,
        difference: ClipType.Difference,
      };
      return regionsFromOrientedRings(
        booleanOp(
          operations[operation],
          paths(subjects),
          paths(clips),
          FillRule.NonZero,
        ),
      );
    },
    offset(regions, deltaNm) {
      return regionsFromOrientedRings(
        inflatePaths(
          paths(regions),
          deltaNm,
          JoinType.Round,
          EndType.Polygon,
          2,
          TESSELLATION_TOLERANCE_NM,
        ),
      );
    },
  };
}

export type GeometryCandidate = 'typescript' | 'wasm';

export async function runG0Fixture(
  candidate: GeometryCandidate,
  wasmBinary: ArrayBuffer,
  iterations = 7,
) {
  const t0 = performance.now();
  const wasm =
    candidate === 'wasm' ? await loadPolygonKernel(wasmBinary) : null;
  const kernel = wasm ?? loadTypeScriptKernel();
  const setupMs = performance.now() - t0;
  const times: number[] = [];
  const routeTimes: number[] = [];
  let coldMs: number;
  let evidence: ReturnType<typeof exercise>;
  for (let repeat = 0; repeat < iterations; repeat++) {
    const start = performance.now();
    evidence = exercise(kernel);
    if (repeat > 0) {
      times.push(performance.now() - start);
      routeTimes.push(evidence.routeMs);
    } else coldMs = performance.now() - start;
  }
  const hashInput = new TextEncoder().encode(JSON.stringify(evidence.files));
  const digest = await crypto.subtle.digest('SHA-256', hashInput);
  return {
    ...evidence,
    digest: [...new Uint8Array(digest)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join(''),
    setupMs,
    coldMs,
    times,
    routeTimes,
    wasmMemoryBytes: wasm?.memoryBytes() ?? 0,
  };
}

function exercise(kernel: PolygonKernel) {
  const rectangleEdges = (region: PolygonRegion): ContourEdge[] =>
    region.outer.map((start, index) => ({
      kind: 'line',
      start,
      end: region.outer[(index + 1) % region.outer.length],
    }));
  const profile: BoardProfile = {
    outline: rectangleEdges(rectangle(0, 0, 14, 10)),
    cutouts: [
      [
        {
          kind: 'arc',
          start: mm(12.5, 8),
          end: mm(11.5, 8),
          centre: mm(12, 8),
          clockwise: false,
        },
        {
          kind: 'arc',
          start: mm(11.5, 8),
          end: mm(12.5, 8),
          centre: mm(12, 8),
          clockwise: false,
        },
      ],
    ],
  };
  const region = profileRegion(profile);
  const imported = importKicadFootprint(footprint);
  if (imported.issues.length || imported.pads.length !== 2)
    throw new Error(
      `Fixture footprint import failed: ${JSON.stringify(imported.issues)}`,
    );
  const placement = {
    positionNm: mm(5, 4),
    side: 'bottom' as const,
    rotationMicrodegree: 30_000_000,
  };
  const layers = ['top', 'bottom'] as const;
  const placed = placeDevice(
    'J1',
    {
      id: 'hybrid',
      pads: imported.pads,
      assignments: [
        { padId: imported.pads[0].id, kind: 'signal', signalId: 'ground' },
        { padId: imported.pads[1].id, kind: 'signal', signalId: 'output' },
      ],
    },
    placement,
    layers,
    [
      { signalId: 'ground', terminalId: 'J1.01', netId: 'GND' },
      { signalId: 'output', terminalId: 'J1.EP', netId: 'OUT' },
    ],
  );
  const start = placeFootprintPoint(imported.pads[1].positionNm, placement);
  const goal = { x: start.x + 8_000_000, y: start.y };
  const testPad: CopperFeature = {
    id: 'test-output',
    kind: 'pad',
    netId: 'OUT',
    terminalId: 'TP.OUT',
    layerId: 'top',
    region: { outer: circlePolygon(goal, 350_000), holes: [] },
  };
  const groundPad: CopperFeature = {
    id: 'test-ground',
    kind: 'pad',
    netId: 'GND',
    terminalId: 'TP.GND',
    layerId: 'bottom',
    region: rectangle(9, 1, 9.5, 1.5),
  };
  const obstruction: CopperFeature = {
    id: 'obstacle',
    kind: 'pad',
    layerId: 'top',
    region: rectangle(6, 2, 7, 7),
  };
  const copper = [
    ...placed.copper,
    testPad,
    groundPad,
    obstruction,
    { ...obstruction, id: 'obstacle-bottom', layerId: 'bottom' as const },
  ];
  const drills = [
    ...placed.drills,
    {
      id: 'mount',
      start: mm(12, 2),
      end: mm(12, 2),
      widthNm: 1_000_000,
      plated: false,
    },
  ];
  const routeStarted = performance.now();
  const route = routeBoard(kernel, {
    id: 'output',
    netId: 'OUT',
    profile: region,
    layers,
    obstacles: copper,
    drills,
    start: { position: start, layer: 'bottom' },
    goal: { position: goal, layer: 'top' },
    widthNm: 220_000,
    gridNm: 500_000,
    viaDiameterNm: 600_000,
    viaDrillNm: 300_000,
    rules: {
      minWidthNm: 180_000,
      clearanceNm: 240_000,
      edgeClearanceNm: 150_000,
      minViaAnnulusNm: 130_000,
    },
  });
  const routeMs = performance.now() - routeStarted;
  if (route.status !== 'routed' || route.drills.length !== 1)
    throw new Error(`Fixture routing failed: ${route.status}`);
  const withRoute = [...copper, ...route.tracks, ...route.vias];
  const withDrills = [...drills, ...route.drills];
  const zone = fillZone(kernel, {
    id: 'ground',
    layerId: 'bottom',
    netId: 'GND',
    boundary: region,
    profile: region,
    copper: withRoute,
    drills: withDrills,
    clearanceNm: 240_000,
    edgeClearanceNm: 150_000,
    thermals: [
      {
        padId: 'J1:pad-1:bottom',
        anchor: placement.positionNm,
        gapNm: 250_000,
        spokeWidthNm: 250_000,
      },
    ],
  });
  const qualifiedCopper = [...withRoute, ...zone];
  const report = analyseCopper(kernel, qualifiedCopper, withDrills);
  const seededShort = analyseCopper(
    kernel,
    [
      ...qualifiedCopper,
      { ...testPad, id: 'short', terminalId: undefined, netId: 'UNINTENDED' },
    ],
    withDrills,
  );
  const seededOpen = analyseCopper(kernel, [...copper, ...zone], drills);
  const snapshot: CamSnapshot = {
    profile,
    drills: withDrills,
    layers: layers.map((id) => ({
      id,
      copper: report.copper
        .filter(({ feature }) => feature.layerId === id)
        .map(({ region: copperRegion }) => copperRegion),
    })),
  };
  const files = writeCamFiles(kernel, snapshot);
  const camIssues = verifyCamFiles(kernel, snapshot, files);
  const { 'copper-top.gbr': top, ...missingCopper } = files;
  const damaged = {
    ...files,
    'plated.xnc': files['plated.xnc'].replace('C0.300000', 'C0.301000'),
  };
  return {
    files,
    camIssues,
    routeMs,
    openNets: report.bareOpens.nets.map(({ netId }) => netId),
    missingTerminals: report.bareOpens.missingTerminals,
    shorts: report.shorts.length,
    seededShort: seededShort.shorts.some(({ netIds }) =>
      netIds.includes('UNINTENDED'),
    ),
    seededOpen: seededOpen.bareOpens.nets.some(({ netId }) => netId === 'OUT'),
    missingOutput: verifyCamFiles(kernel, snapshot, missingCopper).some(
      (issue) => issue.startsWith('copper-top.gbr:'),
    ),
    corruptOutput: verifyCamFiles(kernel, snapshot, damaged).some((issue) =>
      issue.startsWith('plated.xnc:'),
    ),
    observed: {
      vias: route.drills.length,
      routeVisits: route.visited,
      zoneIslands: zone.length,
      fragments: report.copper.length,
    },
  };
}
