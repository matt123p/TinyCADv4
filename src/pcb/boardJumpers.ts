import { isEntityId } from '../model/schematicIdentity';
import type { BoardDocument } from './board';
import {
  capsulePolygon,
  polygonBoundariesMeet,
  profileRegion,
  validateCapsule,
} from './contours';
import type { AssemblyLink, BoardDrill, CopperFeature } from './copper';
import { pointInPolygon, samePoint } from './geometry';
import type { BoardPoint } from './geometry';

export interface BoardWireJumper {
  readonly id: string;
  readonly reference: string;
  readonly netId: string;
  readonly fitted: boolean;
  readonly start: BoardPoint;
  readonly end: BoardPoint;
  readonly landWidthNm: number;
  readonly drillNm: number;
}

export function validateBoardJumpers(board: BoardDocument) {
  const jumpers = board.jumpers;
  if (
    (jumpers !== undefined) !==
    board.requiredFeatures.includes('wire-jumpers')
  )
    throw new Error('PCB jumpers must declare the wire-jumpers feature.');
  if (jumpers === undefined) return;
  if (
    !Array.isArray(jumpers) ||
    jumpers.length > 128 ||
    board.copperLayers.length !== 1
  )
    throw new Error('Wire jumpers require a single copper layer.');
  const ids = new Set<string>();
  const references = new Set(
    (board.components ?? []).map(({ reference }) =>
      reference?.trim().toLowerCase(),
    ),
  );
  const profile = board.profile
    ? profileRegion(board.profile)
    : { outer: board.outline, holes: [] };
  for (const jumper of jumpers) {
    if (
      !isEntityId(jumper?.id) ||
      ids.has(jumper.id.toLowerCase()) ||
      !isEntityId(jumper.netId) ||
      typeof jumper.reference !== 'string' ||
      !jumper.reference.trim() ||
      jumper.reference.length > 64 ||
      references.has(jumper.reference.trim().toLowerCase()) ||
      typeof jumper.fitted !== 'boolean' ||
      jumper.landWidthNm <= jumper.drillNm
    )
      throw new Error(
        'Choose a unique jumper reference, a net and a positive annular ring.',
      );
    ids.add(jumper.id.toLowerCase());
    references.add(jumper.reference.trim().toLowerCase());
    validateCapsule(jumper.start, jumper.start, jumper.drillNm);
    validateCapsule(jumper.end, jumper.end, jumper.drillNm);
    if (
      samePoint(jumper.start, jumper.end) ||
      Math.hypot(
        jumper.start.x - jumper.end.x,
        jumper.start.y - jumper.end.y,
      ) <= jumper.landWidthNm
    )
      throw new Error('The two jumper lands must be separate.');
    for (const position of [jumper.start, jumper.end]) {
      const land = capsulePolygon(position, position, jumper.landWidthNm);
      if (
        pointInPolygon(land[0], profile.outer) !== 'inside' ||
        polygonBoundariesMeet(land, profile.outer) ||
        profile.holes.some(
          (hole) =>
            pointInPolygon(land[0], hole) !== 'outside' ||
            pointInPolygon(hole[0], land) !== 'outside' ||
            polygonBoundariesMeet(land, hole),
        )
      )
        throw new Error(
          'Both jumper lands must be inside the board and clear of cutouts.',
        );
    }
  }
}

export function wireJumperGeometry(
  board: BoardDocument,
  nets: ReadonlySet<string>,
) {
  const features: CopperFeature[] = [];
  const drills: BoardDrill[] = [];
  const links: AssemblyLink[] = [];
  for (const jumper of board.jumpers ?? []) {
    const netId = nets.has(jumper.netId) ? jumper.netId : undefined;
    const terminals = [jumper.id + ':A', jumper.id + ':B'] as const;
    for (const [index, point] of [jumper.start, jumper.end].entries()) {
      const id = terminals[index];
      features.push({
        id: id + ':top',
        kind: 'pad',
        layerId: 'top',
        region: {
          outer: capsulePolygon(point, point, jumper.landWidthNm),
          holes: [],
        },
        anchor: point,
        ...(netId ? { netId, terminalId: id } : {}),
      });
      drills.push({
        id,
        start: point,
        end: point,
        widthNm: jumper.drillNm,
        plated: false,
      });
    }
    if (netId)
      links.push({
        kind: 'jumper',
        source: jumper.id,
        terminals,
        fitted: jumper.fitted,
      });
  }
  return { features, drills, links };
}
