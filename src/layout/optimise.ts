import { dsnSheet } from '../model/dsnDrawing';
import {
  Coordinate,
  DocItem,
  DocItemTypes as T,
  dsnLabel,
  dsnSymbol,
  dsnWire,
} from '../model/dsnItem';
import {
  LayoutAnalysis,
  LayoutMetrics,
  LayoutOptions,
  LayoutPhase,
  LayoutResult,
  LayoutSettings,
  Point,
} from './types';
import { analysePrepared, analyseRouteMetrics, labelFits } from './analyse';
import { labelPositions, labelSpanLength } from './labels';
import { labelGroups } from './labelGroups';
import { connectivitySignature, symbolConnections } from './connectivity';
import { pathReplacements, wireBundles, wirePaths, wireSpans } from './bundles';
import {
  componentIslands,
  componentPatterns,
  patternAxis,
  patternPitch,
} from './patterns';
import {
  bodyRect,
  symbolArtwork,
  clean,
  cloneSheet,
  distance,
  expand,
  intersects,
  movable,
  onSegment,
  pins,
  point,
  rect,
  refresh,
  same,
  segments,
  settings,
  snap,
  symbols,
  texts,
  translate,
  union,
  wireContains,
  wires,
} from './geometry';

const hardKeys: (keyof LayoutMetrics)[] = [
  'bodyCollisions',
  'wireBodyCollisions',
  'crossings',
  'overlaps',
  'diagonalSegments',
];
function quality(m: LayoutMetrics, o: LayoutSettings) {
  // Lexicographic priorities: no amount of saved wire pays for a worse bundle.
  return [
    m.bodyCollisions + m.wireBodyCollisions,
    m.pinExitViolations + m.textCollisions + m.labelOverhangs,
    m.junctionIssues,
    m.bundleDisorder,
    m.bends,
    m.labelAlignment,
    m.annotationCrowding,
    m.componentDisorder,
    m.connectedDistance * 2 +
      m.logicalProximity * 0.5 +
      m.wireLength +
      m.bends * o.grid * 4 +
      m.inlineImbalance * 0.5 +
      m.area / (o.corridor * 10) +
      m.labelDistance * 2 +
      m.netLabelPosition * 2,
  ];
}
function better(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i++)
    if (Math.abs(a[i] - b[i]) > 1e-6) return a[i] < b[i];
  return false;
}
function changed(a: DocItem, b: DocItem) {
  // Geometry only. Do not emit cache-only changes into undo history.
  const geometry = (i: DocItem) =>
    JSON.stringify({
      p: 'point' in i ? i.point : null,
      w: 'd_points' in i ? i.d_points : null,
      r: 'rotation' in i ? i.rotation : null,
      t: i.NodeName === T.Symbol ? i.text.map((t) => t.position) : null,
    });
  return geometry(a) !== geometry(b);
}

class Search {
  sheet: dsnSheet;
  analysis: LayoutAnalysis;
  evaluations = 0;
  stopped: LayoutResult['stopped'] = 'converged';
  phaseProgress: LayoutResult['phaseProgress'] = [];
  private phaseLimit = Infinity;
  private phaseExhausted = false;
  private phaseResourceLimit = -Infinity;
  runPhase(phase: LayoutPhase, pass: number, budget: number, remainingPhases: number, action: () => void) {
    const start = this.evaluations;
    this.phaseLimit = start + budget;
    this.phaseExhausted = false;
    const resources = this.o.remainingBudget?.();
    this.phaseResourceLimit = resources == null ? -Infinity : resources - resources / remainingPhases;
    try {
      if (budget > 0 && this.available()) action();
      else this.phaseExhausted = true;
    }
    finally {
      this.phaseProgress.push({ phase, pass, evaluations: this.evaluations - start,
        budgetExhausted: this.phaseExhausted || budget === 0 });
      this.phaseLimit = Infinity;
      this.phaseResourceLimit = -Infinity;
    }
  }
  readonly electrical: string;
  readonly physical: string;
  constructor(sheet: dsnSheet, public o: LayoutSettings) {
    this.sheet = sheet;
    this.electrical = connectivitySignature(sheet);
    this.physical = connectivitySignature(sheet, true);
    // Accepted proposals must preserve these partitions. Reuse their membership
    // for scoring; every geometry-changing acceptance still verifies connectivity.
    o.symbolConnections = symbolConnections(sheet, this.electrical);
    o.physicalPartition = this.physical;
    this.analysis = analysePrepared(sheet, o);
  }
  available() {
    if (this.o.cancelled?.()) {
      this.stopped = 'cancelled';
      return false;
    }
    const resources = this.o.remainingBudget?.() ?? Infinity;
    if (this.evaluations >= this.o.maxEvaluations || resources <= 0) {
      this.stopped = 'budget';
      if (this.phaseLimit !== Infinity) this.phaseExhausted = true;
      return false;
    }
    if (this.evaluations >= this.phaseLimit || resources <= this.phaseResourceLimit) {
      this.phaseExhausted = true;
      return false;
    }
    return true;
  }
  consider(items: DocItem[], forceText = false) {
    if (!this.available()) return false;
    this.evaluations++;
    const candidate = { ...this.sheet, items };
    const analysis = analysePrepared(candidate, this.o);
    const a = analysis.metrics,
      b = this.analysis.metrics;
    if (hardKeys.some((k) => a[k] > b[k])) return false;
    // Extra bends need a concrete clearance, pin-exit or label-support benefit.
    // Attraction, compaction and soft spacing alone cannot justify a dogleg.
    if (
      a.bends > b.bends &&
      !(
        [
          'bodyCollisions',
          'wireBodyCollisions',
          'pinExitViolations',
          'textCollisions',
          'labelOverhangs',
        ] as const
      ).some((k) => a[k] < b[k])
    )
      return false;
    const hardCodes = new Set([
      'body-overlap',
      'wire-body',
      'crossing',
      'wire-overlap',
      'diagonal',
      'text-wire',
      'text-body',
      'text-overlap',
    ]);
    const key = (d: LayoutAnalysis['diagnostics'][number]) =>
      d.code + ':' + [...d.itemIds].sort((a, b) => a - b).join(',');
    const existing = new Set(
      this.analysis.diagnostics.filter((d) => hardCodes.has(d.code)).map(key),
    );
    if (
      analysis.diagnostics.some(
        (d) => hardCodes.has(d.code) && !existing.has(key(d)),
      )
    )
      return false;
    // Each readability class is protected independently.
    if (
      a.pinExitViolations > b.pinExitViolations ||
      a.textCollisions > b.textCollisions ||
      a.labelOverhangs > b.labelOverhangs
    )
      return false;
    if (!better(quality(a, this.o), quality(b, this.o))) return false;
    if (
      !forceText &&
      (connectivitySignature(candidate) !== this.electrical ||
        connectivitySignature(candidate, true) !== this.physical)
    )
      return false;
    this.sheet = candidate;
    this.analysis = analysis;
    return true;
  }
  replace(replacements: Map<number, DocItem>, textOnly = false) {
    return this.consider(
      this.sheet.items.map((i) => replacements.get(i._id) || i),
      textOnly,
    );
  }
}

/** Delete only empty strips. The map is monotone, symbols translate rigidly,
 * wire endpoints/branches/labels use exactly the same map. */
function compact(search: Search) {
  const { o } = search;
  for (const axis of [0, 1]) {
    const intervals: [number, number][] = [];
    for (const i of search.sheet.items) {
      // Page titles and lesson notes are fixed obstacles, not part of the circuit's
      // compaction envelope. Candidate collision checks still protect them.
      if (
        ![T.Symbol, T.Wire, T.Label, T.Power, T.NoConnect, T.Junction].includes(
          i.NodeName,
        )
      )
        continue;
      const rs = [bodyRect(i), ...texts(i)].filter(Boolean);
      if (i.NodeName === T.Symbol) rs.push(union([bodyRect(i), ...texts(i)]));
      if ('point' in i) rs.push(rect(i.point, i.point));
      if ('d_points' in i) rs.push(...i.d_points.map((p) => rect(p, p)));
      for (const r of rs)
        intervals.push(axis === 0 ? [r.x1, r.x2] : [r.y1, r.y2]);
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let end = intervals[0]?.[1];
    const cuts: { at: number; amount: number }[] = [];
    for (const r of intervals.slice(1)) {
      const amount = Math.floor((r[0] - end - o.corridor) / o.grid) * o.grid;
      if (amount > 0) cuts.push({ at: (end + r[0]) / 2, amount });
      end = Math.max(end, r[1]);
    }
    // Rightmost first keeps remaining cut coordinates valid.
    for (const cut of cuts.reverse()) {
      if (!search.available()) return;
      const map = (p: Coordinate) => {
        const q = point(p);
        if (q[axis] > cut.at) q[axis] -= cut.amount;
        return q;
      };
      const candidates = search.sheet.items.map((i) => {
        if (!movable(i, o)) return i;
        if (i.NodeName === T.Wire)
          return { ...i, d_points: i.d_points.map(map) };
        if ('point' in i) {
          const p = map(i.point);
          return same(p, i.point)
            ? i
            : translate(i, p[0] - i.point[0], p[1] - i.point[1]);
        }
        return i;
      });
      search.consider(candidates);
    }
  }
}

function routeCandidates(
  sheet: dsnSheet,
  a: Coordinate,
  b: Coordinate,
  o: LayoutSettings,
  obstacleDetours = false,
): Coordinate[][] {
  const ports = symbols(sheet).flatMap(pins);
  const pa = ports.find((p) => same(p.p, a)),
    pb = ports.find((p) => same(p.p, b));
  const start = pa?.length
    ? [a[0] + pa.direction[0] * o.pinLead, a[1] + pa.direction[1] * o.pinLead]
    : a;
  const end = pb?.length
    ? [b[0] + pb.direction[0] * o.pinLead, b[1] + pb.direction[1] * o.pinLead]
    : b;
  const routes: Coordinate[][] = [];
  const add = (middle: Coordinate[]) =>
    routes.push(clean([a, start, ...middle, end, b]));
  if (start[0] === end[0] || start[1] === end[1]) add([]);
  add([[start[0], end[1]]]);
  add([[end[0], start[1]]]);
  for (const x of [
    snap((start[0] + end[0]) / 2, o.grid),
    Math.min(start[0], end[0]) - o.pinLead,
    Math.max(start[0], end[0]) + o.pinLead,
  ])
    add([
      [x, start[1]],
      [x, end[1]],
    ]);
  for (const y of [
    snap((start[1] + end[1]) / 2, o.grid),
    Math.min(start[1], end[1]) - o.pinLead,
    Math.max(start[1], end[1]) + o.pinLead,
  ])
    add([
      [start[0], y],
      [end[0], y],
    ]);
  // Route beyond the obstacle's actual extent, not just a fixed offset from
  // the endpoints. Include text so a clearance detour leaves room to read it.
  const corridor = expand(rect(start, end), 0.01);
  const obstacles = (obstacleDetours ? sheet.items : [])
    .flatMap((i) => [bodyRect(i), ...texts(i)].filter(Boolean))
    .filter((r) => intersects(expand(r, o.clearance), corridor));
  for (const r of obstacles) {
    const margin = Math.max(o.pinLead, o.annotationClearance);
    for (const y of [
      Math.floor((r.y1 - margin) / o.grid) * o.grid,
      Math.ceil((r.y2 + margin) / o.grid) * o.grid,
    ])
      add([
        [start[0], y],
        [end[0], y],
      ]);
    for (const x of [
      Math.floor((r.x1 - margin) / o.grid) * o.grid,
      Math.ceil((r.x2 + margin) / o.grid) * o.grid,
    ])
      add([
        [x, start[1]],
        [x, end[1]],
      ]);
  }
  const seen = new Set<string>();
  return routes
    .filter((r) => r.length >= 2)
    .filter((r) => {
      const key = JSON.stringify(r);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.length - b.length || pathLength(a) - pathLength(b));
}
const pathLength = (ps: Coordinate[]) =>
  ps.slice(1).reduce((n, p, i) => n + distance(p, ps[i]), 0);

/** Reattach movable plain labels as part of the same routing proposal. Moving
 * a wire alone would leave its label behind and fail the connectivity gate. */
function replaceRoute(search: Search, replacements: Map<number, DocItem>) {
  if (
    ![...replacements].some(([id, item]) =>
      changed(
        search.sheet.items.find((i) => i._id === id),
        item,
      ),
    )
  )
    return;
  if (search.replace(replacements)) return;
  const changedWires = [...replacements.values()].filter(
    (i): i is dsnWire => i.NodeName === T.Wire,
  );
  const labels = search.sheet.items.filter(
    (i): i is dsnLabel =>
      i.NodeName === T.Label &&
      i.which === 0 &&
      movable(i, search.o) &&
      changedWires.some(
        (w) =>
          wireContains(
            search.sheet.items.find((old) => old._id === w._id) as dsnWire,
            i.point,
          ) &&
          !segments(w).some((s) => labelFits(i, s.a, s.b, search.o.clearance)),
      ),
  );
  if (!labels.length) return;
  const candidates = labels.map((l) =>
    wireSpans({
      ...search.sheet,
      items: search.sheet.items.map((i) => replacements.get(i._id) || i),
    })
      .filter((s) =>
        s.members.some((id) =>
          changedWires.some(
            (w) =>
              w._id === id &&
              wireContains(
                search.sheet.items.find((i) => i._id === id) as dsnWire,
                l.point,
              ),
          ),
        ),
      )
      .flatMap((s) => labelPositions(l, s.a, s.b, search.o))
      .sort((a, b) => distance(a.point, l.point) - distance(b.point, l.point)),
  );
  // Bounded joint proposals, with individual alternatives for the common single-label case.
  for (
    let choice = 0;
    choice < Math.min(12, Math.max(...candidates.map((cs) => cs.length)));
    choice++
  ) {
    if (!search.available()) return;
    const next = new Map(replacements);
    labels.forEach((l, i) => {
      if (candidates[i].length)
        next.set(l._id, candidates[i][choice % candidates[i].length]);
    });
    if (search.replace(next)) return;
  }
}

/** Remove a local excursion without rerouting the rest of a constrained path.
 * Native segment boundaries are not bends; inspect the recovered, cleaned route.
 * Down/across/up (or its rotations) can use either of the two monotone corners.
 * The normal proposal gate still checks obstacles, text, pins and both net maps.
 */
function simplifyBacktracks(search: Search) {
  let improved = true;
  while (improved && search.available()) {
    improved = false;
    for (const path of wirePaths(search.sheet)) {
      if (!path.members.every((w) => movable(w, search.o))) continue;
      const ps = clean(path.points);
      for (let i = 0; i + 3 < ps.length; i++) {
        const [a, b, c, d] = ps.slice(i, i + 4);
        const vertical =
          a[0] === b[0] && b[1] === c[1] && c[0] === d[0] &&
          (b[1] - a[1]) * (d[1] - c[1]) < 0;
        const horizontal =
          a[1] === b[1] && b[0] === c[0] && c[1] === d[1] &&
          (b[0] - a[0]) * (d[0] - c[0]) < 0;
        if (!vertical && !horizontal) continue;
        for (const corner of [[a[0], d[1]], [d[0], a[1]]]) {
          if (!search.available()) return;
          const route = clean([...ps.slice(0, i + 1), corner, ...ps.slice(i + 3)]);
          if (route.length >= ps.length || pathLength(route) >= pathLength(ps)) continue;
          const replacement = pathReplacements(path, route);
          if (!replacement) continue;
          const before = search.sheet;
          replaceRoute(search, replacement);
          if (search.sheet !== before) {
            improved = true;
            break;
          }
        }
        if (improved) break;
      }
      // Rebuild paths after a successful shortcut or a jointly moved label.
      if (improved) break;
    }
  }
}

function routeWires(search: Search) {
  straightenFreeTails(search);
  for (const path of wirePaths(search.sheet)) {
    if (
      path.members.length < 2 ||
      !path.members.every((w) => movable(w, search.o))
    )
      continue;
    const ps = path.points;
    for (const route of routeCandidates(
      search.sheet,
      ps[0],
      ps[ps.length - 1],
      search.o,
    )) {
      if (!search.available()) return;
      const replacement = pathReplacements(path, route);
      if (replacement) search.replace(replacement);
    }
  }
  for (const id of wires(search.sheet)
    .filter((w) => movable(w, search.o))
    .map((w) => w._id)) {
    const w = wires(search.sheet).find((w) => w._id === id),
      ps = w.d_points;
    if (!search.available()) return;
    const candidates = [
      clean(ps),
      ...routeCandidates(search.sheet, ps[0], ps[ps.length - 1], search.o),
    ];
    // Local dogleg removal keeps the rest of a branched/labelled polyline intact.
    for (let i = 0; i < ps.length - 2; i++)
      for (let j = i + 2; j < ps.length; j++)
        if (ps[i][0] === ps[j][0] || ps[i][1] === ps[j][1])
          candidates.push([...ps.slice(0, i + 1), ...ps.slice(j)]);
    for (const route of candidates) {
      if (!search.available()) return;
      search.replace(new Map([[id, { ...w, d_points: route }]]));
    }
  }
}

/** A dangling endpoint is not a fixed destination. An isolated movable power
 * terminal can follow its pin too. Preserve net and wire identities while
 * removing elbows left behind after components move away from obstacles. */
function straightenFreeTails(search: Search) {
  const ports = symbols(search.sheet).flatMap(pins);
  for (const path of wirePaths(search.sheet)) {
    if (!search.available()) return;
    if (!path.members.every((w) => movable(w, search.o))) continue;
    const ends = [path.points[0], path.points[path.points.length - 1]];
    const attached = ends.map((p) => ports.filter((port) => same(port.p, p)));
    const start =
      attached[0].length === 1 ? 0 : attached[1].length === 1 ? 1 : -1;
    if (start < 0 || attached[1 - start].length) continue;
    const pin = attached[start][0],
      free = ends[1 - start],
      ids = new Set(path.members.map((w) => w._id));
    const terminal = search.sheet.items.find(
      (i) =>
        i.NodeName === T.Power &&
        same(i.point, free) &&
        movable(i, search.o) &&
        (!search.o.phases || search.o.phases.includes('placement')),
    );
    if (
      search.sheet.items.some(
        (i) =>
          !ids.has(i._id) &&
          i._id !== pin.id &&
          i._id !== terminal?._id &&
          ((i.NodeName === T.Wire &&
            path.points.some((p) => wireContains(i, p))) ||
            ('point' in i &&
              i.NodeName !== T.Label &&
              path.members.some((w) => wireContains(w, i.point)))),
      )
    )
      continue;
    const labelLength = Math.max(
      0,
      ...search.sheet.items
        .filter(
          (i) =>
            i.NodeName === T.Label &&
            path.members.some((w) => wireContains(w, i.point)),
        )
        .map((i) =>
          labelSpanLength(
            i as dsnLabel,
            !!pin.direction[0],
            search.o.clearance,
          ),
        ),
    );
    const length = Math.max(
      search.o.pinLead,
      Math.ceil(labelLength / search.o.grid) * search.o.grid,
      Math.abs(
        (free[0] - pin.p[0]) * pin.direction[0] +
          (free[1] - pin.p[1]) * pin.direction[1],
      ),
    );
    const route = [
      pin.p,
      [
        pin.p[0] + pin.direction[0] * length,
        pin.p[1] + pin.direction[1] * length,
      ],
    ];
    if (start === 1) route.reverse();
    const replacement = pathReplacements(path, route);
    if (replacement) {
      if (terminal) {
        const end = route[1 - start];
        replacement.set(
          terminal._id,
          translate(terminal, end[0] - free[0], end[1] - free[1]),
        );
      }
      replaceRoute(search, replacement);
    }
  }
}

function routeBundles(search: Search) {
  const { o } = search;
  for (const group of wireBundles(search.sheet)) {
    if (!group.every((w) => w.members.every((m) => movable(m, o)))) continue;
    const first = group[0].points,
      axis =
        Math.abs(first[0][0] - first[first.length - 1][0]) >=
        Math.abs(first[0][1] - first[first.length - 1][1])
          ? 0
          : 1;
    const sorted = [...group].sort(
      (a, b) => a.points[0][1 - axis] - b.points[0][1 - axis],
    );
    const ends = sorted.map((w) => w.points[w.points.length - 1][1 - axis]);
    // Reversed pin order cannot be made crossing-free with a common channel.
    if (ends.some((n, i) => i > 0 && n <= ends[i - 1])) continue;
    const middle = snap(
      group.reduce(
        (n, w) =>
          n + (w.points[0][axis] + w.points[w.points.length - 1][axis]) / 2,
        0,
      ) / group.length,
      o.grid,
    );
    for (const sign of [1, -1])
      for (const offset of [0, -o.corridor, o.corridor]) {
        const changes = new Map<number, DocItem>();
        sorted.forEach((w, i) => {
          const a = w.points[0],
            b = w.points[w.points.length - 1];
          const track =
            middle +
            offset +
            sign * (i - Math.floor((group.length - 1) / 2)) * o.grid * 2;
          const c = point(a),
            d = point(b);
          c[axis] = track;
          d[axis] = track;
          const ps = clean([a, c, d, b]);
          const replacements = pathReplacements(w, ps);
          if (replacements)
            for (const [id, item] of replacements) changes.set(id, item);
        });
        search.replace(changes);
      }
  }
}

/** Existing collisions need explicit escape moves: attraction/compaction only
 * propose shrinking moves. Move a blocked ground terminal with its lead, or a
 * component to either side of the obstructing span, subject to the same gates. */
function repairObstructions(search: Search, allowPlacement: boolean) {
  const { o } = search;
  const conflicts = search.analysis.diagnostics.filter(
    (d) => d.code === 'wire-body' || d.code === 'text-body',
  );
  conflictLoop: for (const conflict of conflicts.slice(0, 24)) {
    if (!search.available()) return;
    const [sourceId, bodyId] = conflict.itemIds;
    const resolved = () =>
      !search.analysis.diagnostics.some(
        (d) =>
          d.code === conflict.code &&
          d.itemIds[0] === sourceId &&
          d.itemIds[1] === bodyId,
      );
    if (resolved() || sourceId === bodyId) continue;
    const body = search.sheet.items.find((i) => i._id === bodyId);
    const source = search.sheet.items.find((i) => i._id === sourceId);
    if (!body || !source) continue;
    const obstructing =
      source.NodeName === T.Wire
        ? [source]
        : source.NodeName === T.Label
        ? wires(search.sheet).filter((w) => wireContains(w, source.point))
        : [];
    const reroute = () => {
      for (const w of obstructing.filter((w) => movable(w, o)))
        for (const route of routeCandidates(
          search.sheet,
          w.d_points[0],
          w.d_points[w.d_points.length - 1],
          o,
          true,
        )) {
          if (!search.available()) return;
          replaceRoute(search, new Map([[w._id, { ...w, d_points: route }]]));
          if (resolved()) return;
        }
    };
    if (body.NodeName !== T.Power || !allowPlacement || !movable(body, o))
      reroute();
    if (resolved()) continue;
    if (!allowPlacement || !movable(body, o)) continue;
    if (
      !search.analysis.diagnostics.some(
        (d) =>
          (d.code === 'wire-body' || d.code === 'text-body') &&
          d.itemIds[1] === bodyId,
      )
    )
      continue;
    const bounds = union([bodyRect(body), ...texts(body)].filter(Boolean));
    const moves: Point[] = [];
    // A label on the ground's own lead needs more straight span, not a sideways
    // escape. Try extending along that lead before introducing any corner.
    if (body.NodeName === T.Power && source.NodeName === T.Label)
      for (const w of obstructing) {
        const ps = w.d_points;
        if (ps.length !== 2 || !ps.some((p) => same(p, body.point))) continue;
        const other = same(ps[0], body.point) ? ps[1] : ps[0];
        if (other[0] !== body.point[0] && other[1] !== body.point[1]) continue;
        const horizontal = other[1] === body.point[1];
        const extra = Math.max(
          o.grid,
          Math.ceil(
            (labelSpanLength(source, horizontal, o.clearance) -
              distance(other, body.point)) /
              o.grid,
          ) * o.grid,
        );
        for (const amount of [extra, extra + o.corridor])
          moves.push([
            Math.sign(body.point[0] - other[0]) * amount,
            Math.sign(body.point[1] - other[1]) * amount,
          ]);
      }
    moves.push(
      ...((body.NodeName === T.Power
        ? [
            [-o.corridor, 0],
            [o.corridor, 0],
          ]
        : []) as Point[]),
    );
    for (const w of obstructing)
      for (const s of segments(w)) {
        const horizontal = s.a[1] === s.b[1];
        if (horizontal)
          moves.push(
            [0, snap(s.a[1] - bounds.y2 - o.annotationClearance, o.grid)],
            [0, snap(s.a[1] - bounds.y1 + o.annotationClearance, o.grid)],
          );
        else
          moves.push(
            [snap(s.a[0] - bounds.x2 - o.annotationClearance, o.grid), 0],
            [snap(s.a[0] - bounds.x1 + o.annotationClearance, o.grid), 0],
          );
      }
    moves.push(
      [-o.corridor, 0],
      [o.corridor, 0],
      [0, -o.corridor],
      [0, o.corridor],
    );
    for (const [dx, dy] of moves) {
      if (!search.available()) return;
      if (body.NodeName === T.Symbol) {
        moveSymbol(search, body, dx, dy);
        if (resolved()) continue conflictLoop;
      } else if (body.NodeName === T.Power) {
        const attached = wires(search.sheet).filter((w) =>
          wireContains(w, body.point),
        );
        if (attached.length !== 1 || !movable(attached[0], o)) continue;
        const w = attached[0],
          ps = w.d_points;
        if (
          ps.length !== 2 ||
          (!same(ps[0], body.point) && !same(ps[1], body.point))
        )
          continue;
        // Other terminals at this anchor would have to move too; leave them fixed.
        if (
          search.sheet.items.some(
            (i) =>
              i._id !== bodyId &&
              i._id !== w._id &&
              (('point' in i && same(i.point, body.point)) ||
                (i.NodeName === T.Symbol &&
                  pins(i).some((p) => same(p.p, body.point)))),
          )
        )
          continue;
        const moved = translate(body, dx, dy);
        const endpoint = same(ps[0], body.point) ? 0 : 1;
        const ends = ps.map(point);
        ends[endpoint] = [body.point[0] + dx, body.point[1] + dy];
        const candidateSheet = {
          ...search.sheet,
          items: search.sheet.items.map((i) => (i._id === bodyId ? moved : i)),
        };
        for (const route of routeCandidates(
          candidateSheet,
          ends[0],
          ends[1],
          o,
        )) {
          if (!search.available()) return;
          replaceRoute(
            search,
            new Map<number, DocItem>([
              [bodyId, moved],
              [w._id, { ...w, d_points: route }],
            ]),
          );
          if (resolved()) continue conflictLoop;
        }
      }
    }
    if (body.NodeName === T.Power) reroute();
  }
}

/** Only move terminals whose incident routes can be changed in this selection.
 * Branches in a wire interior are preserved by rejecting moves that detach them. */
function moveSymbol(search: Search, s: dsnSymbol, dx: number, dy: number) {
  if (!dx && !dy) return;
  const { o } = search,
    ps = pins(s),
    allWires = wires(search.sheet);
  const moved = translate(s, dx, dy) as dsnSymbol;
  const attached = allWires.filter((w) => ps.some((p) => wireContains(w, p.p)));
  if (attached.some((w) => !movable(w, o))) return;
  const replacements = new Map<number, DocItem>([[s._id, moved]]);
  // Labels/power/no-connect at a moved pin must travel with it or block the move.
  for (const i of search.sheet.items)
    if ('point' in i && i._id !== s._id && ps.some((p) => same(p.p, i.point))) {
      if (!movable(i, o) || i.NodeName === T.Symbol) return;
      replacements.set(i._id, translate(i, dx, dy));
    }
  const sheet = {
    ...search.sheet,
    items: search.sheet.items.map((i) => replacements.get(i._id) || i),
  };
  for (const w of attached) {
    const route = w.d_points.map(point);
    const atStart = ps.some((p) => same(p.p, route[0])),
      atEnd = ps.some((p) => same(p.p, route[route.length - 1]));
    if (!atStart && !atEnd) return;
    // First try sliding the endpoint along its existing segment.
    if (atStart) {
      route[0][0] += dx;
      route[0][1] += dy;
    }
    if (atEnd) {
      route[route.length - 1][0] += dx;
      route[route.length - 1][1] += dy;
    }
    let candidates = [
      route,
      ...routeCandidates(sheet, route[0], route[route.length - 1], o),
    ];
    // Keep attachments in the old interior: never route past a branch silently.
    const checkpoints = search.sheet.items.flatMap((i) => {
      if (i._id === w._id || replacements.has(i._id)) return [];
      if (i.NodeName === T.Wire)
        return i.d_points.filter((p) => wireContains(w, p));
      if ('point' in i && wireContains(w, i.point)) return [i.point];
      if (i.NodeName === T.Symbol)
        return pins(i)
          .map((p) => p.p)
          .filter((p) => wireContains(w, p));
      return [];
    });
    candidates = candidates.filter((r) =>
      checkpoints.every((p) =>
        segments({ ...w, d_points: r }).some((s) => onSegment(p, s.a, s.b)),
      ),
    );
    let best: Coordinate[] | null = null,
      bestCost = Infinity;
    for (const candidate of candidates) {
      const tmp = {
        ...sheet,
        items: sheet.items.map((i) =>
          i._id === w._id
            ? { ...w, d_points: candidate }
            : replacements.get(i._id) || i,
        ),
      };
      const m = analyseRouteMetrics(tmp, o.pinLead);
      const cost =
        m.diagonalSegments * 1e9 +
        m.wireBodyCollisions * 1e8 +
        m.pinExitViolations * 1e7 +
        m.overlaps * 1e6 +
        m.crossings * 1e5 +
        pathLength(candidate) +
        candidate.length * o.grid;
      if (cost < bestCost) {
        best = candidate;
        bestCost = cost;
      }
    }
    if (!best) return;
    replacements.set(w._id, { ...w, d_points: best });
  }
  search.replace(replacements);
}

function placeSymbols(search: Search) {
  for (const id of symbols(search.sheet)
    .filter((s) => movable(s, search.o))
    .map((s) => s._id)) {
    if (!search.available()) return;
    const s = symbols(search.sheet).find((s) => s._id === id),
      ps = pins(s),
      ws = wires(search.sheet);
    const moves: Point[] = [];
    if (
      ps.length === 2 &&
      ps[0].direction[0] === -ps[1].direction[0] &&
      ps[0].direction[1] === -ps[1].direction[1]
    ) {
      const legs = ps.map((p) =>
        ws.flatMap(segments).filter((w) => same(w.a, p.p) || same(w.b, p.p)),
      );
      if (legs.every((l) => l.length === 1)) {
        const far = legs.map((l, i) =>
          same(l[0].a, ps[i].p) ? l[0].b : l[0].a,
        );
        const axis = ps[0].direction[0] !== 0 ? 0 : 1;
        if (far.every((p, i) => p[1 - axis] === ps[i].p[1 - axis])) {
          const delta = snap(
            (far[0][axis] + far[1][axis] - ps[0].p[axis] - ps[1].p[axis]) / 2,
            search.o.grid,
          );
          moves.push(axis === 0 ? [delta, 0] : [0, delta]);
        }
      }
    }
    // Attraction to physical neighbours, one axis at a time, at a bounded step.
    const targets = ws.flatMap((w) => {
      const a = w.d_points[0],
        b = w.d_points[w.d_points.length - 1];
      if (ps.some((p) => same(p.p, a))) return [b];
      if (ps.some((p) => same(p.p, b))) return [a];
      return [];
    });
    if (targets.length)
      for (const axis of [0, 1]) {
        if (
          ps.length === 2 &&
          ps[0].direction[axis] === 0 &&
          ps[1].direction[axis] === 0
        )
          continue;
        const centre =
          ps.reduce((n, p) => n + p.p[axis], 0) / Math.max(1, ps.length);
        const desired =
          targets.reduce((n, p) => n + p[axis], 0) / targets.length - centre;
        const delta = snap(
          Math.sign(desired) *
            Math.min(Math.abs(desired) / 2, search.o.corridor),
          search.o.grid,
        );
        moves.push(axis === 0 ? [delta, 0] : [0, delta]);
      }
    for (const [dx, dy] of moves) {
      if (!search.available()) return;
      // Refresh symbol after an earlier accepted proposal.
      moveSymbol(
        search,
        symbols(search.sheet).find((s) => s._id === id),
        dx,
        dy,
      );
    }
  }
}

function attractConnectedClusters(search: Search) {
  for (const id of symbols(search.sheet)
    .filter((s) => movable(s, search.o))
    .map((s) => s._id)) {
    if (!search.available()) return;
    const sheet = search.sheet,
      island = componentIslands(sheet, search.physical).find((c) => c.symbol._id === id);
    if (!island) continue; // Physically attached neighbours use endpoint rerouting.
    const { symbol: s, ids } = island;
    if (sheet.items.some((i) => ids.has(i._id) && !movable(i, search.o)))
      continue;
    const neighbours = symbolConnections(sheet, search.electrical).flatMap((p) =>
      p.a === id
        ? [{ id: p.b, weight: p.weight }]
        : p.b === id
        ? [{ id: p.a, weight: p.weight }]
        : [],
    );
    if (!neighbours.length) continue;
    const r = bodyRect(s),
      centre = [(r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2];
    for (const axis of [0, 1]) {
      const total = neighbours.reduce((n, p) => n + p.weight, 0);
      const target =
        neighbours.reduce((n, p) => {
          const r = bodyRect(sheet.items.find((i) => i._id === p.id));
          return (
            n + p.weight * (axis === 0 ? (r.x1 + r.x2) / 2 : (r.y1 + r.y2) / 2)
          );
        }, 0) / total;
      const delta = snap(
        Math.sign(target - centre[axis]) *
          Math.min(Math.abs(target - centre[axis]) / 2, search.o.corridor),
        search.o.grid,
      );
      if (!delta) continue;
      const dx = axis === 0 ? delta : 0,
        dy = axis === 1 ? delta : 0;
      search.consider(
        search.sheet.items.map((i) => {
          if (!ids.has(i._id)) return i;
          return i.NodeName === T.Wire
            ? { ...i, d_points: i.d_points.map((p) => [p[0] + dx, p[1] + dy]) }
            : translate(i, dx, dy);
        }),
      );
    }
  }
}

/** Move repeated isolated parts together: shared centreline, equal pitch and
 * the same reference order, with each part's stubs and annotations kept intact. */
function arrangeComponentPatterns(search: Search) {
  const { o } = search;
  const groups = componentPatterns(search.sheet, search.physical).map((g) =>
    g.map((c) => c.symbol._id),
  );
  for (const memberIds of groups) {
    if (!search.available()) return;
    const islands = componentIslands(search.sheet, search.physical);
    const group = memberIds.map((id) =>
      islands.find((c) => c.symbol._id === id),
    );
    if (group.some((c) => !c)) continue;
    const ids = new Set(group.flatMap((c) => [...c.ids]));
    if (search.sheet.items.some((i) => ids.has(i._id) && !movable(i, o)))
      continue;
    const axis = patternAxis(group),
      cross = 1 - axis;
    const gap = Math.max(o.annotationClearance, o.grid * 2);
    const before = [0, 1].map((a) =>
      Math.max(
        ...group.map(
          (c) => c.centre[a] - (a === 0 ? c.bounds.x1 : c.bounds.y1),
        ),
      ),
    );
    const after = [0, 1].map((a) =>
      Math.max(
        ...group.map(
          (c) => (a === 0 ? c.bounds.x2 : c.bounds.y2) - c.centre[a],
        ),
      ),
    );
    const snapshot = search.sheet.items;
    const outside = snapshot.filter((i) => !ids.has(i._id));
    const occupied = outside.flatMap((i) =>
      [
        bodyRect(i),
        ...texts(i),
        ...('d_points' in i
          ? segments(i as dsnWire).map((s) => rect(s.a, s.b))
          : []),
      ].filter(Boolean),
    );
    const anchors = [
      ...islands.filter((c) => !ids.has(c.symbol._id)).map((c) => c.bounds),
      ...symbols(search.sheet)
        .filter((s) => !ids.has(s._id))
        .map(bodyRect),
    ];
    const proposals: { dx: number; dy: number; pitch: number; rank: number }[] =
      [];
    for (const pitch of [
      patternPitch(group, axis, o),
      patternPitch(group, axis, o) + o.grid * 2,
    ]) {
      const mean = [0, 1].map(
        (a) => group.reduce((n, c) => n + c.centre[a], 0) / group.length,
      );
      const along = [
        mean[axis] - ((group.length - 1) * pitch) / 2,
        ...group.map((c, i) => c.centre[axis] - i * pitch),
      ];
      const across = [mean[cross], ...group.map((c) => c.centre[cross])];
      for (const r of anchors) {
        const low = [r.x1, r.y1],
          high = [r.x2, r.y2];
        along.push(
          low[axis] - gap - after[axis] - (group.length - 1) * pitch,
          high[axis] + gap + before[axis],
        );
        across.push(
          low[cross] - gap - after[cross],
          high[cross] + gap + before[cross],
          (low[cross] + high[cross]) / 2,
        );
      }
      const unique = (ns: number[]) => [
        ...new Set(ns.map((n) => snap(n, o.grid))),
      ];
      for (const start of unique(along))
        for (const line of unique(across)) {
          let rank = 0,
            valid = true;
          for (const [i, c] of group.entries()) {
            const target =
              axis === 0
                ? [start + i * pitch, line]
                : [line, start + i * pitch];
            const dx = target[0] - c.centre[0],
              dy = target[1] - c.centre[1];
            const b = {
              x1: c.bounds.x1 + dx,
              x2: c.bounds.x2 + dx,
              y1: c.bounds.y1 + dy,
              y2: c.bounds.y2 + dy,
            };
            const page = search.sheet.details.page_size;
            if (
              b.x1 < 0 ||
              b.y1 < 0 ||
              (page?.[0] > 0 && b.x2 > page[0]) ||
              (page?.[1] > 0 && b.y2 > page[1]) ||
              occupied.some((r) => intersects(expand(b, gap), r))
            ) {
              valid = false;
              break;
            }
            rank += Math.abs(dx) + Math.abs(dy);
          }
          if (valid) proposals.push({ dx: start, dy: line, pitch, rank });
        }
    }
    proposals.sort((a, b) => a.rank - b.rank || a.dx - b.dx || a.dy - b.dy);
    for (const candidate of proposals.slice(0, 64)) {
      if (!search.available()) return;
      const moved = new Map<number, DocItem>();
      group.forEach((c, index) => {
        const target =
          axis === 0
            ? [candidate.dx + index * candidate.pitch, candidate.dy]
            : [candidate.dy, candidate.dx + index * candidate.pitch];
        const dx = target[0] - c.centre[0],
          dy = target[1] - c.centre[1];
        // All proposals use the same snapshot, including any asymmetric labels.
        for (const item of snapshot)
          if (c.ids.has(item._id))
            moved.set(
              item._id,
              item.NodeName === T.Wire
                ? {
                    ...item,
                    d_points: item.d_points.map((p) => [p[0] + dx, p[1] + dy]),
                  }
                : translate(item, dx, dy),
            );
      });
      search.replace(moved);
    }
  }
}

function alignLabelGroups(search: Search) {
  const { o } = search;
  for (const originalGroup of labelGroups(search.sheet)) {
    if (!search.available()) return;
    if (
      originalGroup.some(
        (c) =>
          !movable(c.label, o) || c.path.members.some((w) => !movable(w, o)),
      )
    )
      continue;
    const width = Math.max(
      ...originalGroup.map((c) => {
        const r = texts(c.label)[0];
        return r.x2 - r.x1;
      }),
    );
    const height = Math.max(
      ...originalGroup.map((c) => {
        const r = texts(c.label)[0];
        return c.label.point[1] - r.y1;
      }),
    );
    const pitch = Math.ceil((height + o.clearance) / o.grid) * o.grid;
    const sign = originalGroup[0].pin.direction[0];
    const pinX =
      sign < 0
        ? Math.min(...originalGroup.map((c) => c.pin.p[0]))
        : Math.max(...originalGroup.map((c) => c.pin.p[0]));
    const middle =
      (originalGroup[0].pin.p[1] +
        originalGroup[originalGroup.length - 1].pin.p[1]) /
      2;
    for (const fan of [false, true])
      for (const extra of [0, o.grid * 2, o.corridor]) {
        if (!search.available()) return;
        const bendSpace = fan
          ? o.pinLead +
            Math.floor((originalGroup.length - 1) / 2) * o.grid +
            o.clearance
          : 0;
        const x =
          sign < 0
            ? pinX - bendSpace - o.clearance - width - extra
            : pinX + bendSpace + o.clearance + extra;
        const freeX = sign < 0 ? x - o.clearance : x + width + o.clearance;
        const replacements = new Map<number, DocItem>();
        for (const [i, c] of originalGroup.entries()) {
          const y = fan
            ? snap(
                middle + (i - (originalGroup.length - 1) / 2) * pitch,
                o.grid,
              )
            : c.pin.p[1];
          const track =
            c.pin.p[0] +
            sign *
              (o.pinLead + Math.min(i, originalGroup.length - 1 - i) * o.grid);
          const route = clean(
            fan
              ? [c.pin.p, [track, c.pin.p[1]], [track, y], [freeX, y]]
              : [c.pin.p, [freeX, y]],
          );
          const oriented = same(c.path.points[0], c.pin.p)
            ? route
            : [...route].reverse();
          const changes = pathReplacements(c.path, oriented);
          if (!changes) break;
          for (const [id, item] of changes) replacements.set(id, item);
          const r = texts(c.label)[0];
          replacements.set(
            c.label._id,
            refresh({
              ...c.label,
              point: [c.label.point[0] + x - r.x1, y],
            }) as dsnLabel,
          );
        }
        if (
          replacements.size ===
          originalGroup.reduce((n, c) => n + c.path.members.length + 1, 0)
        )
          search.replace(replacements);
      }
  }
}

function placeNetLabels(search: Search) {
  if (!search.available()) return;
  const { o } = search;
  alignLabelGroups(search);
  if (!search.available()) return;
  // A successfully formed column is a joint constraint, not a collection of
  // independent labels that can subsequently drift towards different centres.
  const aligned = new Set<number>();
  const spans = wireSpans(search.sheet);
  for (const g of labelGroups(search.sheet)) {
    const xs = g.map((c) => texts(c.label)[0].x1);
    if (
      Math.max(...xs) - Math.min(...xs) < 1e-6 &&
      g.every((c) =>
        spans
          .filter((s) => c.path.members.some((w) => s.members.includes(w._id)))
          .some((s) => labelFits(c.label, s.a, s.b, o.clearance)),
      )
    )
      g.forEach((c) => aligned.add(c.label._id));
  }
  for (const id of search.sheet.items
    .filter(
      (i) =>
        i.NodeName === T.Label &&
        i.which === 0 &&
        movable(i, o) &&
        !aligned.has(i._id),
    )
    .map((i) => i._id)) {
    if (!search.available()) return;
    const label = search.sheet.items.find((i) => i._id === id) as dsnLabel;
    const attached = wires(search.sheet).filter((w) =>
      wireContains(w, label.point),
    );
    if (attached.length !== 1) continue; // Ambiguous crossing: keep its exact anchor.
    const wire = attached[0];
    const crowded = search.analysis.diagnostics.some(
      (d) =>
        d.itemIds.includes(id) && ['text-wire', 'text-body'].includes(d.code),
    );
    const options: { wire: dsnWire; label: dsnLabel; terminal?: DocItem }[] =
      [];
    for (const span of spans.filter((s) => s.members.includes(wire._id)))
      for (const placed of labelPositions(label, span.a, span.b, o))
        options.push({ wire, label: placed });
    for (const s of segments(wire)) {
      const horizontal = s.a[1] === s.b[1],
        axis = horizontal ? 0 : 1;
      if (!horizontal && s.a[0] !== s.b[0]) continue;
      const length = labelSpanLength(label, horizontal, o.clearance);
      const low = Math.min(s.a[axis], s.b[axis]),
        high = Math.max(s.a[axis], s.b[axis]);
      for (const placed of labelPositions(label, s.a, s.b, o))
        options.push({ wire, label: placed });
      // Extend only a free stub or an isolated movable power terminal.
      if ((high - low < length || crowded) && movable(wire, o))
        for (const endIndex of [0, wire.d_points.length - 1]) {
          const end = wire.d_points[endIndex];
          if (!same(end, s.a) && !same(end, s.b)) continue;
          const occupants = search.sheet.items.filter((i) => {
            if (i._id === id || i._id === wire._id) return false;
            if (i.NodeName === T.Symbol)
              return pins(i).some((p) => same(p.p, end));
            if (i.NodeName === T.Wire) return wireContains(i, end);
            return 'point' in i && same(i.point, end);
          });
          // A movable ground at the far end can extend with its straight lead.
          // Do this before obstacle routing can manufacture a dogleg for text.
          const terminal =
            occupants.length === 1 &&
            occupants[0].NodeName === T.Power &&
            movable(occupants[0], o) &&
            (!o.phases || o.phases.includes('placement'))
              ? occupants[0]
              : undefined;
          if (occupants.length && !terminal) continue;
          const other = same(end, s.a) ? s.b : s.a;
          const sign = Math.sign(end[axis] - other[axis]) || 1;
          const required = Math.max(
            0,
            Math.ceil((length - (high - low)) / o.grid) * o.grid,
          );
          for (const extra of crowded
            ? [0, o.grid * 2, o.corridor, o.corridor * 2]
            : [0]) {
            if (!required && !extra) continue;
            const next = point(end);
            next[axis] += sign * (required + extra);
            const points = wire.d_points.map(point);
            points[endIndex] = next;
            const extended = { ...wire, d_points: points };
            for (const placed of labelPositions(label, next, other, o))
              options.push({
                wire: extended,
                label: placed,
                terminal: terminal
                  ? translate(terminal, next[0] - end[0], next[1] - end[1])
                  : undefined,
              });
          }
        }
    }
    for (const candidate of options) {
      if (!search.available()) return;
      search.replace(
        new Map<number, DocItem>([
          [id, candidate.label],
          [wire._id, candidate.wire],
          ...(candidate.terminal
            ? [
                [candidate.terminal._id, candidate.terminal] as [
                  number,
                  DocItem,
                ],
              ]
            : []),
        ]),
      );
    }
  }
}

function textCandidates(s: dsnSymbol, o: LayoutSettings): dsnSymbol[] {
  const visible = (s.textData || [])
    .map((t, i) => (t ? i : -1))
    .filter((i) => i >= 0);
  if (!visible.length) return [];
  visible.sort(
    (a, b) =>
      (s.text[a].description === 'Ref' ? -1 : 0) -
        (s.text[b].description === 'Ref' ? -1 : 0) || a - b,
  );
  const rs = visible.map((i) => textsForIndex(s, i)),
    w = Math.max(...rs.map((r) => r.x2 - r.x1));
  const heights = rs.map(
    (r) => Math.max(r.y2 - r.y1, s.font_size) + o.clearance,
  );
  const h = heights.reduce((a, b) => a + b, 0) - o.clearance,
    b = symbolArtwork(s).body,
    cx = (b.x1 + b.x2) / 2,
    cy = (b.y1 + b.y2) / 2;
  const result: dsnSymbol[] = [];
  // A small visual margin beyond collision clearance keeps labels readable.
  for (const gap of [o.clearance + 2, o.clearance * 2 + 2]) {
    const positions = [
      [cx - w / 2, b.y1 - gap - h],
      [cx - w / 2, b.y2 + gap],
      [b.x2 + gap, cy - h / 2],
      [b.x1 - gap - w, cy - h / 2],
      [b.x1 - w - gap, b.y1 - h - gap],
      [b.x2 + gap, b.y1 - h - gap],
      [b.x1 - w - gap, b.y2 + gap],
      [b.x2 + gap, b.y2 + gap],
      [b.x1, b.y1 - gap - h],
      [b.x2 - w, b.y1 - gap - h],
      [b.x1, b.y2 + gap],
      [b.x2 - w, b.y2 + gap],
    ];
    for (const [x, y] of positions) {
      let top = y;
      const text = s.text.map((t) => ({ ...t, position: [...t.position] }));
      visible.forEach((index, j) => {
        const r = rs[j];
        const width = r.x2 - r.x1;
        // Align each line towards the body, not all fields to the longest line's
        // left edge. This keeps both C1 and 100n visibly attached to the plates.
        const lineX =
          x + w <= b.x1 ? x + w - width : x >= b.x2 ? x : x + (w - width) / 2;
        text[index].position = [
          text[index].position[0] + lineX - r.x1,
          text[index].position[1] + top - r.y1,
        ];
        top += heights[j];
      });
      result.push(refresh({ ...s, text }) as dsnSymbol);
    }
  }
  return result;
}
function textsForIndex(s: dsnSymbol, index: number) {
  return texts({
    ...s,
    textData: s.textData.map((d, i) => (i === index ? d : null)),
  })[0];
}

function placeSymbolText(search: Search) {
  // Text-only edits on a large fixed symbol are allowed by disturbance, but not
  // by an explicit lock or exclusion from the selected region.
  const o = search.o;
  for (const id of symbols(search.sheet)
    .filter(
      (s) =>
        (!o.selectedIds || o.selectedIds.includes(s._id)) &&
        !o.lockedIds?.includes(s._id),
    )
    .map((s) => s._id)) {
    if (!search.available()) return;
    const s = symbols(search.sheet).find((s) => s._id === id);
    for (const candidate of textCandidates(s, o)) {
      if (!search.available()) return;
      search.replace(new Map([[id, candidate]]), true);
    }
  }
}

function annealText(search: Search) {
  const { o } = search;
  if (!o.annealingSteps) return;
  let state = (o.seed || 1) >>> 0;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const eligible = symbols(search.sheet).filter(
    (s) => movable(s, o) && texts(s).length,
  );
  if (!eligible.length) return;
  let current = search.sheet,
    currentAnalysis = search.analysis;
  const energy = (a: LayoutAnalysis) =>
    a.metrics.textCollisions * 10000 + a.metrics.labelDistance;
  for (let step = 0; step < o.annealingSteps && search.available(); step++) {
    const id = eligible[Math.floor(random() * eligible.length)]._id;
    const s = symbols(current).find((s) => s._id === id),
      cs = textCandidates(s, o);
    const candidate = cs[Math.floor(random() * cs.length)];
    const proposed = {
      ...current,
      items: current.items.map((i) => (i._id === id ? candidate : i)),
    };
    const a = analysePrepared(proposed, o);
    const temperature =
      1000 * Math.pow(0.001, step / Math.max(1, o.annealingSteps - 1));
    if (
      energy(a) < energy(currentAnalysis) ||
      random() < Math.exp((energy(currentAnalysis) - energy(a)) / temperature)
    ) {
      current = proposed;
      currentAnalysis = a;
      search.consider(current.items, true); // Keep best feasible state, never return the hot state.
    } else search.evaluations++;
  }
}

function junctions(search: Search) {
  const sheet = search.sheet,
    ws = wires(sheet),
    ports = symbols(sheet).flatMap(pins);
  const candidates = ws.flatMap((w) => w.d_points);
  const misplaced = new Set(
    search.analysis.diagnostics
      .filter((d) => d.code === 'junction-position')
      .flatMap((d) => d.itemIds),
  );
  for (const j of sheet.items)
    if (
      j.NodeName === T.Junction &&
      misplaced.has(j._id) &&
      movable(j, search.o)
    ) {
      const nearby = candidates
        .filter(
          (p) => !same(p, j.point) && distance(p, j.point) <= search.o.pinLead,
        )
        .sort((a, b) => distance(a, j.point) - distance(b, j.point));
      for (const p of nearby) {
        if (!search.available()) return;
        if (
          search.sheet.items.some(
            (i) =>
              i.NodeName === T.Junction && i._id !== j._id && same(i.point, p),
          )
        )
          continue;
        // Only a nearby, already-connected branch can pass both partition gates.
        if (search.replace(new Map([[j._id, { ...j, point: point(p) }]])))
          break;
      }
    }
  let nextId = Math.max(0, ...sheet.items.map((i) => i._id)) + 1;
  for (const p of candidates) {
    if (!search.available()) return;
    if (
      search.sheet.items.some(
        (i) => i.NodeName === T.Junction && same(i.point, p),
      )
    )
      continue;
    const incident = ws.filter((w) => wireContains(w, p));
    if (incident.some((w) => !movable(w, search.o))) continue;
    const rays = new Set<string>();
    for (const s of incident
      .flatMap(segments)
      .filter((s) => onSegment(p, s.a, s.b)))
      for (const q of [s.a, s.b])
        if (!same(p, q))
          rays.add(`${Math.sign(q[0] - p[0])},${Math.sign(q[1] - p[1])}`);
    const atPin = ports.filter((port) => same(port.p, p));
    const portCount = sheet.items.filter(
      (i) => i.NodeName === T.Power && same(i.point, p),
    ).length;
    if (rays.size + atPin.length + portCount < 3) continue;
    const j: DocItem = { NodeName: T.Junction, _id: nextId++, point: point(p) };
    const proposed = { ...search.sheet, items: [...search.sheet.items, j] };
    // Pure visual addition: no quality-score improvement is required, but both
    // partitions must remain identical. Never guess connectivity at a T crossing.
    search.evaluations++;
    if (
      connectivitySignature(proposed) === search.electrical &&
      connectivitySignature(proposed, true) === search.physical
    ) {
      search.sheet = proposed;
      search.analysis = analysePrepared(proposed, search.o);
    }
  }
}

/** Pure proposal API. Caller owns undo, preview, persistence and ID allocation. */
export function optimiseLayout(
  sheet: dsnSheet,
  options: LayoutOptions = {},
): LayoutResult {
  const o = settings(sheet, options),
    initial = o.prepared ? { ...sheet, items: sheet.items.map(item => ({ ...item })) } : cloneSheet(sheet),
    search = new Search(initial, o),
    before = search.analysis;
  const enabled = (phase: NonNullable<LayoutOptions['phases']>[number]) =>
    !o.phases || o.phases.includes(phase);
  let converged = false;
  for (let pass = 0; pass < o.maxPasses && search.available(); pass++) {
    const start = search.sheet;
    const progressStart = search.phaseProgress.length;
    if (o.balancePhases) {
      const allStages: [LayoutPhase, () => void][] = [
        ['symbol-text', () => placeSymbolText(search)],
        ['net-labels', () => placeNetLabels(search)],
        ['routing', () => {
          simplifyBacktracks(search);
          repairObstructions(search, enabled('placement'));
          routeBundles(search);
          routeWires(search);
          simplifyBacktracks(search);
        }],
        ['placement', () => {
          arrangeComponentPatterns(search);
          placeSymbols(search);
          attractConnectedClusters(search);
        }],
        ['compaction', () => compact(search)],
        ['junctions', () => junctions(search)],
      ];
      const stages = allStages.filter(([phase]) => enabled(phase));
      // Spend scarce runtime on actual obstructions before cosmetic label distance.
      const metrics = search.analysis.metrics;
      const priority = (phase: LayoutPhase) => {
        if (phase === 'routing' && (metrics.wireBodyCollisions || metrics.pinExitViolations || metrics.diagonalSegments)) return 0;
        if (phase === 'placement' && metrics.bodyCollisions) return 1;
        if (phase === 'symbol-text' && metrics.textCollisions) return 2;
        if (phase === 'net-labels' && metrics.labelOverhangs) return 3;
        return 4 + ['symbol-text', 'net-labels', 'routing', 'placement', 'compaction', 'junctions'].indexOf(phase);
      };
      stages.sort((a, b) => priority(a[0]) - priority(b[0]));
      for (let i = 0; i < stages.length; i++) {
        const remaining = Math.max(0, o.maxEvaluations - search.evaluations);
        search.runPhase(stages[i][0], pass + 1, Math.floor(remaining / (stages.length - i)), stages.length - i, stages[i][1]);
      }
    } else {
      // Match the editor's sequence without dividing the search into phase quotas.
      // Still report progress and honor the caller's total/resource allowance.
      const run = (phase: LayoutPhase, action: () => void) => {
        if (enabled(phase) && search.available())
          search.runPhase(phase, pass + 1, o.maxEvaluations - search.evaluations, 1, action);
      };
      run('routing', () => simplifyBacktracks(search));
      // Give text room first so compaction can reserve its actual footprint.
      run('symbol-text', () => placeSymbolText(search));
      run('net-labels', () => placeNetLabels(search));
      run('routing', () => repairObstructions(search, enabled('placement')));
      run('routing', () => routeBundles(search));
      run('placement', () => {
        arrangeComponentPatterns(search);
        placeSymbols(search);
        attractConnectedClusters(search);
      });
      run('routing', () => routeWires(search));
      run('compaction', () => compact(search));
      run('symbol-text', () => placeSymbolText(search));
      run('net-labels', () => placeNetLabels(search));
      run('placement', () => arrangeComponentPatterns(search));
      // Placement and label clearance can add elbows late in the last pass.
      run('routing', () => simplifyBacktracks(search));
    }
    if (search.sheet === start && !search.phaseProgress.slice(progressStart).some(p => p.budgetExhausted)) {
      converged = true;
      break;
    }
  }
  if (!converged && search.stopped === 'converged')
    search.stopped = 'pass-limit';
  if (enabled('symbol-text')) annealText(search);
  if (!o.balancePhases && enabled('junctions')) junctions(search);
  const originals = new Map(sheet.items.map((i) => [i._id, i]));
  const wireOrigins: Record<number, number> = {};
  let splitWires = false;
  let nextId = Math.max(0, ...search.sheet.items.map((i) => i._id)) + 1;
  search.sheet = {
    ...search.sheet,
    items: search.sheet.items.flatMap((i) => {
      if (
        i.NodeName !== T.Wire ||
        i.d_points.length <= 2 ||
        (originals.has(i._id) && !changed(originals.get(i._id), i))
      )
        return [i];
      splitWires = true;
      return segments(i).map((s, index) => {
        const id = index ? nextId++ : i._id;
        if (index) wireOrigins[id] = i._id;
        return {
          ...i,
          _id: id,
          d_points: [point(s.a), point(s.b)],
          _magnetic: null,
        } as dsnWire;
      });
    }),
  };
  // Search already analysed the accepted geometry. Only segment splitting changes
  // its representation and requires another full analysis.
  const after = splitWires
    ? analysePrepared(search.sheet, { ...o, physicalPartition: undefined })
    : search.analysis;
  const changes = search.sheet.items.flatMap((i) =>
    !originals.has(i._id) || changed(originals.get(i._id), i)
      ? [{ id: i._id, before: originals.get(i._id), after: i }]
      : [],
  );
  // Return original objects for untouched items; no cache churn or incidental edits.
  const changedIds = new Set(changes.map((c) => c.id));
  const result = {
    ...sheet,
    items: search.sheet.items.map((i) =>
      changedIds.has(i._id) ? i : originals.get(i._id),
    ),
  };
  const preserved =
    connectivitySignature(result, false, wireOrigins) === search.electrical &&
    connectivitySignature(result, true, wireOrigins) === search.physical;
  if (!preserved)
    throw new Error('Layout invariant failed: connectivity changed');
  return {
    sheet: result,
    wireOrigins,
    changes,
    before,
    after,
    evaluations: search.evaluations,
    phaseProgress: search.phaseProgress,
    stopped: search.stopped,
    connectivityPreserved: preserved,
  };
}
