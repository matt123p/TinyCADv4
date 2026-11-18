import { dsnSheet } from '../model/dsnDrawing';
import { DocItem, dsnWire } from '../model/dsnItem';
import { clean, distance, pins, point, same, symbols, wires } from './geometry';

export interface WirePath {
  wire: dsnWire;
  members: dsnWire[];
  points: number[][];
  reversed: boolean;
}

/** Recover unbranched routes from TinyCAD's native two-point wire items. */
export function wirePaths(sheet: dsnSheet, ports = symbols(sheet).flatMap(pins)): WirePath[] {
  const ws = wires(sheet),
    used = new Set<number>();
  const endpoints = new Map<string, dsnWire[]>();
  const key = (p: number[]) => p[0] + ',' + p[1];
  for (const w of ws)
    for (const p of [w.d_points[0], w.d_points[w.d_points.length - 1]]) {
      const list = endpoints.get(key(p)) || [];
      list.push(w);
      endpoints.set(key(p), list);
    }
  const stop = (p: number[]) =>
    ports.some((port) => same(port.p, p)) ||
    sheet.items.some(
      (i) =>
        ['junction', 'power', 'noconnect'].includes(i.NodeName) &&
        'point' in i &&
        same(i.point, p),
    );
  const result: WirePath[] = [];
  for (const w of ws) {
    if (used.has(w._id)) continue;
    used.add(w._id);
    let ps = w.d_points.map(point),
      members = [w];
    for (const atStart of [false, true]) {
      while (true) {
        const p = atStart ? ps[0] : ps[ps.length - 1],
          incident = endpoints.get(key(p));
        if (stop(p) || incident?.length !== 2) break;
        const next = incident.find((i) => !used.has(i._id));
        if (!next) break;
        used.add(next._id);
        let qs = next.d_points.map(point);
        if (atStart) {
          if (!same(qs[qs.length - 1], p)) qs.reverse();
          ps = [...qs.slice(0, -1), ...ps];
          members.unshift(next);
        } else {
          if (!same(qs[0], p)) qs.reverse();
          ps = [...ps, ...qs.slice(1)];
          members.push(next);
        }
      }
    }
    result.push({ wire: w, members, points: ps, reversed: false });
  }
  return result;
}

/** A straight drawing span may consist of several native wire records. Labels
 * can cover their shared vertex without overhanging the actual drawn line. */
export function wireSpans(sheet: dsnSheet, paths = wirePaths(sheet)) {
  return paths.flatMap((path) => {
    const ps = clean(path.points);
    return ps
      .slice(1)
      .map((b, i) => ({
        a: ps[i],
        b,
        id: path.wire._id,
        members: path.members.map((w) => w._id),
      }));
  });
}

/** Retain every native wire identity while distributing a proposed route. */
export function pathReplacements(
  path: WirePath,
  route: number[][],
): Map<number, DocItem> | null {
  const ps = clean(route);
  // More original items than bends: subdivide the longest span instead of deleting IDs.
  while (ps.length - 1 < path.members.length) {
    let best = -1,
      length = 0;
    for (let i = 1; i < ps.length; i++)
      if (distance(ps[i - 1], ps[i]) > length) {
        best = i;
        length = distance(ps[i - 1], ps[i]);
      }
    if (best < 0 || length < 2) return null;
    ps.splice(best, 0, [
      (ps[best - 1][0] + ps[best][0]) / 2,
      (ps[best - 1][1] + ps[best][1]) / 2,
    ]);
  }
  const changes = new Map<number, DocItem>();
  path.members.forEach((w, i) =>
    changes.set(w._id, {
      ...w,
      d_points:
        i === path.members.length - 1 ? ps.slice(i) : ps.slice(i, i + 2),
    }),
  );
  return changes;
}

/** Explicit grouping by endpoint owners: names alone never imply a connection.
 * Wires stored in either direction are normalised to the same owner order. */
export function wireBundles(sheet: dsnSheet, paths = wirePaths(sheet), ports = symbols(sheet).flatMap(pins)) {
  const groups = new Map<string, WirePath[]>();
  for (const path of paths) {
    const ps = path.points;
    const start = ports.filter((p) => same(p.p, ps[0]));
    const end = ports.filter((p) => same(p.p, ps[ps.length - 1]));
    if (start.length !== 1 || end.length !== 1 || start[0].id === end[0].id)
      continue;
    const reversed = start[0].id > end[0].id;
    const key = [start[0].id, end[0].id].sort((a, b) => a - b).join(':');
    const group = groups.get(key) || [];
    group.push({
      ...path,
      reversed,
      members: reversed ? [...path.members].reverse() : path.members,
      points: (reversed ? [...ps].reverse() : ps).map(point),
    });
    groups.set(key, group);
  }
  return [...groups.values()].filter((g) => g.length >= 2);
}

export function bundleDisorder(sheet: dsnSheet, pitch: number, bundles = wireBundles(sheet)) {
  let cost = 0;
  for (const group of bundles) {
    const first = group[0].points;
    const horizontal =
      Math.abs(first[0][0] - first[first.length - 1][0]) >=
      Math.abs(first[0][1] - first[first.length - 1][1]);
    const axis = horizontal ? 0 : 1;
    const tracks: number[] = [];
    for (const { points } of group) {
      const ps = clean(points);
      cost += Math.max(0, ps.length - 4) * pitch * 4;
      for (let i = 1; i < ps.length - 1; i++)
        if (
          ps[i][axis] === ps[i + 1][axis] &&
          ps[i][1 - axis] !== ps[i + 1][1 - axis]
        )
          tracks.push(ps[i][axis]);
    }
    // Shared corridor width should be just enough for one evenly spaced track per wire.
    if (tracks.length > 1) {
      tracks.sort((a, b) => a - b);
      cost += Math.max(
        0,
        tracks[tracks.length - 1] - tracks[0] - (group.length - 1) * pitch,
      );
      for (let i = 1; i < tracks.length; i++)
        cost += Math.max(0, pitch - (tracks[i] - tracks[i - 1])) * 4;
    }
  }
  return cost;
}
