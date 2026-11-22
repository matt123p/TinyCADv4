import type { CopperLayer } from './board';
import type { Polygon, PolygonRegion } from './contours';
import type { BoardPoint } from './geometry';
import type { prepareCentrelineClearance } from './routing';

type Clearance = ReturnType<typeof prepareCentrelineClearance>;
type Obstacle = Clearance['holes'][number];

interface PackedObstacles {
  coordinates: Int32Array;
  ringEnds: Uint32Array;
  obstacles: { box: Obstacle['box']; lastRing: number }[];
}

export interface RouteClearanceTransfer extends Omit<Clearance, 'holes' | 'byLayer'> {
  holes: PackedObstacles;
  byLayer: Map<CopperLayer['id'], PackedObstacles>;
}

function packObstacles(obstacles: readonly Obstacle[], transfer: ArrayBuffer[]): PackedObstacles {
  let pointCount = 0;
  let ringCount = 0;
  for (const { region } of obstacles) {
    pointCount += region.outer.length;
    ringCount += 1 + region.holes.length;
    for (const hole of region.holes) pointCount += hole.length;
  }
  // Clipper output is validated in integer nanometres within ±500 mm.
  const coordinates = new Int32Array(pointCount * 2);
  const ringEnds = new Uint32Array(ringCount);
  let coordinateIndex = 0;
  let ringIndex = 0;
  function writeRing(ring: Polygon) {
    for (const { x, y } of ring) {
      coordinates[coordinateIndex++] = x;
      coordinates[coordinateIndex++] = y;
    }
    ringEnds[ringIndex++] = coordinateIndex;
  }
  const items = obstacles.map(({ region, box }) => {
    writeRing(region.outer);
    for (const hole of region.holes) writeRing(hole);
    return { box, lastRing: ringIndex - 1 };
  });
  transfer.push(coordinates.buffer, ringEnds.buffer);
  return { coordinates, ringEnds, obstacles: items };
}

function unpackObstacles({ coordinates, ringEnds, obstacles }: PackedObstacles): Obstacle[] {
  function readRing(index: number): Polygon {
    const ring: BoardPoint[] = [];
    for (let i = ringEnds[index - 1] ?? 0; i < ringEnds[index]; i += 2)
      ring.push({ x: coordinates[i], y: coordinates[i + 1] });
    return ring;
  }
  return obstacles.map(({ box, lastRing }, index) => {
    const firstRing = (obstacles[index - 1]?.lastRing ?? -1) + 1;
    let region: PolygonRegion | undefined;
    return {
      box,
      // The bounds check runs before reading this property. Keep the decoded
      // rings for subsequent pointer moves near the same obstacle.
      get region() {
        if (region) return region;
        const holes: Polygon[] = [];
        for (let i = firstRing + 1; i <= lastRing; i++) holes.push(readRing(i));
        region = { outer: readRing(firstRing), holes };
        return region;
      },
    };
  });
}

export function packRouteClearance({ holes, byLayer, ...rest }: Clearance) {
  const transfer: ArrayBuffer[] = [];
  const geometry: RouteClearanceTransfer = {
    ...rest,
    holes: packObstacles(holes, transfer),
    byLayer: new Map([...byLayer].map(([layer, obstacles]) =>
      [layer, packObstacles(obstacles, transfer)])),
  };
  return { geometry, transfer };
}

export function unpackRouteClearance({ holes, byLayer, ...rest }: RouteClearanceTransfer): Clearance {
  return {
    ...rest,
    holes: unpackObstacles(holes),
    byLayer: new Map([...byLayer].map(([layer, obstacles]) => [layer, unpackObstacles(obstacles)])),
  };
}
