import { isBoardPoint } from './geometry';
import type { BoardPoint } from './geometry';

export interface FootprintPad {
  readonly id: string;
  readonly label: string;
  readonly positionNm: BoardPoint;
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
  if (
    !Number.isSafeInteger(rotationMicrodegree) ||
    rotationMicrodegree % quarterTurn !== 0
  ) {
    throw new Error(
      'Only multiples of 90 degrees are supported by this transform.',
    );
  }
  const turns = (((rotationMicrodegree / quarterTurn) % 4) + 4) % 4;
  const x = side === 'bottom' ? -point.x : point.x;
  const { y } = point;
  const [dx, dy] = [
    [x, y],
    [-y, x],
    [-x, -y],
    [y, -x],
  ][turns];
  const result = { x: positionNm.x + dx, y: positionNm.y + dy };
  if (!isBoardPoint(result))
    throw new Error(
      'Transformed footprint point is outside the board coordinate range.',
    );
  return result;
}
