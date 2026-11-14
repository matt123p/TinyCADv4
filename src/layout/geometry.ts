import {
  Coordinate,
  DocItem,
  DocItemTypes as T,
  dsnSymbol,
  dsnWire,
} from '../model/dsnItem';
import { dsnSheet } from '../model/dsnDrawing';
import { TextAreaData } from '../model/textArea';
import { updateSymbol } from '../manipulators/updateSymbol';
import { updateFactory } from '../manipulators/updateFactory';
import { updateTextData } from '../manipulators/updateTextArea';
import { UtilityService } from '../util/utilityService';
import { plainLabelTextOffset } from '../util/labelGeometry';
import { LayoutOptions, LayoutSettings, Point, Rect } from './types';

export const same = (a: Coordinate, b: Coordinate) =>
  a[0] === b[0] && a[1] === b[1];
export const distance = (a: Coordinate, b: Coordinate) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
export const point = (p: Coordinate): Point => [p[0], p[1]];
export const snap = (n: number, grid: number) => Math.round(n / grid) * grid;
export const expand = (r: Rect, n: number): Rect => ({
  x1: r.x1 - n,
  y1: r.y1 - n,
  x2: r.x2 + n,
  y2: r.y2 + n,
});
export const intersects = (a: Rect, b: Rect) =>
  a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
export const rect = (a: Coordinate, b: Coordinate): Rect => ({
  x1: Math.min(a[0], b[0]),
  y1: Math.min(a[1], b[1]),
  x2: Math.max(a[0], b[0]),
  y2: Math.max(a[1], b[1]),
});
export const union = (rs: Rect[]): Rect =>
  rs.length
    ? {
        x1: Math.min(...rs.map((r) => r.x1)),
        y1: Math.min(...rs.map((r) => r.y1)),
        x2: Math.max(...rs.map((r) => r.x2)),
        y2: Math.max(...rs.map((r) => r.y2)),
      }
    : rect([0, 0], [0, 0]);
export function onSegment(p: Coordinate, a: Coordinate, b: Coordinate) {
  return (
    (a[0] === b[0] &&
      p[0] === a[0] &&
      p[1] >= Math.min(a[1], b[1]) &&
      p[1] <= Math.max(a[1], b[1])) ||
    (a[1] === b[1] &&
      p[1] === a[1] &&
      p[0] >= Math.min(a[0], b[0]) &&
      p[0] <= Math.max(a[0], b[0]))
  );
}
export function segments(w: dsnWire) {
  return w.d_points
    .slice(1)
    .map((b, i) => ({ a: w.d_points[i], b, id: w._id, index: i }));
}
export function wireContains(w: dsnWire, p: Coordinate) {
  return segments(w).some((s) => onSegment(p, s.a, s.b));
}
export function clean(points: Coordinate[]) {
  const result: Coordinate[] = [];
  for (const p of points) {
    if (result.length && same(result[result.length - 1], p)) continue;
    // Only remove monotone collinear vertices. A reversal may be a branch anchor.
    while (
      result.length > 1 &&
      onSegment(result[result.length - 1], result[result.length - 2], p)
    )
      result.pop();
    result.push(point(p));
  }
  return result;
}
export function textRect(data: TextAreaData): Rect {
  const t = data.textArea;
  return new updateTextData(
    t.drawX,
    t.drawY,
    t.drawPoint,
    t.drawItem,
    t.dragHandle,
    t.moveHandle,
    t.drawMultiline,
    t.drawRotation,
    t.drawWidth,
    t.drawHeight,
    t.drawCentre,
    t.allowMove,
  ).getBoundingRect(data);
}
export function refresh(item: DocItem): DocItem {
  if (item.NodeName === T.Symbol)
    return new updateSymbol({
      ...item,
      _active_points: null,
    }).post_construction();
  const updater = updateFactory(item);
  return 'post_construction' in updater ? updater.post_construction() : item;
}
export function cloneSheet(sheet: dsnSheet): dsnSheet {
  // Editors cache active points on symbols. Copy items before asking for geometry.
  return { ...sheet, items: sheet.items.map((item) => refresh({ ...item })) };
}
export function pins(symbol: dsnSymbol) {
  return new updateSymbol({ ...symbol }).active_points().map((p) => {
    const pin = p[2];
    const inward = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ][pin.rotation & 3];
    const v = UtilityService.rotateSymCordinate(symbol.rotation, [
      -inward[0] * Math.sign(symbol.scale_x),
      -inward[1] * Math.sign(symbol.scale_y),
    ]);
    const hasLead = pin.which !== 5 && pin.length > 0;
    if (!hasLead) {
      // Hidden pins are electrical anchors, not the stored (undrawn) stems.
      // Legacy discrete symbols can point that metadata into their own artwork.
      // Keep its axis when possible, but face away from the visible symbol.
      const bounds = bodyRect(symbol);
      const dx = p[0] - (bounds.x1 + bounds.x2) / 2;
      const dy = p[1] - (bounds.y1 + bounds.y2) / 2;
      const projection = dx * v[0] + dy * v[1];
      if (projection < 0) {
        v[0] = -v[0] || 0;
        v[1] = -v[1] || 0;
      } else if (projection === 0 && (dx || dy)) {
        v[0] = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0;
        v[1] = Math.abs(dx) >= Math.abs(dy) ? 0 : Math.sign(dy);
      }
    }
    return {
      p: point(p),
      direction: point(v),
      number: pin.number,
      id: symbol._id,
      length: hasLead ? pin.length : 0,
    };
  });
}
export function bodyRect(item: DocItem): Rect | null {
  if (item.NodeName === T.Symbol)
    return new updateSymbol(item).getBoundingRect();
  if ('point_b' in item) return rect(item.point, item.point_b);
  if (item.NodeName === T.Power) {
    if (item._no_show) return null;
    // Match Power.tsx: a 14-unit stem and a bar/circle/earth up to 28 units
    // beyond the electrical anchor. A point-sized keep-out misses the artwork.
    const height = item.which === 0 ? 14 : 28;
    return union(
      [
        [-7, 0],
        [8, 0],
        [-7, height],
        [8, height],
      ].map((p) => {
        const q = UtilityService.rotateSymCordinate(item.rotation, p);
        const absolute = [q[0] + item.point[0], q[1] + item.point[1]];
        return rect(absolute, absolute);
      }),
    );
  }
  if (item.NodeName === T.NoConnect)
    return expand(rect(item.point, item.point), 4);
  if (item.NodeName === T.Line || item.NodeName === T.BusWire)
    return union(item.d_points.map((p) => rect(p, p)));
  return null;
}

/** Visible artwork, in the same coordinate system as Symbol/ServerSymbol.
 * Keep the full pin envelope for routing, but do not mistake it for the body
 * when placing the symbol's own reference and value. */
export function symbolArtwork(symbol: dsnSymbol) {
  const updater = new updateSymbol(symbol),
    outline = updater.outline();
  const scope = {
    dx: symbol.point[0],
    dy: symbol.point[1],
    dr: symbol.rotation,
  };
  updater.calcRefDelta(scope);
  // Match Drawing/ServerDrawing's scale swap exactly, including their handling
  // of mirrored rotations. Artwork bounds must describe what is rendered.
  const swap = symbol.rotation === 1 || symbol.rotation === 3;
  const sx = swap ? symbol.scale_y : symbol.scale_x;
  const sy = swap ? symbol.scale_x : symbol.scale_y;
  const transform = (p: Coordinate) => {
    const q = UtilityService.rotateSymCordinate(symbol.rotation, p);
    return [q[0] * sx + scope.dx, q[1] * sy + scope.dy];
  };
  const shapes: Rect[] = [],
    annotations: Rect[] = [];
  for (const item of outline.items) {
    if (item.NodeName === T.Pin) continue;
    let bounds: Rect;
    if ('point_b' in item) {
      const r = rect(item.point, item.point_b);
      bounds = union(
        [
          [r.x1, r.y1],
          [r.x1, r.y2],
          [r.x2, r.y1],
          [r.x2, r.y2],
        ].map((p) => {
          const q = transform(p);
          return rect(q, q);
        }),
      );
    } else if (item.NodeName === T.Line) {
      bounds = union(
        item.d_points.map((p) => {
          const q = transform(p);
          return rect(q, q);
        }),
      );
    }
    if (bounds) {
      // SVG strokes straddle the path. Scale their visible half-width with the
      // symbol transform so labels and routing clear the painted edge.
      if ('stroked' in item && item.stroked && item.line_width > 0) {
        const half = item.line_width / 2;
        bounds = {
          x1: bounds.x1 - half * Math.abs(sx),
          y1: bounds.y1 - half * Math.abs(sy),
          x2: bounds.x2 + half * Math.abs(sx),
          y2: bounds.y2 + half * Math.abs(sy),
        };
      }
      (item.NodeName === T.Text ? annotations : shapes).push(bounds);
    }
  }
  const body = shapes.length ? union(shapes) : bodyRect(symbol);
  const pinBounds = pins(symbol)
    .filter((p) => p.length > 0)
    .map((p) => {
      // Direction is outward; artwork extends inwards from the electrical anchor.
      const local = outline.active_points.find(
        (a) =>
          a.pin.number === p.number &&
          (symbol._symbol.heterogeneous || a.part === symbol.part),
      )?.pin;
      const scale =
        p.direction[0] !== 0
          ? symbol.rotation & 1
            ? Math.abs(symbol.scale_y)
            : Math.abs(symbol.scale_x)
          : symbol.rotation & 1
          ? Math.abs(symbol.scale_x)
          : Math.abs(symbol.scale_y);
      const end = [
        p.p[0] - p.direction[0] * p.length * scale,
        p.p[1] - p.direction[1] * p.length * scale,
      ];
      const padding =
        (local?.show_name && local.name.trim()) ||
        (local?.show_number && local.number.trim())
          ? Math.max(3, local.font_size)
          : local?.which
          ? 3
          : 1;
      let bounds = rect(p.p, end);
      if (local) {
        const inward = [
          [1, 0],
          [0, 1],
          [-1, 0],
          [0, -1],
        ][local.rotation & 3];
        const drawnEnd = [
          local.point[0] + inward[0] * local.length,
          local.point[1] + inward[1] * local.length,
        ];
        // Protect both rendered pin artwork and the electrical lead if the
        // legacy mirrored/nonuniform transforms place them differently.
        bounds = union([
          bounds,
          rect(transform(local.point), transform(drawnEnd)),
        ]);
      }
      return expand(bounds, padding);
    });
  return { body, obstacles: [body, ...annotations, ...pinBounds] };
}
export function texts(item: DocItem): Rect[] {
  if (item.NodeName === T.Symbol)
    return (item.textData || []).filter(Boolean).map(textRect);
  if (item.NodeName === T.Label && item.which === 0 && item.textData) {
    const r = textRect(item.textData),
      [dx, dy] = plainLabelTextOffset(item.rotation);
    return [{ x1: r.x1 + dx, x2: r.x2 + dx, y1: r.y1 + dy, y2: r.y2 + dy }];
  }
  if ('textData' in item && item.NodeName !== T.Pin && item.textData)
    return [textRect(item.textData)];
  return [];
}
export function movable(item: DocItem, o: LayoutSettings) {
  return (
    (!o.selectedIds || o.selectedIds.includes(item._id)) &&
    !o.lockedIds?.includes(item._id) &&
    !(item.NodeName === T.Symbol && o.fixedSymbolIds?.includes(item._id)) &&
    [T.Symbol, T.Wire, T.Label, T.Power, T.NoConnect, T.Junction].includes(
      item.NodeName,
    )
  );
}
export function settings(
  sheet: dsnSheet,
  o: LayoutOptions = {},
): LayoutSettings {
  const grid = o.grid ?? (sheet.details.grid > 0 ? sheet.details.grid : 5);
  const result = {
    disturbance: 'medium' as const,
    grid,
    clearance: grid * 0.5,
    annotationClearance: grid * 3,
    pinLead: grid * 2,
    corridor: grid * 6,
    maxPasses: 4,
    maxEvaluations: 2500,
    annealingSteps: 0,
    seed: 1,
    ...o,
  };
  for (const key of [
    'grid',
    'clearance',
    'annotationClearance',
    'pinLead',
    'corridor',
  ] as const)
    if (!Number.isFinite(result[key]) || result[key] <= 0)
      throw new Error(`Invalid layout ${key}`);
  for (const key of [
    'maxPasses',
    'maxEvaluations',
    'annealingSteps',
    'seed',
  ] as const)
    if (!Number.isSafeInteger(result[key]) || result[key] < 0)
      throw new Error(`Invalid layout ${key}`);
  if (new Set(sheet.items.map((i) => i._id)).size !== sheet.items.length)
    throw new Error('Layout requires unique item IDs');
  if (!['low', 'medium', 'high'].includes(result.disturbance))
    throw new Error('Invalid disturbance mode');
  const ss = symbols(sheet);
  const area = (s: dsnSymbol) => {
    const r = bodyRect(s);
    return (r.x2 - r.x1) * (r.y2 - r.y1);
  };
  const smallAreas = ss
    .filter((s) => pins(s).length <= 2)
    .map(area)
    .sort((a, b) => a - b);
  const threshold =
    4 * (smallAreas[Math.floor(smallAreas.length / 2)] || grid * grid * 16);
  const large = ss
    .filter((s) =>
      o.largeSymbolIds
        ? o.largeSymbolIds.includes(s._id)
        : pins(s).length > 2 || area(s) > threshold,
    )
    .sort((a, b) => pins(b).length - pins(a).length || a._id - b._id);
  const eligible = large.filter((s) => movable(s, result));
  const allowed = new Set(
    (result.disturbance === 'high'
      ? eligible
      : result.disturbance === 'medium'
      ? eligible.slice(0, 2)
      : []
    ).map((s) => s._id),
  );
  // Pin the classification for the entire run, not a fresh two-component budget per pass.
  return {
    ...result,
    fixedSymbolIds: large.filter((s) => !allowed.has(s._id)).map((s) => s._id),
  };
}
export function translate(item: DocItem, dx: number, dy: number): DocItem {
  if ('point' in item)
    return refresh({
      ...item,
      point: [item.point[0] + dx, item.point[1] + dy],
    } as DocItem);
  return item;
}
export const wires = (sheet: dsnSheet) =>
  sheet.items.filter((i): i is dsnWire => i.NodeName === T.Wire);
export const symbols = (sheet: dsnSheet) =>
  sheet.items.filter((i): i is dsnSymbol => i.NodeName === T.Symbol);
