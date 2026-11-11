import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import {
  runNgspice,
  ngspiceAvailable,
  ngspiceBackend,
} from './ngspice-runner.mjs';
import os from 'node:os';
import path from 'node:path';
import { buildTeachingLibraries } from '../build-teaching-libraries.mjs';
import { runRegression } from './run-regression.mjs';
import { librarySqlite } from '../lib/library-from-sql.mjs';
import { circuitSaveLine } from '../../shared/spiceSaveVectors.js';
let result;
test.before(async () => {
  result = await buildTeachingLibraries();
});
test('every selected canonical component and style variant has embedded simulation information', async () => {
  assert.equal(new Set(result.entries.map((e) => e.canonicalId)).size, 96);
  assert.equal(result.entries.length, 116);
  for (const name of result.library.names)
    assert.ok(
      name.Attributes.some((a) => a.AttName === '$$SPICE' && a.AttValue.trim()),
      name.Name,
    );
  const manifest = JSON.parse(
    await readFile(
      new URL(
        '../../docs/symbol-libraries/library-manifest.json',
        import.meta.url,
      ),
    ),
  );
  const SQL = await librarySqlite();
  for (const course of manifest.libraries) {
    const db = new SQL.Database(
      await readFile(
        new URL(
          `../../bundled-libraries/${course.library_id}/${course.library_id}.tclib`,
          import.meta.url,
        ),
      ),
    );
    try {
      const provenance = JSON.parse(
        db.exec('SELECT Value FROM TinyCADBundleInfo')[0].values[0][0],
      );
      assert.deepEqual(
        new Set(provenance.entries.map((e) => e.id)),
        new Set(
          course.symbols
            .filter((s) => s.asset_kind !== 'editor_primitive')
            .map((s) => s.id),
        ),
      );
      assert.equal(
        db.exec('SELECT count(*) FROM Name')[0].values[0][0],
        db.exec(
          "SELECT count(*) FROM Attribute WHERE AttName='$$SPICE' AND length(AttValue)>0",
        )[0].values[0][0],
      );
    } finally {
      db.close();
    }
  }
});
test('all 116 modelled drawings place, rotate, export hidden power pins and retain model text through save/load', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tinycad-teaching-'));
  try {
    const file = path.join(directory, 'exports.json');
    const library = {
      ...result.library,
      symbols: result.library.symbols.map((s) => ({
        ...s,
        SymbolID: s.SymbolId,
      })),
    };
    await runRegression(
      `import {checkSpicePlacement} from './scripts/tests/spice-placement.mjs';checkSpicePlacement(${JSON.stringify(
        library,
      )},${JSON.stringify(file)});`,
    );
    const exports = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(exports.length, 116);
    assert.ok(
      exports.every(
        (e) =>
          !/<pin |<attr |NO_MODEL/.test(e.deck || e.spice || JSON.stringify(e)),
      ),
    );
    if (ngspiceAvailable) {
      const master = JSON.parse(
        await readFile(
          new URL(
            '../../docs/symbol-libraries/all-symbols.json',
            import.meta.url,
          ),
        ),
      );
      for (const [i, e] of exports.entries()) {
        const entry = result.entries[i],
          r = master.symbols.find((r) => r.id === entry.canonicalId),
          h = ['Vanchor anchor 0 1', 'Ranchor anchor 0 1g'];
        for (const p of r.pins) {
          const number = entry.provenance.logicalToSymbolPins[p.logical_number],
            node = 'n' + number;
          if (
            p.electrical_type === 'input' ||
            p.electrical_type === 'power_input' ||
            ['COMMON', 'REF'].includes(p.name)
          ) {
            const value = ['VSS', 'GND', 'COMMON', 'REF'].includes(p.name)
              ? 0
              : p.name === 'V-'
              ? -5
              : [
                  'VCC',
                  'VDD',
                  'V+',
                  'VREF',
                  'SET_N',
                  'RESET_N',
                  'ENABLE',
                  'UP_DOWN',
                ].includes(p.name)
              ? 5
              : 0;
            h.push(`V_${number} ${node} 0 ${value}`);
          } else h.push(`R_${number} ${node} 0 1meg`);
        }
        const file = path.join(directory, 'qualify.cir');
        const body = e.netlist + '\n' + h.join('\n');
        const saved = circuitSaveLine(
          body,
          e.pins.map((p) => 'n' + p.number),
        );
        await writeFile(
          file,
          e.name + '\n' + body + '\n' + saved + '\n.op\n.end\n',
        );
        const run = runNgspice(file);
        const log = run.log;
        assert.equal(run.status, 0, e.name + ': ' + log.slice(-1800));
        assert.ok(
          !/error:|fatal:|singular/i.test(log),
          e.name + ': ' + log.slice(-1800),
        );
      }
      console.log(
        `${ngspiceBackend} accepted all 116 decks exported by the editor.`,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
