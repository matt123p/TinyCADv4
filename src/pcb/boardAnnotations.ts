import { isEntityId } from '../model/schematicIdentity';
import type { BoardDocument } from './board';
import { isBoardPoint, lengthInNanometres } from './geometry';
import type { BoardPoint } from './geometry';
import { validateFootprintDetails } from './footprintDetails';
import type { FootprintGraphic } from './footprintDetails';

export interface BoardDimension {
  readonly id: string;
  readonly start: BoardPoint;
  readonly end: BoardPoint;
  readonly kind: 'aligned' | 'horizontal' | 'vertical';
  readonly offsetNm: number;
  readonly unit: 'mm' | 'mil';
  readonly label?: string;
}

export interface BoardAnnotations {
  readonly datum?: BoardPoint;
  readonly dimensions?: readonly BoardDimension[];
  readonly graphics?: readonly FootprintGraphic[];
}

export function dimensionGeometry(dimension: BoardDimension) {
  const { start, end, kind, offsetNm } = dimension;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (kind === 'horizontal') {
    const y = start.y + offsetNm;
    return {
      start: { x: start.x, y },
      end: { x: end.x, y },
      lengthNm: Math.abs(dx),
    };
  }
  if (kind === 'vertical') {
    const x = start.x + offsetNm;
    return {
      start: { x, y: start.y },
      end: { x, y: end.y },
      lengthNm: Math.abs(dy),
    };
  }
  const length = Math.hypot(dx, dy);
  const x = Math.round((-dy / length) * offsetNm);
  const y = Math.round((dx / length) * offsetNm);
  return {
    start: { x: start.x + x, y: start.y + y },
    end: { x: end.x + x, y: end.y + y },
    lengthNm: Math.round(length),
  };
}

export function dimensionText(dimension: BoardDimension) {
  const { unit, label } = dimension;
  const { lengthNm } = dimensionGeometry(dimension);
  const value = lengthNm / lengthInNanometres('1', unit);
  return (label ? label + ' · ' : '') + Number(value.toFixed(6)) + ' ' + unit;
}

export function annotationLengthNm(text: string) {
  const parts = /^([+-]?\d+(?:\.\d+)?)\s*(mm|mil|nm)?$/i.exec(text.trim());
  if (!parts) throw new Error('Enter a decimal length in mm, mil or nm.');
  const [, value, unit = 'mm'] = parts;
  return lengthInNanometres(value, unit.toLowerCase() as 'mm' | 'mil' | 'nm');
}

export function snapMeasurementPoint(
  location: BoardPoint,
  candidates: readonly BoardPoint[],
  distanceNm: number,
): BoardPoint | undefined {
  let nearest: BoardPoint | undefined;
  let distance = distanceNm;
  for (const candidate of candidates) {
    const gap = Math.hypot(location.x - candidate.x, location.y - candidate.y);
    if (gap < distance) {
      distance = gap;
      nearest = candidate;
    }
  }
  return nearest;
}

export function validateBoardAnnotations(board: BoardDocument) {
  const { annotations } = board;
  if (
    (annotations !== undefined) !==
    board.requiredFeatures.includes('board-annotations')
  )
    throw new Error(
      'PCB annotations must declare the board-annotations feature.',
    );
  if (!!annotations?.graphics?.length !== board.requiredFeatures.includes('board-artwork'))
    throw new Error('PCB layer graphics must declare the board-artwork feature.');
  if (annotations === undefined) return;
  if (
    !annotations ||
    (annotations.datum !== undefined && !isBoardPoint(annotations.datum)) ||
    (annotations.dimensions !== undefined &&
      !Array.isArray(annotations.dimensions)) ||
    (!annotations.datum && !annotations.dimensions?.length && !annotations.graphics?.length)
  )
    throw new Error('Invalid PCB measurement datum or dimension collection.');
  validateFootprintDetails(annotations.graphics);

  const ids = new Set<string>();
  for (const dimension of annotations.dimensions ?? []) {
    if (
      !isEntityId(dimension?.id) ||
      ids.has(dimension.id.toLowerCase()) ||
      !isBoardPoint(dimension.start) ||
      !isBoardPoint(dimension.end) ||
      !['aligned', 'horizontal', 'vertical'].includes(dimension.kind) ||
      !['mm', 'mil'].includes(dimension.unit) ||
      !Number.isSafeInteger(dimension.offsetNm) ||
      (dimension.label !== undefined &&
        (typeof dimension.label !== 'string' ||
          dimension.label.length > 120 ||
          /[\x00-\x1f\x7f]/.test(dimension.label)))
    )
      throw new Error('Invalid PCB dimension settings.');
    const line = dimensionGeometry(dimension);
    if (!line.lengthNm || !isBoardPoint(line.start) || !isBoardPoint(line.end))
      throw new Error(
        'A dimension needs distinct measured points and a line within the PCB coordinate range.',
      );
    ids.add(dimension.id.toLowerCase());
  }
}
