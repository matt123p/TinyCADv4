import { dsnSheet } from '../model/dsnDrawing';
import { DocItemTypes as T, dsnSymbol } from '../model/dsnItem';
import { LayoutSettings, Point, Rect } from './types';
import { connectivitySignature } from './connectivity';
import {
  bodyRect,
  pins,
  rect,
  symbols,
  texts,
  union,
  wireContains,
  wires,
} from './geometry';

export interface ComponentIsland {
  symbol: dsnSymbol;
  ids: Set<number>;
  centre: Point;
  bounds: Rect;
}

/** A component plus physically attached stubs, flags and power symbols. Named
 * nets do not prevent translation, but a physical connection to another part does. */
export function componentIslands(sheet: dsnSheet): ComponentIsland[] {
  const nets = (JSON.parse(connectivitySignature(sheet, true)) as string[]).map(
    (g) => g.split('|'),
  );
  const result: ComponentIsland[] = [];
  for (const symbol of symbols(sheet)) {
    const prefix = `pin:${symbol._id}:`,
      ids = new Set<number>([symbol._id]);
    const connected = nets.filter((g) => g.some((t) => t.startsWith(prefix)));
    if (
      connected.some((g) =>
        g.some((t) => t.startsWith('pin:') && !t.startsWith(prefix)),
      )
    )
      continue;
    for (const group of connected)
      for (const token of group)
        if (!token.startsWith('pin:')) ids.add(Number(token.split(':')[1]));
    const ws = wires(sheet).filter((w) => ids.has(w._id));
    for (const i of sheet.items)
      if (i.NodeName === T.Junction && ws.some((w) => wireContains(w, i.point)))
        ids.add(i._id);
    const body = bodyRect(symbol);
    const bounds = union(
      sheet.items
        .filter((i) => ids.has(i._id))
        .flatMap((i) =>
          [
            bodyRect(i),
            ...texts(i),
            ...('d_points' in i ? i.d_points.map((p) => rect(p, p)) : []),
          ].filter(Boolean),
        ),
    );
    result.push({
      symbol,
      ids,
      bounds,
      centre: [(body.x1 + body.x2) / 2, (body.y1 + body.y2) / 2],
    });
  }
  return result;
}

/** Repeat families by reference designator and actual pin geometry, not library
 * UID: two capacitor values or source waveforms often have different definitions.
 * Keep orientation, scale and pin polarity intact. */
export function componentPatterns(sheet: dsnSheet) {
  const groups = new Map<string, ComponentIsland[]>();
  for (const island of componentIslands(sheet)) {
    const s = island.symbol,
      ps = pins(s);
    if (
      ps.length !== 2 ||
      ps[0].direction[0] !== -ps[1].direction[0] ||
      ps[0].direction[1] !== -ps[1].direction[1]
    )
      continue;
    const ref = s.text.find((t) => t.description === 'Ref')?.value || '';
    const family = /^([A-Za-z]+)\d/.exec(ref)?.[1]?.toUpperCase();
    if (!family) continue;
    const body = bodyRect(s),
      key = [
        family,
        s.rotation,
        body.x2 - body.x1,
        body.y2 - body.y1,
        ps[0].direction.join(','),
      ].join(':');
    const group = groups.get(key) || [];
    group.push(island);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((g) =>
      g.sort(
        (a, b) =>
          a.symbol.text
            .find((t) => t.description === 'Ref')
            .value.localeCompare(
              b.symbol.text.find((t) => t.description === 'Ref').value,
              undefined,
              { numeric: true },
            ) || a.symbol._id - b.symbol._id,
      ),
    );
}

export function patternAxis(group: ComponentIsland[]) {
  return pins(group[0].symbol)[0].direction[0] === 0 ? 0 : 1;
}

export function patternPitch(
  group: ComponentIsland[],
  axis: number,
  o: LayoutSettings,
) {
  const before = Math.max(
    ...group.map(
      (c) => c.centre[axis] - (axis === 0 ? c.bounds.x1 : c.bounds.y1),
    ),
  );
  const after = Math.max(
    ...group.map(
      (c) => (axis === 0 ? c.bounds.x2 : c.bounds.y2) - c.centre[axis],
    ),
  );
  return (
    Math.ceil(
      (before + after + Math.max(o.annotationClearance, o.grid * 2)) / o.grid,
    ) * o.grid
  );
}

/** Alignment and regular spacing outrank small reductions in area or net length.
 * Penalise excessive pitch as well: a tidy but widely scattered row is not a group. */
export function componentDisorder(sheet: dsnSheet, o: LayoutSettings) {
  let score = 0;
  for (const group of componentPatterns(sheet)) {
    const axis = patternAxis(group),
      cross = 1 - axis,
      preferred = patternPitch(group, axis, o);
    const mean = group.reduce((n, c) => n + c.centre[cross], 0) / group.length;
    const pitch =
      (group[group.length - 1].centre[axis] - group[0].centre[axis]) /
      (group.length - 1);
    score += group.reduce((n, c) => n + Math.abs(c.centre[cross] - mean), 0);
    for (let i = 1; i < group.length; i++)
      score += Math.abs(
        group[i].centre[axis] - group[i - 1].centre[axis] - pitch,
      );
    score +=
      Math.max(0, preferred - pitch) +
      Math.max(0, pitch - preferred - o.corridor) * 0.25;
  }
  return score;
}
