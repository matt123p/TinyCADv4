import { NetlistGenerator } from '../io/netlists/netlistGenerator';
import { makeNetForSheet } from '../web-worker/netlist';
import { dsnSheet } from '../model/dsnDrawing';
import { Coordinate, DocItemTypes as T } from '../model/dsnItem';
import { pins, symbols, wires } from './geometry';

/** Endpoint and terminal contacts become junctions when the editor tidies
 * wires. Include them in candidate validation for generated native drawings. */
export function withNativeJunctions(sheet: dsnSheet): dsnSheet {
  const points = [
    ...wires(sheet).flatMap((w) => w.d_points),
    ...symbols(sheet)
      .flatMap(pins)
      .map((p) => p.p),
    ...sheet.items.filter((i) => i.NodeName === T.Power).map((i) => i.point),
  ];
  const unique = new Map(points.map((p) => [p.join(','), p]));
  let id = Math.max(0, ...sheet.items.map((i) => i._id));
  return {
    ...sheet,
    items: [
      ...sheet.items,
      ...[...unique.values()].map((p) => ({
        NodeName: T.Junction as const,
        _id: ++id,
        point: p,
      })),
    ],
  };
}

/** Stable electrical partition, independent of coordinates and generated net IDs.
 * Physical mode prevents a named net from hiding a newly broken connection.
 * Junctions are deliberately omitted: adding a redundant visual dot is allowed.
 */
export function connectivitySignature(
  sheet: dsnSheet,
  physical = false,
  wireOrigins: Record<number, number> = {},
): string {
  const builder = new NetlistGenerator();
  builder.sheet = sheet.name;
  const input = {
    ...sheet,
    items: sheet.items.map((i) => {
      const item: any = { ...i, hints: [] };
      if (i.NodeName === T.Symbol) {
        item._active_points = null;
        if (physical) {
          // Hidden power pins are logical connections, not physical geometry.
          item._symbol = {
            ...i._symbol,
            outlines: i._symbol.outlines.map((o) => ({
              ...o,
              active_points: o.active_points.map((p) => ({
                ...p,
                pin: { ...p.pin, name: `hidden:${i._id}:${p.pin.number}` },
              })),
            })),
          };
        }
      }
      if (physical && (i.NodeName === T.Label || i.NodeName === T.Power))
        item.text = `port:${i._id}`;
      return item;
    }),
  };
  // Native stored wires are segments. Search routes may be polylines; flatten
  // before invoking the editor's label/junction hit tests as well as its saver.
  input.items = input.items.flatMap((i) =>
    i.NodeName === T.Wire
      ? i.d_points.slice(1).map((p: Coordinate, index: number) => ({
          ...i,
          d_points: [i.d_points[index], p],
        }))
      : [i],
  );
  makeNetForSheet(input, builder);
  const groups = Object.values(builder.nets)
    .map((nodes) =>
      [
        ...new Set(
          nodes.flatMap((n) => {
            if (n.symbol)
              return [`pin:${n.symbol._id}:${n.symbol.part}:${n.pin}`];
            if (n.parent?.NodeName === T.Junction) return [];
            if (n.parent && '_id' in n.parent)
              return [
                `${n.parent.NodeName}:${
                  n.parent.NodeName === T.Wire
                    ? wireOrigins[n.parent._id] ?? n.parent._id
                    : n.parent._id
                }`,
              ];
            return [];
          }),
        ),
      ].sort(),
    )
    .filter((g) => g.length)
    .map((g) => g.join('|'))
    .sort();
  return JSON.stringify(groups);
}
export function sameConnectivity(
  a: dsnSheet,
  b: dsnSheet,
  wireOrigins: Record<number, number> = {},
) {
  return (
    connectivitySignature(a) === connectivitySignature(b, false, wireOrigins) &&
    connectivitySignature(a, true) ===
      connectivitySignature(b, true, wireOrigins)
  );
}

/** Named nets count as connections too. Divide fanout weight so a common supply
 * rail cannot overwhelm the proximity preference for local signal connections. */
export function symbolConnections(sheet: dsnSheet) {
  const pairs = new Map<string, { a: number; b: number; weight: number }>();
  for (const group of JSON.parse(connectivitySignature(sheet)) as string[]) {
    const ids = [
      ...new Set(
        group
          .split('|')
          .filter((t) => t.startsWith('pin:'))
          .map((t) => Number(t.split(':')[1])),
      ),
    ];
    for (let i = 0; i < ids.length; i++)
      for (let j = 0; j < i; j++) {
        const [a, b] = [ids[i], ids[j]].sort((a, b) => a - b),
          key = a + ':' + b;
        const p = pairs.get(key) || { a, b, weight: 0 };
        p.weight += 1 / Math.max(1, ids.length - 1);
        pairs.set(key, p);
      }
  }
  return [...pairs.values()];
}
