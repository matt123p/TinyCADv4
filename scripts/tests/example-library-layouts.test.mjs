import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { layoutRuntime } from '../lib/layout-runtime.mjs';
import { recordDrawing } from '../lib/layout-proof-page.mjs';
import { librarySqlite } from '../lib/library-from-sql.mjs';
import {
  parseExampleCatalog,
  exampleResourcePaths,
} from '../../shared/bundledExamples.js';

const expected = {
  'embedded-climate-station': [
    ['U1:J1-1', 'ENV1:JP2-1', 'DISP1:I2C-1'],
    ['U1:J1-14', 'ENV1:JP2-3', 'ENV1:JP2-5', 'DISP1:I2C-2'],
    ['U1:J3-3', 'ENV1:JP2-4', 'DISP1:I2C-3'],
    ['U1:J3-6', 'ENV1:JP2-6', 'DISP1:I2C-4'],
  ],
  'solar-battery-home': [
    ['PV1:PV_DC', 'PVISO1:PV_IN'],
    ['PVISO1:PV_OUT', 'INV1:PV_DC'],
    ['BAT1:BATT_DC', 'BISO1:BATT_IN'],
    ['BISO1:BATT_OUT', 'INV1:BATT_DC'],
    ['INV1:HOME_AC', 'ACISO1:AC_IN'],
    ['ACISO1:AC_OUT', 'CU1:SOLAR_AC'],
    ['GRID1:GRID_AC', 'METER1:GRID_AC'],
    ['METER1:HOME_AC', 'CU1:AC_IN'],
    ['CU1:HOME', 'HOME1:HOME_AC'],
  ],
  'podcast-studio': [
    ['MIC1:1', 'MIX1:1'],
    ['MIC2:1', 'MIX1:2'],
    ['MIX1:5', 'HP1:1'],
    ['MIX1:6', 'HP2:1'],
    ['MIX1:11', 'PC1:1'],
  ],
  'lab-measurement-bench': [
    ['PSU1:1', 'LOAD1:1', 'DMM1:1'],
    ['PSU1:2', 'LOAD1:2', 'DMM1:2'],
    ['GEN1:1', 'SCOPE1:1'],
  ],
  'motor-control-bench': [
    ['PSU1:1', 'DRV1:1'],
    ['PSU1:2', 'DRV1:2', 'DRV1:8', 'U1:J1-14', 'LIMIT1:1'],
    ['DRV1:3', 'M1:1'],
    ['DRV1:4', 'M1:2'],
    ['DRV1:5', 'U1:J3-9'],
    ['DRV1:6', 'U1:J3-8'],
    ['DRV1:7', 'U1:J1-9'],
    ['LIMIT1:2', 'U1:J1-11'],
  ],
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sorted = (nets) =>
  nets
    .map((n) => [...n].sort())
    .sort((a, b) => a.join().localeCompare(b.join()));

// Compare rendered primitive properties, ignoring resource IDs, runtime caches,
// invisible note borders and insignificant XML floating-point round trips.
function artwork(items) {
  return items.map((item) => {
    const invisible = item.NodeName === 'text' && !item.stroked && !item.filled;
    return JSON.parse(
      JSON.stringify(item, (key, value) => {
        if (
          key.startsWith('_') ||
          ['style_id', 'fill_id', 'font_id', 'textData'].includes(key)
        )
          return undefined;
        if (
          invisible &&
          [
            'line_colour',
            'line_width',
            'line_pattern',
            'fill_colour',
            'hatch',
            'rounded_rect',
          ].includes(key)
        )
          return undefined;
        return typeof value === 'number'
          ? Math.round(value * 1e6) / 1e6
          : value;
      }),
    );
  });
}

test('all five new library examples retain their source artwork, exact nets and explanations', async () => {
  const api = await layoutRuntime(),
    SQL = await librarySqlite();
  const catalog = parseExampleCatalog(
    JSON.parse(await fs.readFile('bundled-examples/config.json', 'utf8')),
  );
  const entries = catalog.groups.find((g) => g.id === 'examples').examples;
  assert.equal(
    entries.length,
    7,
    'Keep AMP and the office network alongside the five new examples',
  );
  const resources = exampleResourcePaths(catalog);
  const provenance = JSON.parse(
    await fs.readFile(
      'bundled-examples/library-examples.provenance.json',
      'utf8',
    ),
  );
  assert.deepEqual(
    provenance.examples.map((e) => e.id).sort(),
    Object.keys(expected).sort(),
  );
  const libs = new Map(),
    sourceArt = new Map();
  const connections = (drawing, native = false) => {
    const generator = new api.NetlistGenerator();
    api.makeNetForDrawing(
      native
        ? { ...drawing, sheets: drawing.sheets.map(api.withNativeJunctions) }
        : drawing,
      generator,
    );
    return sorted(
      Object.values(generator.nets)
        .map((net) => [
          ...new Set(
            net
              .filter((n) => n.reference && n.pin)
              .map((n) => n.reference + ':' + n.pin),
          ),
        ])
        .filter((n) => n.length > 1),
    );
  };
  for (const proof of provenance.examples) {
    const entry = entries.find((e) => e.id === proof.id);
    assert.ok(entry, proof.id + ' is available in Open Example');
    assert.ok(resources.has(entry.descriptionPath), 'Explanation is packaged');
    const description = await fs.readFile(
      'bundled-examples/' + entry.descriptionPath,
      'utf8',
    );
    assert.match(
      description,
      /\|.*\|/,
      'Explanation contains a connection table',
    );
    assert.match(
      description,
      /Save As/,
      'Explanation describes extending and saving the example',
    );
    assert.match(description, /SPICE/, 'Physical layout scope is explicit');
    const bytes = await fs.readFile('bundled-examples/' + entry.path);
    assert.equal(
      sha(bytes),
      proof.finalSha256,
      'Deliver the exact final auto-tidy XML',
    );
    for (const ext of ['png', 'svg']) {
      const preview = await fs.readFile(
        `bundled-examples/images/${proof.id}.${ext}`,
      );
      assert.equal(
        sha(preview),
        proof.previews[ext],
        'Preview bytes match the recorded final rendering',
      );
    }
    assert.equal(proof.checks.connectivityPreserved, true);
    assert.equal(proof.checks.serializationConnectivityPreserved, true);
    assert.equal(proof.checks.serializationPhysicalConnectivityPreserved, true);
    assert.equal(proof.checks.nativeContactsPreserved, true);
    assert.ok(
      Object.keys(proof.checks.layoutQuality.remainingByCode).every((code) =>
        ['wire-body', 'crossing'].includes(code),
      ),
      'Remaining layout exceptions are limited to physical equipment envelopes and intentional crossings',
    );
    const drawing = await api.decodeDrawing(bytes);
    assert.equal(drawing.sheets.length, 1);
    const sheet = drawing.sheets[0];
    assert.deepEqual(
      sheet.details.page_size,
      proof.id === 'solar-battery-home' ? [2100, 1485] : [1485, 1050],
    );
    const symbols = sheet.items.filter((i) => i.NodeName === 'symbol');
    assert.equal(symbols.length, proof.sources.length);
    assert.equal(
      new Set(
        symbols.map((s) => s.text.find((t) => t.description === 'Ref').value),
      ).size,
      symbols.length,
    );
    assert.ok(
      sheet.items.filter((i) => i.NodeName === 'text').length >=
        symbols.length + 1,
      'Native notes explain and identify the equipment',
    );
    for (const source of proof.sources) {
      if (!libs.has(source.libraryPath))
        libs.set(
          source.libraryPath,
          await fs.readFile('bundled-libraries/' + source.libraryPath),
        );
      const library = libs.get(source.libraryPath);
      assert.equal(sha(library), source.librarySha256);
      const key = source.libraryPath + ':' + source.nameId;
      if (!sourceArt.has(key)) {
        const db = new SQL.Database(library);
        const row = db.exec(
          `SELECT n.Name,n.SymbolID,s.Data FROM Name n JOIN Symbol s ON s.SymbolID=n.SymbolID WHERE n.NameID=${Number(
            source.nameId,
          )}`,
        )[0].values[0];
        db.close();
        assert.equal(row[0], source.name);
        assert.equal(row[1], source.symbolId);
        assert.equal(sha(row[2]), source.xmlSha256);
        const d = await recordDrawing(api, {
          xml: new TextDecoder().decode(row[2]),
          device: { id: key, name: source.name },
          width: 0,
          height: 0,
          autoReference: true,
        });
        sourceArt.set(
          key,
          artwork(d.sheets[0].items[0]._symbol.outlines[0].items),
        );
      }
      const symbol = symbols.find(
        (s) =>
          s.text.find((t) => t.description === 'Ref').value ===
          source.reference,
      );
      assert.ok(symbol, source.reference);
      assert.equal(symbol.scale_x, 1);
      assert.equal(symbol.scale_y, 1);
      assert.deepEqual(
        artwork(symbol._symbol.outlines[0].items),
        sourceArt.get(key),
        source.reference +
          ' preserves source geometry, labels, socket mapping and electrical types',
      );
      for (const [x, y] of new api.updateSymbol(symbol).active_points()) {
        assert.ok(
          Number.isInteger(x / 5) && Number.isInteger(y / 5),
          'Pad remains on the fine grid',
        );
      }
      const repeated = proof.sources.find(
        (s) =>
          s.reference !== source.reference &&
          s.libraryPath === source.libraryPath &&
          s.nameId === source.nameId,
      );
      if (repeated)
        assert.equal(
          symbol._symbol.id,
          symbols.find((s) => s.text[0].value === repeated.reference)._symbol
            .id,
          'Repeated components share an embedded definition',
        );
    }
    for (const wire of sheet.items.filter((i) => i.NodeName === 'wire')) {
      for (let i = 1; i < wire.d_points.length; i++) {
        const a = wire.d_points[i - 1],
          b = wire.d_points[i];
        assert.ok(a[0] === b[0] || a[1] === b[1], 'Cables stay orthogonal');
      }
    }
    assert.deepEqual(
      connections(drawing),
      sorted(expected[proof.id]),
      proof.id + ' has only the intended connected pins',
    );
    assert.deepEqual(
      connections(drawing, true),
      sorted(expected[proof.id]),
      proof.id + ' must not short through another socket or wire endpoint',
    );
    const reopened = await api.decodeDrawing(
      await api.encodeDrawing(drawing, 'xml'),
    );
    assert.deepEqual(
      connections(reopened),
      sorted(expected[proof.id]),
      'Save/reopen preserves wiring',
    );
    assert.deepEqual(
      connections(reopened, true),
      sorted(expected[proof.id]),
      'Save/reopen and native wire cleanup preserve all intended connections',
    );
    assert.deepEqual(
      reopened.sheets[0].items
        .filter((i) => i.NodeName === 'text')
        .map((i) => i.text),
      sheet.items.filter((i) => i.NodeName === 'text').map((i) => i.text),
      'Drawing notes survive editing',
    );
  }
});
