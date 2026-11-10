import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  readMysqlRows,
  readComponentDump,
  componentInventory,
} from '../lib/mysql-dump.mjs';
import {
  librarySqlite,
  buildLibraryModel,
  serializeLibrary,
  transformSymbol,
} from '../lib/library-from-sql.mjs';
import { runRegression } from './run-regression.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const literals = [
  ...readMysqlRows(
    String.raw`-- ignored ; comment
INSERT INTO unrelated (secret) VALUES (unsupported_function());
INSERT INTO symbol (SymbolID,Data) VALUES (1,'semi; comma, apostrophe\' doubled'' quote\nline\\path'),(2,NULL);
/* comment ; */ INSERT INTO symbol (SymbolID,Data) VALUES (3,0x4142);`,
    new Set(['symbol']),
  ),
];
assert.equal(literals.length, 3);
assert.equal(
  literals[0].row.Data,
  "semi; comma, apostrophe' doubled' quote\nline\\path",
);
assert.equal(literals[1].row.Data, null);
assert.deepEqual([...literals[2].row.Data], [65, 66]);
assert.throws(
  () => [
    ...readMysqlRows(
      'INSERT INTO symbol (Data) VALUES (LOAD_FILE(123));',
      new Set(['symbol']),
    ),
  ],
  /Unsupported/,
);
assert.throws(
  () => [
    ...readMysqlRows(
      "INSERT INTO symbol (Data) VALUES ('unterminated);",
      new Set(['symbol']),
    ),
  ],
  /Unterminated/,
);

const xml =
  '<TinyCADSheets><TinyCAD><PIN pos="0,0" number="1" part="0">A</PIN><PIN pos="10,0" number="2" part="0">B</PIN></TinyCAD></TinyCADSheets>';
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const fixture = readComponentDump(`
INSERT INTO aspnetusers (Id,UserName,Email,LoginKey) VALUES ('owner','fixture','private@example.invalid','SECRET');
INSERT INTO symbol (SymbolID,Data,ppp,DefRotate,Owner_Id) VALUES (1,${quote(
  xml,
)},1,0,'owner');
INSERT INTO symbolname (NameID,SymbolID,Hidden,Name,Description,AuthorId) VALUES (1,1,0,'R','Fixture','owner');
INSERT INTO symbolattribute (AttributeID,NameID,Name,Value,ShowAtt) VALUES (1,1,'Reference','R?',0),(2,1,'$$SPICE','R$(refnum) %(1) %(2) $(Value)',2);`);
assert.equal(componentInventory(fixture, 'fixture').length, 1);
assert.ok(!JSON.stringify(componentInventory(fixture)).includes('SECRET'));
const recipe = {
  version: 1,
  id: 'test',
  name: 'Test',
  author: 'fixture',
  requireSpice: true,
  components: [
    {
      id: 'r',
      source: { nameId: 1 },
      folder: 'Passive/Resistors',
      attributes: { Value: { value: '1k', show: 0 } },
    },
  ],
};
const built = buildLibraryModel(fixture, recipe, 'fixture-hash');
assert.deepEqual(built.library.symbolFolders, ['Passive', 'Passive/Resistors']);
assert.ok(!JSON.stringify(built).includes('private@example.invalid'));
assert.ok(!JSON.stringify(built).includes('SECRET'));
assert.deepEqual(
  await serializeLibrary(built.library, built.provenance),
  await serializeLibrary(built.library, built.provenance),
);
assert.throws(
  () =>
    buildLibraryModel(
      fixture,
      { ...recipe, components: [{ ...recipe.components[0], attributes: {} }] },
      'hash',
    ),
  /Unknown SPICE attribute/,
);
assert.throws(
  () =>
    transformSymbol(xml, {
      id: 'bad',
      pins: [{ matchNumber: '2', number: '1' }],
    }),
  /Duplicate/,
);
assert.throws(
  () =>
    transformSymbol(xml, { id: 'bad', pins: [{ at: [99, 99], number: '3' }] }),
  /must match one/,
);

const SQL = await librarySqlite();
const db = new SQL.Database(
  new Uint8Array(
    await readFile(path.join(root, 'bundled-libraries/spice/spice.tclib')),
  ),
);
const rows = (sql) => {
  const r = db.exec(sql)[0];
  return r
    ? r.values.map((v) =>
        Object.fromEntries(r.columns.map((c, i) => [c, v[i]])),
      )
    : [];
};
assert.equal(rows('PRAGMA integrity_check')[0].integrity_check, 'ok');
const lib = {
  names: rows('select * from Name').map((n) => ({
    ...n,
    Attributes: rows(
      'select AttName,AttValue,ShowAtt from Attribute where NameID=' + n.NameID,
    ),
  })),
  symbols: rows('select * from Symbol').map((s) => ({
    ...s,
    Data: new TextDecoder().decode(s.Data),
  })),
};
const selection = JSON.parse(
  await readFile(path.join(root, 'library-recipes/spice.json'), 'utf8'),
);
assert.equal(lib.names.length, 33);
assert.deepEqual(
  lib.names.map((n) => n.Name),
  selection.components.map((c) => c.name),
);
assert.equal(rows('select * from TinyCADSymbolFolderEntry').length, 33);
const provenance = JSON.parse(
  await readFile(
    path.join(root, 'bundled-libraries/spice/spice.provenance.json'),
    'utf8',
  ),
);
assert.deepEqual(
  JSON.parse(rows('select Value from TinyCADBundleInfo')[0].Value),
  provenance,
);
assert.ok(
  provenance.entries
    .slice(0, 22)
    .every((e) => e.source.author === 'onetransistor'),
);
assert.ok(provenance.entries.some((e) => e.spiceFrom?.author === 'aryajur'));
db.close();
const directory = await mkdtemp(path.join(tmpdir(), 'tinycad-spice-tests-'));
const exportFile = path.join(directory, 'exports.json');
try {
  await runRegression(`
import { checkSpicePlacement } from './scripts/tests/spice-placement.mjs';
checkSpicePlacement(${JSON.stringify(lib)}, ${JSON.stringify(exportFile)});
`);

  if (process.env.NGSPICE_BIN) {
    const exports = JSON.parse(await readFile(exportFile, 'utf8'));
    for (const [index, entry] of exports.entries()) {
      let harness = 'V1 drive 0 DC 1 AC 1\nRfeed drive n1 1k\n';
      for (const pin of entry.pins)
        if (pin.number !== '1')
          harness += `Rload_${pin.number} n${pin.number} 0 1k\n`;
      if (!entry.pins.some((p) => p.number === '1'))
        harness += 'Rdummy n1 0 1k\n';
      let analysis = '.save all\n.op\n.print op v(n1)\n';
      if (entry.name === '741 op-amp') {
        harness =
          'VCC n7 0 DC 15\nVEE n4 0 DC -15\nVIN n3 0 DC 1 PULSE(0 10 1u 1n 1n 100u 200u)\nRfeedback n6 n2 1u\nRload n6 0 10k\n';
        analysis =
          '.save all\n.op\n.print op v(n6)\n.tran 100n 30u\n.measure tran output_at_11u FIND v(n6) AT=11u\n.print tran v(n6)\n';
      }
      const file = path.join(directory, index + '.cir');
      await writeFile(
        file,
        entry.name +
          '\n' +
          entry.netlist.replace(/^\s*\.end\s*$/gim, '') +
          '\n' +
          harness +
          analysis +
          '.end\n',
      );
      const result = spawnSync(process.env.NGSPICE_BIN, ['-b', file], {
        encoding: 'utf8',
        timeout: 20000,
      });
      const output = (result.stdout || '') + (result.stderr || '');
      assert.equal(result.status, 0, entry.name + ': ' + output.slice(-3000));
      assert.ok(
        !/error:|unknown|fatal/i.test(output),
        entry.name + ': ' + output.slice(-3000),
      );
      if (entry.name === '741 op-amp') {
        const measured = Number(
          output.match(/output_at_11u\s*=\s*([\deE+.-]+)/)?.[1],
        );
        assert.ok(
          measured > 4.8 && measured < 5.2,
          '741 follower slew rate: ' + measured,
        );
      }
    }
    console.log(
      'ngspice simulation passed for all 33 entries, including 741 follower transient behavior.',
    );
  }
  console.log(
    'SQL parsing, recipe guards, deterministic generation, provenance, folder coverage, and SPICE regressions passed.',
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
