import { dsnSheet } from '../model/dsnDrawing';
import { DocItemTypes as T, dsnLabel } from '../model/dsnItem';
import { LayoutAnalysis, LayoutOptions, LayoutSettings, Rect } from './types';
import {
  bodyRect,
  symbolArtwork,
  cloneSheet,
  distance,
  expand,
  intersects,
  onSegment,
  pins,
  rect,
  same,
  segments,
  settings,
  symbols,
  texts,
  union,
  wireContains,
  wires,
} from './geometry';
import { bundleDisorder, wireBundles, wirePaths, wireSpans } from './bundles';
import { symbolConnections } from './connectivity';
import { componentDisorder } from './patterns';
import { labelPositionCost } from './labels';
import { labelAlignment, labelGroups } from './labelGroups';

export function labelFits(
  label: dsnLabel,
  a: number[],
  b: number[],
  clearance: number,
) {
  if (label.which !== 0) return true; // Shaped port flags deliberately have a different layout contract.
  const r = texts(label)[0];
  if (!r) return true;
  if (!onSegment(label.point, a, b)) return false;
  if (a[0] !== b[0] && a[1] !== b[1]) return false;
  if (label.rotation % 2 !== (a[1] === b[1] ? 0 : 1)) return false;
  return a[1] === b[1]
    ? r.x1 >= Math.min(a[0], b[0]) + clearance - 1e-7 &&
        r.x2 <= Math.max(a[0], b[0]) - clearance
    : r.y1 >= Math.min(a[1], b[1]) + clearance - 1e-7 &&
        r.y2 <= Math.max(a[1], b[1]) - clearance;
}

/** Route ranking needs only wire clearance, crossings and pin exits. Full candidate
 * acceptance still computes every layout metric and checks both net partitions. */
function routeGeometry(sheet: dsnSheet) {
  const segs = wires(sheet).flatMap(segments);
  return {
    segs,
    wireRects: segs.map(s => expand(rect(s.a, s.b), 0.01)),
    bodies: sheet.items.flatMap(item => {
      const r = bodyRect(item);
      return r ? [{ id: item._id, r, inner: expand(r, -0.05), type: item.NodeName }] : [];
    }),
    ports: symbols(sheet).flatMap(pins),
    junctions: sheet.items.filter(item => item.NodeName === T.Junction),
  };
}

function routingAnalysis(
  { segs, wireRects, bodies, ports, junctions }: ReturnType<typeof routeGeometry>,
  pinLead: number,
  collectDiagnostics: boolean,
) {
  const m = { wireLength: 0, diagonalSegments: 0, wireBodyCollisions: 0,
    overlaps: 0, crossings: 0, pinExitViolations: 0 };
  const diagnostics: LayoutAnalysis['diagnostics'] = [];
  const issue = (code: string, itemIds: number[], message: string) => {
    if (collectDiagnostics) diagnostics.push({ code, itemIds, message });
  };
  for (let index = 0; index < segs.length; index++) {
    const s = segs[index];
    m.wireLength += distance(s.a, s.b);
    if (s.a[0] !== s.b[0] && s.a[1] !== s.b[1]) {
      m.diagonalSegments++;
      issue('diagonal', [s.id], 'Wire is not orthogonal.');
    }
    const r = wireRects[index];
    for (const b of bodies) {
      if (b.type === T.NoConnect) continue;
      // Shrink pin envelopes slightly: outward leads may touch their perimeter.
      if (intersects(r, b.inner)) {
        m.wireBodyCollisions++;
        issue(
          'wire-body',
          [s.id, b.id],
          'Wire enters a symbol or fixed object envelope.',
        );
      }
    }
  }
  for (let i = 0; i < segs.length; i++)
    for (let j = 0; j < i; j++) {
      const a = segs[i],
        b = segs[j];
      const ah = a.a[1] === a.b[1],
        bh = b.a[1] === b.b[1];
      if (ah === bh) {
        const axis = ah ? 0 : 1;
        if (
          a.a[1 - axis] === b.a[1 - axis] &&
          Math.max(
            Math.min(a.a[axis], a.b[axis]),
            Math.min(b.a[axis], b.b[axis]),
          ) <
            Math.min(
              Math.max(a.a[axis], a.b[axis]),
              Math.max(b.a[axis], b.b[axis]),
            )
        ) {
          m.overlaps++;
          issue(
            'wire-overlap',
            [a.id, b.id],
            'Collinear wire segments overlap.',
          );
        }
      } else {
        const h = ah ? a : b,
          v = ah ? b : a,
          p = [v.a[0], h.a[1]];
        if (
          onSegment(p, a.a, a.b) &&
          onSegment(p, b.a, b.b) &&
          ![a.a, a.b].some((x) => same(x, p)) &&
          ![b.a, b.b].some((x) => same(x, p)) &&
          !junctions.some((j) => same(j.point, p))
        ) {
          m.crossings++;
          issue('crossing', [a.id, b.id], 'Unjoined wire crossing.');
        }
      }
    }
  for (const p of ports) {
    const incident = segs.filter((s) => same(s.a, p.p) || same(s.b, p.p));
    if (!incident.length || !p.length) continue;
    const good = incident.every((s) => {
      const q = same(s.a, p.p) ? s.b : s.a,
        dx = q[0] - p.p[0],
        dy = q[1] - p.p[1];
      return (
        dx * p.direction[1] === dy * p.direction[0] &&
        dx * p.direction[0] + dy * p.direction[1] >= pinLead
      );
    });
    if (!good) {
      m.pinExitViolations++;
      issue(
        'pin-exit',
        [p.id, ...incident.map((s) => s.id)],
        `Pin ${p.number} needs a straight outward lead before a bend or branch.`,
      );
    }
  }
  return { metrics: m, diagnostics };
}

export function analyseRouteMetrics(sheet: dsnSheet, pinLead: number) {
  return routingAnalysis(routeGeometry(sheet), pinLead, false).metrics;
}

export function analysePrepared(
  sheet: dsnSheet,
  o: LayoutSettings,
): LayoutAnalysis {
  const m = {
    bodyCollisions: 0,
    wireBodyCollisions: 0,
    crossings: 0,
    overlaps: 0,
    diagonalSegments: 0,
    pinExitViolations: 0,
    textCollisions: 0,
    annotationCrowding: 0,
    componentDisorder: 0,
    labelOverhangs: 0,
    netLabelPosition: 0,
    labelAlignment: 0,
    junctionIssues: 0,
    bundleDisorder: 0,
    connectedDistance: 0,
    logicalProximity: 0,
    inlineImbalance: 0,
    wireLength: 0,
    bends: 0,
    area: 0,
    labelDistance: 0,
  };
  const diagnostics: LayoutAnalysis['diagnostics'] = [];
  const issue = (code: string, itemIds: number[], message: string) =>
    diagnostics.push({ code, itemIds, message });
  const ws = wires(sheet),
    ss = symbols(sheet),
    ports = ss.flatMap(pins);
  const paths = wirePaths(sheet, ports);
  const bundles = wireBundles(sheet, paths, ports);
  const groups = labelGroups(sheet, paths, ports);
  m.labelAlignment = labelAlignment(sheet, groups);
  const segs = ws.flatMap(segments);
  const wireRects = segs.map(s => expand(rect(s.a, s.b), 0.01));
  const bodies = sheet.items.flatMap((i) => {
    const r = bodyRect(i);
    return r ? [{ id: i._id, r, inner: expand(r, -0.05), type: i.NodeName }] : [];
  });
  const ts = sheet.items.flatMap((i) =>
    texts(i).map((r) => ({
      id: i._id,
      r,
      type: i.NodeName,
      fontSize: 'font_size' in i ? i.font_size : o.grid * 2,
    })),
  );
  const textRects = ts.map(t => expand(t.r, o.clearance / 2));
  const itemsById = new Map(sheet.items.map(item => [item._id, item]));
  const labelGroupIds = new Map<number, number>();
  groups.forEach((g, index) =>
    g.forEach((c) => labelGroupIds.set(c.label._id, index)),
  );
  for (let i = 0; i < ts.length; i++)
    for (let j = 0; j < i; j++) {
      const a = ts[i],
        b = ts[j];
      if (a.id === b.id || a.type === T.Text || b.type === T.Text) continue;
      const dx = Math.max(0, a.r.x1 - b.r.x2, b.r.x1 - a.r.x2),
        dy = Math.max(0, a.r.y1 - b.r.y2, b.r.y1 - a.r.y2);
      const related =
        labelGroupIds.has(a.id) &&
        labelGroupIds.get(a.id) === labelGroupIds.get(b.id);
      const margin = related
        ? o.clearance
        : Math.max(o.annotationClearance, a.fontSize, b.fontSize);
      const missing = Math.max(0, margin - Math.hypot(dx, dy));
      m.annotationCrowding += missing;
      if (missing > 0)
        issue(
          'annotation-crowding',
          [a.id, b.id],
          'Unrelated annotations need more visual separation.',
        );
    }
  m.componentDisorder = componentDisorder(sheet, o);
  const junctions = sheet.items.filter((i) => i.NodeName === T.Junction);
  const artwork = new Map(ss.map((s) => [s._id, symbolArtwork(s)]));
  for (let i = 0; i < bodies.length; i++)
    for (let j = 0; j < i; j++) {
      const a = bodies[i],
        b = bodies[j];
      if (intersects(a.r, b.r)) {
        m.bodyCollisions++;
        issue('body-overlap', [a.id, b.id], 'Objects overlap.');
      }
    }
  const routeAnalysis = routingAnalysis({ segs, wireRects, bodies, ports, junctions }, o.pinLead, true);
  Object.assign(m, routeAnalysis.metrics);
  diagnostics.push(...routeAnalysis.diagnostics);
  for (const path of paths) {
    for (let i = 1; i < path.points.length - 1; i++) {
      const [a, b, c] = path.points.slice(i - 1, i + 2);
      if ((a[0] === b[0]) !== (b[0] === c[0])) m.bends++;
    }
    const labelled = sheet.items.some(
      (i) =>
        i.NodeName === T.Label &&
        path.members.some((w) => wireContains(w, i.point)),
    );
    if (!labelled)
      for (const p of [path.points[0], path.points[path.points.length - 1]]) {
        const attached =
          ports.some((port) => same(port.p, p)) ||
          sheet.items.some(
            (i) =>
              [T.Power, T.NoConnect, T.Junction].includes(i.NodeName) &&
              'point' in i &&
              same(i.point, p),
          );
        const incident = ws.filter((w) => wireContains(w, p));
        if (!attached && incident.length === 1)
          issue(
            'dangling-wire',
            [incident[0]._id],
            'Wire endpoint is unconnected; layout will not infer a missing connection.',
          );
      }
  }
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    for (let j = 0; j < i; j++)
      if (intersects(textRects[i], ts[j].r)) {
        m.textCollisions++;
        issue('text-overlap', [t.id, ts[j].id], 'Visible text overlaps.');
      }
    for (const b of bodies) {
      if (
        (t.type === T.Text && t.id === b.id) ||
        (t.type === T.Power && t.id === b.id)
      )
        continue;
      const obstacles =
        t.type === T.Symbol && t.id === b.id
          ? artwork.get(b.id).obstacles
          : [b.r];
      if (obstacles.some((r) => intersects(textRects[i], r))) {
        m.textCollisions++;
        issue(
          'text-body',
          [t.id, b.id],
          'Text is too close to a body or pin envelope.',
        );
      }
    }
    const item = itemsById.get(t.id);
    for (let index = 0; index < segs.length; index++) {
      const s = segs[index];
      // Plain net label baselines intentionally sit on their supporting wire.
      if (item.NodeName === T.Label && onSegment(item.point, s.a, s.b))
        continue;
      if (
        intersects(textRects[i], wireRects[index])
      ) {
        m.textCollisions++;
        issue('text-wire', [t.id, s.id], 'Text is too close to a wire.');
      }
    }
  }
  for (const s of ss) {
    const r = artwork.get(s._id).body;
    for (const t of texts(s))
      m.labelDistance +=
        Math.max(0, r.x1 - t.x2, t.x1 - r.x2) +
        Math.max(0, r.y1 - t.y2, t.y1 - r.y2);
    const ps = pins(s);
    if (
      ps.length === 2 &&
      ps[0].direction[0] === -ps[1].direction[0] &&
      ps[0].direction[1] === -ps[1].direction[1]
    ) {
      const legs = ps.map((p) =>
        segs.filter((w) => same(w.a, p.p) || same(w.b, p.p)),
      );
      if (legs.every((l) => l.length === 1)) {
        const lengths = legs.map((l, i) =>
          distance(ps[i].p, same(l[0].a, ps[i].p) ? l[0].b : l[0].a),
        );
        m.inlineImbalance += Math.abs(lengths[0] - lengths[1]);
      }
    }
  }
  const spans = wireSpans(sheet, paths);
  for (const l of sheet.items.filter(
    (i): i is dsnLabel => i.NodeName === T.Label && i.which === 0,
  )) {
    const fitting = spans.filter((s) => labelFits(l, s.a, s.b, o.clearance));
    if (fitting.length)
      m.netLabelPosition += Math.min(
        ...fitting.map((s) => labelPositionCost(l, s.a, s.b, o)),
      );
    if (!fitting.length) {
      m.labelOverhangs++;
      issue(
        'label-overhang',
        [l._id],
        'Plain net label does not fit wholly along a supporting wire.',
      );
    }
  }
  for (const j of junctions) {
    const rays = new Set<string>();
    for (const s of segs.filter((s) => onSegment(j.point, s.a, s.b)))
      for (const p of [s.a, s.b])
        if (!same(p, j.point))
          rays.add(
            `${Math.sign(p[0] - j.point[0])},${Math.sign(p[1] - j.point[1])}`,
          );
    const pinCount = ports.filter((p) => same(p.p, j.point)).length;
    const portCount = sheet.items.filter(
      (i) =>
        (i.NodeName === T.Power || i.NodeName === T.NoConnect) &&
        same(i.point, j.point),
    ).length;
    if (rays.size + pinCount + portCount < 3) {
      m.junctionIssues++;
      issue(
        'junction-position',
        [j._id],
        'Junction is not at a branch; moving it could change the intended circuit.',
      );
    }
  }
  const bounds = union([
    ...ss.map(bodyRect),
    ...segs.map((s) => rect(s.a, s.b)),
    ...ts
      .filter((t) => t.type === T.Symbol || t.type === T.Label)
      .map((t) => t.r),
  ]);
  m.area = (bounds.x2 - bounds.x1) * (bounds.y2 - bounds.y1);
  m.bundleDisorder = bundleDisorder(sheet, o.grid * 2, bundles);
  for (const g of bundles)
    for (const w of g)
      m.connectedDistance += distance(
        w.points[0],
        w.points[w.points.length - 1],
      );
  // Single connections contribute too; bundles receive no artificial attraction multiplier.
  const grouped = new Set(
    bundles.flatMap((g) =>
      g.flatMap((w) => w.members.map((m) => m._id)),
    ),
  );
  for (const w of ws.filter((w) => !grouped.has(w._id)))
    m.connectedDistance += distance(
      w.d_points[0],
      w.d_points[w.d_points.length - 1],
    );
  const centres = new Map(
    ss.map((s) => {
      const r = bodyRect(s);
      return [s._id, [(r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2]];
    }),
  );
  for (const pair of o.symbolConnections ?? symbolConnections(sheet))
    if (centres.has(pair.a) && centres.has(pair.b))
      m.logicalProximity +=
        pair.weight * distance(centres.get(pair.a), centres.get(pair.b));
  return { metrics: m, diagnostics };
}

export function analyseLayout(sheet: dsnSheet, options: LayoutOptions = {}) {
  return analysePrepared(cloneSheet(sheet), settings(sheet, options));
}
