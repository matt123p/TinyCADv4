import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { librarySqlite } from '../lib/library-from-sql.mjs';
import { recordDrawing } from '../lib/layout-proof-page.mjs';

async function bundledDefinitions(api, library, names) {
  const SQL = await librarySqlite();
  const db = new SQL.Database(await readFile(new URL(
    `../../bundled-libraries/${library}/${library}.tclib`, import.meta.url,
  )));
  try {
    const donors = new Map();
    for (const name of names) {
      const [row] = db.exec(
        'SELECT n.SymbolID, s.Data FROM Name n JOIN Symbol s USING (SymbolID) WHERE n.Name = ?',
        [name],
      )[0]?.values ?? [];
      assert.ok(row, name);
      const [symbolId, data] = row;
      const donor = await recordDrawing(api, {
        xml: new TextDecoder().decode(data),
        device: { id: `bundled:${library}:${symbolId}`, name },
        width: 0, height: 0, autoReference: true,
      });
      donors.set(name, donor.sheets[0].items[0]._symbol);
    }
    return donors;
  } finally {
    db.close();
  }
}

export async function useBundledPassives(api, drawing, names, { ledCathodeFirst = false } = {}) {
  const donors = await bundledDefinitions(api, 'spice', new Set(Object.values(names)));
  const terminals = (symbol) => new Map(new api.updateSymbol(symbol).active_points()
    .map(([x, y, pin]) => [pin.number, { point: [x, y], pin }]));
  for (const sheet of drawing.sheets) {
    const definitions = new Map();
    for (const [index, original] of sheet.items.entries()) {
      if (original.NodeName !== 'symbol') continue;
      const reference = original.text.find(({ description }) => description === 'Ref')?.value;
      const name = names[reference];
      if (!name) continue;
      const before = terminals(original);
      assert.equal(before.size, 2, reference);
      const id = original._symbol.id;
      let definition = definitions.get(id);
      if (!definition) {
        definition = structuredClone(donors.get(name));
        definition.id = id;
        const outline = definition.outlines[0];
        for (const active of outline.active_points) {
          const { pin } = active;
          // The classroom LED footprint numbers the cathode as 1.
          if (name === 'LED (red)' && ledCathodeFirst)
            pin.number = pin.number === '1' ? '2' : '1';
          const originalPin = before.get(pin.number).pin;
          pin.pinId = originalPin.pinId;
          pin.name = originalPin.name;
          pin.elec = originalPin.elec;
        }
        definitions.set(id, definition);
        sheet.symbols[id] = definition;
      }
      const first = before.get('1').point;
      const last = before.get('2').point;
      const horizontal = first[1] === last[1];
      assert.ok(horizontal || first[0] === last[0], reference);
      const axis = horizontal ? 0 : 1;
      const span = last[axis] - first[axis];
      const candidate = { ...original, _symbol: definition, point: [0, 0],
        rotation: horizontal ? 1 : 0, scale_x: 1, scale_y: 1, _active_points: null };
      const start = terminals(candidate);
      const bundledSpan = start.get('2').point[axis] - start.get('1').point[axis];
      assert.ok(bundledSpan, reference);
      if (Math.sign(span) !== Math.sign(bundledSpan)) candidate.rotation += 2;
      candidate.scale_y = Math.abs(span / bundledSpan);
      candidate._active_points = null;
      const origin = terminals(candidate).get('1').point;
      candidate.point = first.map((coordinate, i) => coordinate - origin[i]);
      candidate._active_points = null;
      const placed = terminals(candidate);
      for (const [number, { point }] of before)
        assert.deepEqual(placed.get(number).point, point, reference + '.' + number);
      candidate.text = original.text.map((field) => ({
        ...field,
        position: field.position.map((coordinate, i) => coordinate + original.point[i] - candidate.point[i]),
      }));
      sheet.items[index] = new api.updateSymbol(candidate).post_construction();
    }
  }
}

// These bundled illustrations lack the three additional LM741 PDIP pins and
// the quad NAND's package-wide pin numbering. Keep the verified pin records
// and fit the library's body to the existing stem ends.
export async function useBundledPackageBody(api, drawing, { library, name, reference, transform }) {
  const [donor] = (await bundledDefinitions(api, library, [name])).values();
  const body = donor.outlines[0].items.filter((item) => item.NodeName === 'line');
  assert.equal(body.length, 1, name);
  for (const sheet of drawing.sheets) {
    const definitions = new Set(sheet.items.filter((item) => item.NodeName === 'symbol' &&
      item.text.some(({ description, value }) => description === 'Ref' && value === reference))
      .map((item) => item._symbol));
    for (const definition of definitions) {
      const [outline] = definition.outlines;
      outline.items = [
        ...outline.items.filter((item) => item.NodeName !== 'line'),
        ...body.map((item) => ({
          ...item,
          d_points: item.d_points.map(([x, y, ...flags]) => [...transform(x, y), ...flags]),
        })),
      ];
      definition.uid = donor.uid + ':' + definition.name.value;
    }
  }
}
