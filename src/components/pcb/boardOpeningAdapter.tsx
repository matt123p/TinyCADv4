import React from 'react';
import { boundedArea } from '../../pcb/boardAreaShape';
import type { BoardBoundsShape } from '../../pcb/boardAreaShape';
import { samePoint } from '../../pcb/geometry';
import type { BoardPoint } from '../../pcb/geometry';
import type { BoardMechanicalHole } from '../../pcb/boardMechanical';
import { svgTranslation } from '../svg/nanometreSvg';
import type { ShapeDrawingAttributes } from '../svg/ShapeDrawingAttributes';
import { BoardShapeDrawing, boardShapeHandles, editBoardShape } from './boardShapeAdapter';

type Opening = Pick<BoardMechanicalHole, 'start' | 'end' | 'widthNm'>;

export function openingFromDrag(shape: 'round-hole' | 'slot', start: BoardPoint, end: BoardPoint): Opening {
  return shape === 'round-hole' ? { start, end: start, widthNm: Math.max(2, Math.round(2 * Math.hypot(end.x - start.x, end.y - start.y))) }
    : { start, end, widthNm: 1_000_000 };
}

function openingFrame({ start, end, widthNm }: Opening) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const cos = length ? dx / length : 1, sin = length ? dy / length : 0;
  const radius = widthNm / 2;
  const shape = boundedArea(length ? 'rectangle' : 'ellipse', { x: -radius, y: -radius }, { x: length + radius, y: radius });
  const toLocal = ({ x, y }: BoardPoint) => ({ x: cos * x + sin * y, y: cos * y - sin * x });
  const toBoard = ({ x, y }: BoardPoint) => ({ x: start.x + cos * x - sin * y, y: start.y + sin * x + cos * y });
  return { shape, toLocal, toBoard, transform: `${svgTranslation(start.x, -start.y)} rotate(${-Math.atan2(sin, cos) * 180 / Math.PI})` };
}

export function openingHandles(hole: Opening) {
  const { shape, toBoard } = openingFrame(hole);
  return boardShapeHandles(shape).map((handle) => ({ ...handle, position: toBoard(handle.position) }));
}

export function editOpening(hole: BoardMechanicalHole, handle: number, pointer: BoardPoint, offset: BoardPoint): BoardMechanicalHole {
  const { shape, toLocal, toBoard } = openingFrame(hole);
  const round = shape.kind === 'ellipse';
  const local = toLocal({ x: pointer.x - hole.start.x, y: pointer.y - hole.start.y });
  const edited = editBoardShape(shape, handle, local, toLocal(offset), round) as BoardBoundsShape;
  if (edited === shape) return hole;
  const width = edited.end.y - edited.start.y;
  const y = (edited.end.y + edited.start.y) / 2;
  if (!round && edited.end.x - edited.start.x <= width) return hole;
  const roundPoint = ({ x, y }: BoardPoint) => ({ x: Math.round(x), y: Math.round(y) });
  const start = roundPoint(toBoard({ x: edited.start.x + width / 2, y }));
  const end = round ? start : roundPoint(toBoard({ x: edited.end.x - width / 2, y }));
  if (!round && samePoint(start, end)) return hole;
  return { ...hole, start, end, widthNm: Math.max(2, Math.round(width)) };
}

export function BoardOpeningDrawing({ opening, attributes }: { opening: Opening; attributes: ShapeDrawingAttributes }) {
  const { shape, transform } = openingFrame(opening);
  const drawing = shape.kind === 'rectangle' ? { ...shape, radiusNm: opening.widthNm / 2 } : shape;
  return <g transform={transform}><BoardShapeDrawing shape={drawing} attributes={attributes} /></g>;
}
