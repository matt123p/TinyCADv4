import { dsnSheet } from '../../src/model/dsnDrawing';
import { updateView } from '../../src/manipulators/updateView';
import { get_global_id } from '../../src/util/global_id';
import {
  analyseLayout,
  connectivitySignature,
  optimiseLayout,
  sameConnectivity,
} from '../../src/layout';

/** Compare drawn wire coverage independently of native segment subdivisions. */
export function wireCoverage(sheet: dsnSheet) {
  const lines = new Map<string, number[][]>();
  for (const w of sheet.items)
    if (w.NodeName === 'wire') {
      if (w.d_points.length !== 2)
        throw Error('Teaching wires must be native two-point segments');
      const [a, b] = w.d_points.map((p) => p.map((n) => Number(n.toFixed(8))));
      if (a[0] !== b[0] && a[1] !== b[1])
        throw Error('Non-orthogonal teaching wire');
      const axis = a[1] === b[1] ? 0 : 1;
      const key = axis + ':' + a[1 - axis];
      const spans = lines.get(key) || [];
      spans.push([Math.min(a[axis], b[axis]), Math.max(a[axis], b[axis])]);
      lines.set(key, spans);
    }
  return JSON.stringify(
    [...lines]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, spans]) => {
        const merged: number[][] = [];
        for (const span of spans.sort((a, b) => a[0] - b[0])) {
          const last = merged[merged.length - 1];
          if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
          else merged.push([...span]);
        }
        return [key.split(':').map(Number), merged];
      }),
  );
}

function sameGeometry(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number')
    return Math.abs(a - b) < 1e-7;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => sameGeometry(v, b[i]));
  return a === b;
}

function terminals(sheet: dsnSheet, physical: boolean) {
  return JSON.stringify(
    (JSON.parse(connectivitySignature(sheet, physical)) as string[])
      .map((g) =>
        g
          .split('|')
          .filter((t) => !t.startsWith('wire:'))
          .join('|'),
      )
      .filter(Boolean)
      .sort(),
  );
}

/** Generated endpoint-on-wire branches are intentional, just as when drawing
 * wires in the editor. Use its native split/merge/junction rules before layout.
 * This is not an inference or connectivity repair for arbitrary user drawings. */
export function prepareTeachingWiring(sheet: dsnSheet) {
  const coverage = wireCoverage(sheet);
  // Layout allocates IDs locally; reserve them before invoking editor routines.
  const max = Math.max(0, ...sheet.items.map((i) => i._id));
  while (get_global_id() <= max) {
    /* advance the editor allocator */
  }
  const prepared = new updateView().tidy_wires(sheet);
  if (wireCoverage(prepared) !== coverage)
    throw Error('Wire cleanup changed drawn coverage');
  return prepared;
}

export function layoutTeachingSheet(sheet: dsnSheet) {
  const prepared = prepareTeachingWiring(sheet);
  const result = optimiseLayout(prepared, {
    disturbance: 'medium',
    maxEvaluations: 2500,
    nativeWireJunctions: true,
  });
  const final = prepareTeachingWiring(result.sheet);
  for (const physical of [false, true])
    if (terminals(result.sheet, physical) !== terminals(final, physical))
      throw Error('Post-layout junction cleanup changed terminal connectivity');
  return {
    sheet: final,
    report: {
      before: result.before,
      after: analyseLayout(final),
      stopped: result.stopped,
      evaluations: result.evaluations,
      connectivityPreserved: result.connectivityPreserved,
      wires: final.items.filter((i) => i.NodeName === 'wire').length,
      junctions: final.items.filter((i) => i.NodeName === 'junction').length,
    },
  };
}

export function validateTeachingRoundTrip(
  expected: dsnSheet,
  loaded: dsnSheet,
) {
  const aligned = {
    ...loaded,
    items: loaded.items.map((i, index) => ({
      ...i,
      _id: expected.items[index]?._id,
    })),
  };
  if (expected.items.length !== loaded.items.length)
    throw Error('Saved teaching item count changed');
  if (
    !sameGeometry(
      JSON.parse(wireCoverage(expected)),
      JSON.parse(wireCoverage(loaded)),
    )
  ) {
    const a = JSON.parse(wireCoverage(expected)),
      b = JSON.parse(wireCoverage(loaded));
    const difference = a.findIndex(
      (r, i) => JSON.stringify(r) !== JSON.stringify(b[i]),
    );
    throw Error(
      'Saved teaching wire coverage changed: ' +
        JSON.stringify([a[difference], b[difference]]),
    );
  }
  if (!sameConnectivity(expected, aligned))
    throw Error('Saved teaching connectivity changed');
  const dots = (s: dsnSheet) =>
    JSON.stringify(
      s.items
        .filter((i) => i.NodeName === 'junction')
        .map((i) => i.point)
        .sort(),
    );
  if (dots(expected) !== dots(loaded))
    throw Error('Saved teaching junction positions changed');
}
