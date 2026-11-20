import clipperFactory from 'clipper2-wasm';
import type { MainModule, Paths64 } from 'clipper2-wasm/dist/clipper2z';
import type { Polygon, PolygonRegion } from './contours';
import { TESSELLATION_TOLERANCE_NM } from './contours';
import {
  BOARD_COORDINATE_LIMIT_NM,
  isBoardPoint,
  pointInPolygon,
  signedDoubleArea,
} from './geometry';

export interface PolygonKernel {
  boolean(
    operation: 'union' | 'difference' | 'intersection',
    subjects: readonly PolygonRegion[],
    clips: readonly PolygonRegion[],
  ): PolygonRegion[];
  offset(regions: readonly PolygonRegion[], deltaNm: number): PolygonRegion[];
}

const MAX_VERTICES = 100_000;
const ZERO = BigInt(0);

export function orientedPolygonRings(
  regions: readonly PolygonRegion[],
): Polygon[] {
  let vertices = 0;
  const orient = (polygon: Polygon, positive: boolean): Polygon => {
    vertices += polygon.length;
    if (
      vertices > MAX_VERTICES ||
      polygon.length < 3 ||
      !polygon.every(isBoardPoint)
    ) {
      throw new Error(
        'Polygon geometry exceeds supported coordinate or vertex limits.',
      );
    }
    const area = signedDoubleArea(polygon);
    if (area === ZERO) throw new Error('A polygon ring cannot have zero area.');
    return area > ZERO === positive ? polygon : [...polygon].reverse();
  };
  return regions.flatMap(({ outer, holes }) => [
    orient(outer, true),
    ...holes.map((hole) => orient(hole, false)),
  ]);
}

export async function loadPolygonKernel(
  wasmBinary: ArrayBuffer,
): Promise<PolygonKernel & { memoryBytes(): number }> {
  const clipper = await clipperFactory({ wasmBinary });
  return {
    boolean(operation, subjects, clips) {
      const a = toPaths(clipper, subjects);
      try {
        const b = toPaths(clipper, clips);
        try {
          const clipType = {
            union: clipper.ClipType.Union,
            difference: clipper.ClipType.Difference,
            intersection: clipper.ClipType.Intersection,
          }[operation];
          return takeRegions(
            clipper.BooleanOp64(clipType, clipper.FillRule.NonZero, a, b),
          );
        } finally {
          b.delete();
        }
      } finally {
        a.delete();
      }
    },
    offset(regions, deltaNm) {
      if (
        !Number.isSafeInteger(deltaNm) ||
        Math.abs(deltaNm) > BOARD_COORDINATE_LIMIT_NM
      ) {
        throw new Error('Polygon offset is outside the supported range.');
      }
      const paths = toPaths(clipper, regions);
      try {
        return takeRegions(
          clipper.InflatePaths64(
            paths,
            deltaNm,
            clipper.JoinType.Round,
            clipper.EndType.Polygon,
            2,
            TESSELLATION_TOLERANCE_NM,
          ),
        );
      } finally {
        paths.delete();
      }
    },
    memoryBytes: () => clipper.HEAPU8.byteLength,
  };
}

function toPaths(
  clipper: MainModule,
  regions: readonly PolygonRegion[],
): Paths64 {
  const paths = new clipper.Paths64();
  try {
    for (const ring of orientedPolygonRings(regions)) {
      const path = clipper.MakePath64(ring.flatMap(({ x, y }) => [x, y]));
      try {
        paths.push_back(path);
      } finally {
        path.delete();
      }
    }
    return paths;
  } catch (error) {
    paths.delete();
    throw error;
  }
}

function takeRegions(paths: Paths64): PolygonRegion[] {
  const rings: Polygon[] = [];
  let vertices = 0;
  try {
    for (let i = 0; i < paths.size(); i++) {
      const path = paths.get(i);
      try {
        vertices += path.size();
        if (vertices > MAX_VERTICES)
          throw new Error('Polygon result exceeds the vertex budget.');
        const coordinates = path.view();
        const polygon = Array.from({ length: path.size() }, (_, j) => {
          const point = {
            x: Number(coordinates[j * 3]),
            y: Number(coordinates[j * 3 + 1]),
          };
          if (!isBoardPoint(point))
            throw new Error(
              'Polygon result is outside the board coordinate range.',
            );
          return point;
        });
        rings.push(polygon);
      } finally {
        path.delete();
      }
    }
  } finally {
    paths.delete();
  }
  return regionsFromOrientedRings(rings);
}

export function regionsFromOrientedRings(
  rings: readonly Polygon[],
): PolygonRegion[] {
  const polygons: { outer: Polygon; holes: Polygon[]; area: bigint }[] = [];
  const holes: Polygon[] = [];
  for (const polygon of rings) {
    const area = signedDoubleArea(polygon);
    if (area > ZERO) polygons.push({ outer: polygon, holes: [], area });
    else if (area < ZERO) holes.push(polygon);
  }
  for (const hole of holes) {
    const holeArea = -signedDoubleArea(hole);
    let owner: (typeof polygons)[number] | undefined;
    for (const polygon of polygons) {
      if (polygon.area <= holeArea || (owner && polygon.area >= owner.area))
        continue;
      if (pointInPolygon(hole[0], polygon.outer) !== 'outside') owner = polygon;
    }
    if (!owner) throw new Error('Polygon result has an unowned hole.');
    owner.holes.push(hole);
  }
  return polygons.map(({ outer, holes: cutouts }) => ({
    outer,
    holes: cutouts,
  }));
}
