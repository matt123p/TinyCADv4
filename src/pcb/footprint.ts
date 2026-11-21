import { isBoardPoint } from './geometry';
import type { BoardPoint } from './geometry';

export interface FootprintPad {
  readonly id: string;
  readonly label: string;
  readonly positionNm: BoardPoint;
}

/** Pair physical pad designators for review without transferring pad or signal identities. */
export function pairFootprintPads<T extends FootprintPad>(before: readonly T[], after: readonly T[]) {
  const uniqueLabels = (pads: readonly T[]) => {
    const labels = new Map<string, T | null>();
    for (const pad of pads) {
      if (pad.label.trim()) labels.set(pad.label, labels.has(pad.label) ? null : pad);
    }
    return labels;
  };
  const oldLabels = uniqueLabels(before);
  const newLabels = uniqueLabels(after);
  const oldIds = new Set(before.map(({ id }) => id));
  const newIds = new Map(after.map((pad) => [pad.id, pad]));
  const paired = new Set<string>();
  const rows: [T | undefined, T | undefined][] = before.map((old) => {
    const candidate = oldLabels.get(old.label) && newLabels.get(old.label);
    const next = newIds.get(old.id) ?? (candidate && !oldIds.has(candidate.id) ? candidate : undefined);
    if (next) paired.add(next.id);
    return [old, next];
  });
  for (const pad of after) {
    if (!paired.has(pad.id)) rows.push([undefined, pad]);
  }
  return rows;
}

export type PadAssignment =
  | {
      readonly padId: string;
      readonly kind: 'signal';
      readonly signalId: string;
    }
  | { readonly padId: string; readonly kind: 'nc' | 'reserved' | 'mechanical' };

/** Validate the explicit assignments without comparing pin numbers or pad labels. */
export function validatePadMap(
  requiredSignalIds: readonly string[],
  pads: readonly FootprintPad[],
  assignments: readonly PadAssignment[],
): string[] {
  const issues: string[] = [];
  const signalIds = new Set(requiredSignalIds);
  const padIds = new Set(pads.map((pad) => pad.id));
  if (signalIds.size !== requiredSignalIds.length || signalIds.has(''))
    issues.push('Signal IDs must be nonempty and unique.');
  if (padIds.size !== pads.length || padIds.has(''))
    issues.push('Pad IDs must be nonempty and unique.');

  const assignedPads = new Set<string>();
  const mappedSignals = new Set<string>();
  for (const assignment of assignments) {
    const { padId } = assignment;
    if (!padIds.has(padId))
      issues.push(`Assignment refers to unknown pad ${padId}.`);
    if (assignedPads.has(padId))
      issues.push(`Pad ${padId} has multiple assignments.`);
    switch (assignment.kind) {
      case 'signal':
        if (!signalIds.has(assignment.signalId))
          issues.push(
            `Pad ${padId} refers to unknown signal ${assignment.signalId}.`,
          );
        if (padIds.has(padId)) mappedSignals.add(assignment.signalId);
        break;
      case 'nc':
      case 'reserved':
      case 'mechanical':
        break;
      default:
        issues.push(`Pad ${padId} has an unsupported assignment.`);
        continue;
    }
    assignedPads.add(padId);
  }

  for (const id of padIds) {
    if (!assignedPads.has(id)) issues.push(`Pad ${id} has no assignment.`);
  }
  for (const id of signalIds) {
    if (!mappedSignals.has(id))
      issues.push(`Required signal ${id} has no pad.`);
  }
  return issues;
}

export interface FootprintPlacement {
  readonly positionNm: BoardPoint;
  readonly rotationMicrodegree: number;
  readonly side: 'top' | 'bottom';
}

/** From footprint-local top view to board top view. Bottom mirrors local X before board CCW rotation. */
export function placeFootprintPoint(
  point: BoardPoint,
  placement: FootprintPlacement,
): BoardPoint {
  const { positionNm, rotationMicrodegree, side } = placement;
  if (
    !isBoardPoint(point) ||
    !isBoardPoint(positionNm) ||
    (side !== 'top' && side !== 'bottom')
  ) {
    throw new Error('Invalid footprint point, position, or side.');
  }
  const quarterTurn = 90_000_000;
  if (!Number.isSafeInteger(rotationMicrodegree))
    throw new Error('Rotation must be an integer number of microdegrees.');
  const fullTurn = 4 * quarterTurn;
  const rotation = ((rotationMicrodegree % fullTurn) + fullTurn) % fullTurn;
  const turns = rotation / quarterTurn;
  const x = side === 'bottom' ? -point.x : point.x;
  const { y } = point;
  const quarterTurns = [
    [x, y],
    [-y, x],
    [-x, -y],
    [y, -x],
  ];
  const radians = (rotation / fullTurn) * (2 * Math.PI);
  const [dx, dy] = Number.isInteger(turns)
    ? quarterTurns[turns]
    : [
        Math.round(x * Math.cos(radians) - y * Math.sin(radians)),
        Math.round(x * Math.sin(radians) + y * Math.cos(radians)),
      ];
  const result = { x: positionNm.x + dx, y: positionNm.y + dy };
  if (!isBoardPoint(result))
    throw new Error(
      'Transformed footprint point is outside the board coordinate range.',
    );
  return result;
}
