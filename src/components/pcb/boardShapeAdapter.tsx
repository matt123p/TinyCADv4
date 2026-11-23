import React from 'react';
import { DocItemTypes } from '../../model/dsnItem';
import type { Coordinate, DocItem, dsnEllipse, dsnLine, dsnRectangle } from '../../model/dsnItem';
import type { ViewTracker } from '../../model/dsnView';
import { Snap } from '../../manipulators/snap';
import { updateEllipse } from '../../manipulators/updateEllipse';
import { updateLine } from '../../manipulators/updateLine';
import { updateRectangle } from '../../manipulators/updateRectangle';
import { boundedArea } from '../../pcb/boardAreaShape';
import type { BoardAreaGeometry, BoardBoundsShape, BoardPolygonPoint, BoardPolygonShape } from '../../pcb/boardAreaShape';
import { samePoint } from '../../pcb/geometry';
import type { BoardPoint } from '../../pcb/geometry';
import type { FootprintGraphic } from '../../pcb/footprintDetails';
import Ellipse from '../svg/Ellipse';
import Line from '../svg/Line';
import Rectangle from '../svg/Rectangle';
import { svgLength, svgLengthTransform } from '../svg/nanometreSvg';
import type { ShapeDrawingAttributes } from '../svg/ShapeDrawingAttributes';

// The board canvas snaps in nanometres before calling the schematic tools.
// The schematic items are temporary adapters. The board retains its native shape data.
const snap = new Snap(1, false);
const tracker = (): ViewTracker => ({ a: null, b: null, _dragArray: [], _drag: null, _primary_horz: false });
const attributes = {
  _id: 0, filled: false, fill_colour: '', hatch: 0,
  stroked: false, line_colour: '', line_width: 0, line_pattern: 0,
};
const coords = ({ x, y, control }: BoardPolygonPoint): Coordinate => control ? [x, y, 1] : [x, y];
const boardPoint = ([x, y]: Coordinate): BoardPoint => ({ x, y });
const polygonPoint = ([x, y, control]: Coordinate): BoardPolygonPoint => ({
  x: Math.round(x), y: Math.round(y), ...(control ? { control: true } : {}),
});
const view = { dx: 0, dy: 0, dr: 0, scale_x: 1, scale_y: -1 };

function rectangleItem(start: BoardPoint, end: BoardPoint): dsnRectangle {
  return { ...attributes, NodeName: DocItemTypes.Rectangle, rounded_rect: false, point: coords(start), point_b: coords(end) };
}

function ellipseItem(start: BoardPoint, end: BoardPoint): dsnEllipse {
  return { ...attributes, NodeName: DocItemTypes.Ellipse, point: coords(start), point_b: coords(end) };
}

function lineItem(points: readonly BoardPoint[], polygon: boolean): dsnLine {
  return { ...attributes, NodeName: DocItemTypes.Line, d_points: points.map(coords), polygon };
}

function boundsItem(kind: BoardBoundsShape['kind'], start: BoardPoint, end: BoardPoint) {
  return kind === 'rectangle' ? rectangleItem(start, end) : ellipseItem(start, end);
}

function boundsTool(item: DocItem, circular = false) {
  if (item.NodeName === DocItemTypes.Rectangle) return new updateRectangle(item);
  if (item.NodeName === DocItemTypes.Ellipse) return new updateEllipse(item, circular);
  throw new Error('Expected a rectangle or an ellipse.');
}

export function drawBoardBounds(kind: BoardBoundsShape['kind'], start: BoardPoint, end: BoardPoint, commit = false) {
  const state = tracker();
  const initial = boundsTool(boundsItem(kind, start, start)).begin_add(coords(start), state, snap, []).obj;
  const draft = boundsTool(initial).drag_add(coords(end), snap, state, []);
  const tool = boundsTool(draft);
  if (commit && !tool.end_add(state, []).end) return;
  const shape = tool.complete_add() as dsnRectangle | dsnEllipse;
  return boundedArea(kind, boardPoint(shape.point), boardPoint(shape.point_b));
}

function polygonDraft(points: readonly BoardPoint[], pointer: BoardPoint, closed: boolean) {
  if (!points.length) return lineItem([], closed);
  const tool = new updateLine(lineItem([...points, points.at(-1)], closed));
  return tool.move_add(coords(pointer), snap, tracker(), []);
}

export function addBoardPolygonPoint(points: readonly BoardPoint[], pointer: BoardPoint) {
  if (points.length && (samePoint(points.at(-1), pointer) || points.length < 3 && samePoint(points[0], pointer))) return { points, end: false };
  const tool = new updateLine(polygonDraft(points, pointer, true));
  const added = tool.begin_add(coords(pointer), tracker(), snap, []);
  const result = added.end ? new updateLine(added.obj).complete_add().d_points : added.obj.d_points.slice(0, -1);
  return { points: result.map(boardPoint), end: added.end };
}

export function previewBoardPolygon(points: readonly BoardPoint[], pointer: BoardPoint) {
  const item = polygonDraft(points, pointer, false);
  return { kind: 'polygon' as const, vertices: item.d_points.map(boardPoint) };
}

export function finishBoardPolygon(points: readonly BoardPoint[], pointer?: BoardPoint) {
  const pending = pointer && points.length && !samePoint(points[0], pointer) && !samePoint(points.at(-1), pointer);
  const item = pending ? polygonDraft(points, pointer, true) : lineItem(points, true);
  return new updateLine(item).complete_add().d_points.map(boardPoint);
}

export function boardPolygonMenu(shape: BoardPolygonShape, point: BoardPoint, handle: number) {
  const tool = new updateLine(lineItem(shape.vertices, true));
  return tool.getContextMenu([], coords(point), handle + 1)
    .filter(({ key }) => key !== 'make_polyline' && key !== 'divider_103');
}

export function applyBoardPolygonCommand(shape: BoardPolygonShape, command: string, point: BoardPoint, handle: number) {
  const item = lineItem(shape.vertices, true);
  const next = new updateLine(item).applyPolygonCommand('menu_' + command, coords(point), snap, handle + 1);
  return next === item ? shape : { ...shape, vertices: next.d_points.map(polygonPoint) };
}

export function polygonContextHit(shape: BoardPolygonShape, point: BoardPoint, tolerance: number) {
  const tool = new updateLine(lineItem(shape.vertices, true));
  const distance = ([x, y]: Coordinate) => Math.hypot(x - point.x, y - point.y);
  const handle = tool.handles().map(distance).reduce((nearest, value, index, distances) =>
    value <= tolerance && (nearest < 0 || value < distances[nearest]) ? index : nearest, -1);
  return { handle, near: handle >= 0 || distance(tool._nearestPoint(coords(point), tool.item.d_points, true).point) <= tolerance };
}

export function boardShapeHandles(shape: BoardAreaGeometry) {
  const tool = shape.kind === 'polygon' ? new updateLine(lineItem(shape.vertices, true)) : boundsTool(boundsItem(shape.kind, shape.start, shape.end));
  return tool.handles().map((position, index) => ({ position: boardPoint(position),
    cursor: tool.getCursor(index + 1).replace(/^[ns](?=[ew]?-resize)/, (direction) => direction === 'n' ? 's' : 'n'),
  }));
}

export function editBoardLine(points: readonly BoardPoint[], handle: number, delta: BoardPoint) {
  if (!delta.x && !delta.y) return points;
  const item = lineItem(points, false);
  const { obj } = new updateLine(item).mouse_move(tracker(), coords(delta), handle + 1, snap);
  return obj === item ? points : (obj as dsnLine).d_points.map(polygonPoint);
}

export function moveBoardArtwork(item: FootprintGraphic, offset: BoardPoint): FootprintGraphic {
  switch (item.kind) {
    case 'polygon': return { ...item, points: editBoardLine(item.points, -1, offset) };
    case 'text': return { ...item, at: editBoardLine([item.at], -1, offset)[0] };
    case 'circle': {
      const [center, end] = editBoardLine([item.center, item.end], -1, offset);
      return { ...item, center, end };
    }
    case 'arc': {
      const [start, mid, end] = editBoardLine([item.start, item.mid, item.end], -1, offset);
      return { ...item, start, mid, end };
    }
    default: {
      const [start, end] = editBoardLine([item.start, item.end], -1, offset);
      return { ...item, start, end };
    }
  }
}

export function editBoardShape(shape: BoardAreaGeometry, handle: number, pointer: BoardPoint, offset: BoardPoint, circular = false): BoardAreaGeometry {
  const handles = handle < 0 ? undefined : boardShapeHandles(shape);
  const original = handles?.[handle].position;
  const delta = original ? { x: pointer.x - original.x, y: pointer.y - original.y } : offset;
  if (!delta.x && !delta.y) return shape;
  if (shape.kind === 'polygon') {
    const vertices = editBoardLine(shape.vertices, handle, delta);
    return vertices === shape.vertices ? shape : { ...shape, vertices };
  }
  const tool = boundsTool(boundsItem(shape.kind, shape.start, shape.end), circular);
  const obj = tool.mouse_move(tracker(), coords(delta), handle + 1, snap).obj as dsnRectangle | dsnEllipse;
  if (obj === tool.item) return shape;
  const start = boardPoint(obj.point);
  const end = boardPoint(obj.point_b);
  const shortest = Math.min(end.x - start.x, end.y - start.y);
  if (shortest <= 0) return shape;
  const radius = shape.kind === 'rectangle' ? Math.min(shape.radiusNm, Math.floor((shortest - 1) / 2)) : 0;
  return boundedArea(shape.kind, start, end, radius);
}

export function BoardLineDrawing({ points, attributes, closed = false, selected, hover }: {
  points: readonly BoardPoint[]; attributes: ShapeDrawingAttributes; closed?: boolean; selected?: boolean; hover?: boolean;
}) {
  return <Line {...view} data={lineItem(points, closed)} drawingAttributes={attributes} selected={selected} hover={hover}
    selectionAttributes={{ strokeWidth: 4, vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} />;
}

export function BoardShapeDrawing({ shape, attributes, closed = true }: {
  shape: BoardAreaGeometry; attributes: ShapeDrawingAttributes; closed?: boolean;
}) {
  const selected = attributes['data-copper-highlight'] === 'selected';
  const hover = attributes['data-copper-hover'] === 'true';
  if (shape.kind === 'polygon') return <BoardLineDrawing points={shape.vertices} attributes={attributes} closed={closed} selected={selected} hover={hover} />;
  // SVG length attributes are scaled to micrometres. The line path accepts raw nanometres.
  const start = { x: shape.start.x, y: -shape.start.y };
  const end = { x: shape.end.x, y: -shape.end.y };
  const drawingAttributes = { ...attributes, transform: svgLengthTransform };
  const props = { ...view, scale_x: svgLength(1), scale_y: svgLength(1), drawingAttributes, selected, hover,
    selectionAttributes: { transform: svgLengthTransform, strokeWidth: 4, vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' },
  };
  return shape.kind === 'rectangle'
    ? <Rectangle {...props} data={rectangleItem(start, end)} cornerRadius={svgLength(shape.radiusNm)} />
    : <Ellipse {...props} data={ellipseItem(start, end)} />;
}
