export interface BoardPoint {
  readonly x: number;
  readonly y: number;
}

export const BOARD_COORDINATE_LIMIT_NM = 500_000_000;

export type LengthUnit = 'nm' | 'mm' | 'mil';

const nanometresPerUnit: Record<LengthUnit, number> = {
  nm: 1,
  mm: 1_000_000,
  mil: 25_400,
};

/** Parse decimal input exactly and reject values below the stored resolution. */
export function lengthInNanometres(value: string, unit: LengthUnit): number {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (
    !match ||
    match[0].length > 64 ||
    !Object.prototype.hasOwnProperty.call(nanometresPerUnit, unit)
  ) {
    throw new Error('Expected a decimal length with a supported unit.');
  }
  const [, sign, whole, fraction = ''] = match;
  const divisor = BigInt(`1${'0'.repeat(fraction.length)}`);
  const numerator = BigInt(whole + fraction) * BigInt(nanometresPerUnit[unit]);
  if (numerator % divisor !== BigInt(0)) {
    throw new Error('Length must resolve to a whole nanometre.');
  }
  const magnitude = Number(numerator / divisor);
  if (!Number.isSafeInteger(magnitude))
    throw new Error('Length is out of range.');
  return sign === '-' && magnitude !== 0 ? -magnitude : magnitude;
}

export function isBoardPoint(value: unknown): value is BoardPoint {
  if (typeof value !== 'object' || value === null) return false;
  const { x, y } = value as BoardPoint;
  return [x, y].every(
    (coordinate) =>
      Number.isInteger(coordinate) &&
      Math.abs(coordinate) <= BOARD_COORDINATE_LIMIT_NM,
  );
}

function samePoint(a: BoardPoint, b: BoardPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

function orientation(a: BoardPoint, b: BoardPoint, c: BoardPoint): number {
  const cross =
    BigInt(b.x - a.x) * BigInt(c.y - a.y) -
    BigInt(b.y - a.y) * BigInt(c.x - a.x);
  const zero = BigInt(0);
  if (cross === zero) return 0;
  return cross < zero ? -1 : 1;
}

function withinSegment(a: BoardPoint, b: BoardPoint, p: BoardPoint): boolean {
  return (
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y)
  );
}

function segmentsMeet(
  a: BoardPoint,
  b: BoardPoint,
  c: BoardPoint,
  d: BoardPoint,
): boolean {
  if (
    Math.max(a.x, b.x) < Math.min(c.x, d.x) ||
    Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
    Math.max(a.y, b.y) < Math.min(c.y, d.y) ||
    Math.max(c.y, d.y) < Math.min(a.y, b.y)
  )
    return false;
  const abc = orientation(a, b, c);
  const abd = orientation(a, b, d);
  const cda = orientation(c, d, a);
  const cdb = orientation(c, d, b);
  return (
    (abc * abd < 0 && cda * cdb < 0) ||
    (abc === 0 && withinSegment(a, b, c)) ||
    (abd === 0 && withinSegment(a, b, d)) ||
    (cda === 0 && withinSegment(c, d, a)) ||
    (cdb === 0 && withinSegment(c, d, b))
  );
}

/** One straight-edge contour, with an implicit closing segment. */
export function validateOutline(
  value: unknown,
): asserts value is readonly BoardPoint[] {
  if (
    !Array.isArray(value) ||
    value.length < 3 ||
    value.length > 1_024 ||
    !Array.from(value).every(isBoardPoint)
  ) {
    throw new Error(
      'An outline needs 3 to 1,024 vertices within the board coordinate range.',
    );
  }
  const vertices = value as readonly BoardPoint[];
  const count = vertices.length;
  if (
    vertices.some((point, i) => samePoint(point, vertices[(i + 1) % count]))
  ) {
    throw new Error('The outline has a zero-length edge.');
  }
  for (let i = 0; i < count; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % count];
    const next = vertices[(i + 2) % count];
    if (
      orientation(a, b, next) === 0 &&
      (withinSegment(a, b, next) || withinSegment(b, next, a))
    ) {
      throw new Error('Adjacent outline edges overlap.');
    }
    for (let j = i + 2; j < count; j++) {
      if (i === 0 && j === count - 1) continue;
      if (segmentsMeet(a, b, vertices[j], vertices[(j + 1) % count])) {
        throw new Error('The outline intersects itself.');
      }
    }
  }
}
