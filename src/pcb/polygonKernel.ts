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
  intersectionHasArea?(subjects: readonly PolygonRegion[], clips: readonly PolygonRegion[]): boolean;
  normaliseUncut?(region: PolygonRegion): PolygonRegion[];
  offset(regions: readonly PolygonRegion[], deltaNm: number): PolygonRegion[];
}

const MAX_VERTICES = 100_000;
const ZERO = BigInt(0);
const lowWord = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 0 : 1;
const highWord = 1 - lowWord;

function visitOrientedRings(
  regions: readonly PolygonRegion[],
  visit: (polygon: Polygon, forward: boolean) => void,
) {
  let vertices = 0;
  const orient = (polygon: Polygon, positive: boolean) => {
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
    visit(polygon, (area > ZERO) === positive);
  };
  for (const { outer, holes } of regions) {
    orient(outer, true);
    for (const hole of holes) orient(hole, false);
  }
}

export function orientedPolygonRings(regions: readonly PolygonRegion[]): Polygon[] {
  const rings: Polygon[] = [];
  visitOrientedRings(regions, (ring, forward) => rings.push(forward ? ring : [...ring].reverse()));
  return rings;
}

export async function loadPolygonKernel(
  wasmBinary: ArrayBuffer,
): Promise<PolygonKernel & { memoryBytes(): number }> {
  const clipper = await clipperFactory({ wasmBinary });
  const clipType = {
    union: clipper.ClipType.Union,
    difference: clipper.ClipType.Difference,
    intersection: clipper.ClipType.Intersection,
  };
  let coordinates = new BigInt64Array(0);
  let words = new Int32Array(coordinates.buffer);
  function toPaths(regions: readonly PolygonRegion[]): Paths64 {
    const paths = new clipper.Paths64();
    if (!regions.length) return paths;
    try {
      const path = new clipper.Path64();
      try {
        visitOrientedRings(regions, (ring, forward) => {
          const length = ring.length * 3;
          if (length > coordinates.length) {
            coordinates = new BigInt64Array(length);
            words = new Int32Array(coordinates.buffer);
          }
          const step = forward ? 1 : -1;
          let index = forward ? 0 : ring.length - 1;
          for (let i = 0; i < ring.length; i++, index += step) {
            const { x, y } = ring[index];
            // Validated board coordinates fit in signed 32 bits. Extend the
            // sign into the high word of each 64-bit Clipper coordinate.
            const offset = 6 * i;
            words[offset + lowWord] = x;
            words[offset + highWord] = x >> 31;
            words[offset + 2 + lowWord] = y;
            words[offset + 2 + highWord] = y >> 31;
          }
          // assign copies the x, y, z triplets. The zero Z coordinates stay zero.
          path.assign(length === coordinates.length ? coordinates : coordinates.subarray(0, length));
          paths.push_back(path);
        });
      } finally {
        path.delete();
      }
      return paths;
    } catch (error) {
      paths.delete();
      throw error;
    }
  }
  function booleanPaths(
    type: Parameters<MainModule['BooleanOp64']>[0],
    subjects: readonly PolygonRegion[],
    clips: readonly PolygonRegion[],
  ) {
    const a = toPaths(subjects);
    try {
      const b = toPaths(clips);
      try {
        return clipper.BooleanOp64(type, clipper.FillRule.NonZero, a, b);
      } finally {
        b.delete();
      }
    } finally {
      a.delete();
    }
  }
  return {
    boolean(operation, subjects, clips) {
      return takeRegions(booleanPaths(clipType[operation], subjects, clips));
    },
    intersectionHasArea(subjects, clips) {
      return takeIntersectionHasArea(booleanPaths(clipType.intersection, subjects, clips));
    },
    normaliseUncut(region) {
      return takeRegions(
        booleanPaths(clipType.difference, [region], []),
        region.holes.length === 0 ? region.outer : undefined,
      );
    },
    offset(regions, deltaNm) {
      if (
        !Number.isSafeInteger(deltaNm) ||
        Math.abs(deltaNm) > BOARD_COORDINATE_LIMIT_NM
      ) {
        throw new Error('Polygon offset is outside the supported range.');
      }
      const paths = toPaths(regions);
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

function resultWords(coordinates: BigInt64Array) {
  return new Int32Array(coordinates.buffer, coordinates.byteOffset, coordinates.length * 2);
}

function resultCoordinate(words: Int32Array, offset: number): number {
  const coordinate = words[offset + lowWord];
  if (words[offset + highWord] !== (coordinate >> 31) ||
      Math.abs(coordinate) > BOARD_COORDINATE_LIMIT_NM) {
    throw new Error('Polygon result is outside the board coordinate range.');
  }
  return coordinate;
}

// Translate to the first vertex so small rings near the board limits can
// use exact number arithmetic. Fall back when any term or sum may round.
function resultDoubleArea(coordinates: BigInt64Array, size: number): number | bigint {
  const words = resultWords(coordinates);
  const originX = resultCoordinate(words, 0);
  const originY = resultCoordinate(words, 2);
  let area = 0;
  let previousX = 0;
  let previousY = 0;
  let exact = true;
  for (let i = 6; i < size * 6; i += 6) {
    const x = resultCoordinate(words, i) - originX;
    const y = resultCoordinate(words, i + 2) - originY;
    const left = previousX * y;
    const right = previousY * x;
    const term = left - right;
    area += term;
    exact &&= Number.isSafeInteger(left) && Number.isSafeInteger(right) &&
      Number.isSafeInteger(term) && Number.isSafeInteger(area);
    previousX = x;
    previousY = y;
  }
  if (exact) return area;
  let exactArea = ZERO;
  let lastX = coordinates[(size - 1) * 3];
  let lastY = coordinates[(size - 1) * 3 + 1];
  for (let i = 0; i < size * 3; i += 3) {
    const x = coordinates[i];
    const y = coordinates[i + 1];
    exactArea += lastX * y - lastY * x;
    lastX = x;
    lastY = y;
  }
  return exactArea;
}

// Read a single result ring in place. Multiple rings use the full hole validation.
function takeIntersectionHasArea(paths: Paths64): boolean {
  const count = paths.size();
  if (count > 1) return takeRegions(paths).length > 0;
  try {
    if (!count) return false;
    const path = paths.get(0);
    try {
      const length = path.size();
      if (length > MAX_VERTICES)
        throw new Error('Polygon result exceeds the vertex budget.');
      if (!length) return false;
      const area = resultDoubleArea(path.view(), length);
      if (area < 0) throw new Error('Polygon result has an unowned hole.');
      return area > 0;
    } finally {
      path.delete();
    }
  } finally {
    paths.delete();
  }
}

function reuseRing(words: Int32Array, size: number, source?: Polygon): Polygon | undefined {
  if (!source || source.length !== size || !size) return;
  const x = resultCoordinate(words, 0);
  const y = resultCoordinate(words, 2);
  const start = source.findIndex((point) => Object.is(point.x, x) && Object.is(point.y, y));
  if (start === -1) return;
  for (let i = 1; i < size; i++) {
    const point = source[(start + i) % size];
    if (!Object.is(point.x, resultCoordinate(words, i * 6)) ||
        !Object.is(point.y, resultCoordinate(words, i * 6 + 2))) return;
  }
  // Keep the kernel's start vertex and winding, including in diagnostic reports.
  return Array.from({ length: size }, (_, i) => source[(start + i) % size]);
}

function takeRegions(paths: Paths64, source?: Polygon): PolygonRegion[] {
  const rings: Polygon[] = [];
  let vertices = 0;
  try {
    const count = paths.size();
    for (let i = 0; i < count; i++) {
      const path = paths.get(i);
      try {
        const size = path.size();
        vertices += size;
        if (vertices > MAX_VERTICES)
          throw new Error('Polygon result exceeds the vertex budget.');
        const words = resultWords(path.view());
        const reused = count === 1 ? reuseRing(words, size, source) : undefined;
        const polygon = reused ?? Array.from({ length: size }, (_, j) => ({
          x: resultCoordinate(words, j * 6),
          y: resultCoordinate(words, j * 6 + 2),
        }));
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
  if (rings.length === 1) {
    const [outer] = rings;
    const area = signedDoubleArea(outer);
    if (area < ZERO) throw new Error('Polygon result has an unowned hole.');
    return area > ZERO ? [{ outer, holes: [] }] : [];
  }
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
