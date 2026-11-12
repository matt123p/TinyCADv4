import { dsnSheet } from '../model/dsnDrawing';
import { DocItemTypes as T, dsnLabel } from '../model/dsnItem';
import { wirePaths } from './bundles';
import { pins, same, symbols, texts, wireContains, wires } from './geometry';

/** Free labelled pin stubs on the same component face form a readable column.
 * Group by topology, not current bend shape, so rerouting cannot evade alignment. */
export function labelGroups(sheet: dsnSheet) {
  const ports = symbols(sheet).flatMap(pins),
    ws = wires(sheet);
  const groups = new Map<
    string,
    Array<{
      path: ReturnType<typeof wirePaths>[number];
      label: dsnLabel;
      pin: (typeof ports)[number];
    }>
  >();
  for (const path of wirePaths(sheet)) {
    let ps = path.points;
    let pin = ports.find((p) => same(p.p, ps[0]));
    if (!pin) {
      ps = [...ps].reverse();
      pin = ports.find((p) => same(p.p, ps[0]));
    }
    if (
      !pin ||
      !pin.direction[0] ||
      ports.some((p) => same(p.p, ps[ps.length - 1]))
    )
      continue;
    const ids = new Set(path.members.map((w) => w._id));
    if (ws.some((w) => !ids.has(w._id) && ps.some((p) => wireContains(w, p))))
      continue;
    const attached = sheet.items.filter(
      (i) =>
        i.NodeName !== T.Symbol &&
        i.NodeName !== T.Wire &&
        'point' in i &&
        path.members.some((w) => wireContains(w, i.point)),
    );
    if (
      attached.length !== 1 ||
      attached[0].NodeName !== T.Label ||
      attached[0].which !== 0 ||
      attached[0].rotation !== 0
    )
      continue;
    const label = attached[0],
      key = pin.id + ':' + pin.direction[0];
    const group = groups.get(key) || [];
    group.push({ path, label, pin });
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => g.sort((a, b) => a.pin.p[1] - b.pin.p[1]));
}

export function labelAlignment(sheet: dsnSheet) {
  return labelGroups(sheet).reduce((cost, g) => {
    const xs = g.map((c) => texts(c.label)[0].x1);
    return cost + (Math.max(...xs) - Math.min(...xs)) * g.length;
  }, 0);
}
