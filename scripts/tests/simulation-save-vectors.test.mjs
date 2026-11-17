import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { librarySqlite } from '../lib/library-from-sql.mjs';
import { runRegression } from './run-regression.mjs';
import { runNgspice, ngspiceBackend } from './ngspice-runner.mjs';
import { circuitSaveLine } from '../../shared/spiceSaveVectors.js';

test('save policy retains probe/device currents, logger output and explicitly selected internal signals', () => {
  const body = `V1 in 0 5
V_PSU1_sense internal supply 0
V_DMM1_sense in meter 0
B_LOG1_record _LOG1_record 0 V={v(in)}
.subckt private a b
Vbias bias b 1
.subckt nested c d
Linner c d 1m
.ends nested
.ends private
L1 supply out 1m`;
  const line = circuitSaveLine(
    body,
    ['in', 'supply', 'out', '0', '_N_999'],
    ['_U1_q2', 'v(xu1.s)', 'v1#branch', 'time', 'frequency'],
    ['@r1[i]'],
  );
  for (const signal of [
    'v(in)',
    'v(supply)',
    'v(out)',
    'i(V1)',
    'i(V_PSU1_sense)',
    'i(V_DMM1_sense)',
    'i(L1)',
    'v(_LOG1_record)',
    'v(_U1_q2)',
    'v(xu1.s)',
    '@r1[i]',
  ])
    assert.ok(line.includes(signal), signal);
  assert.ok(!/\ball\b|Vbias|Linner|_N_999|v\(time\)|v\(frequency\)/.test(line));
});

test(
  'a real FPGA deck runs inside the native vector limit while retaining its public outputs',
  { skip: !ngspiceBackend.startsWith('bundled') },
  async () => {
    const SQL = await librarySqlite(),
      db = new SQL.Database(
        await readFile(
          new URL(
            '../../bundled-libraries/functional/functional.tclib',
            import.meta.url,
          ),
        ),
      );
    let name, xml;
    try {
      const row = db.exec(
        "SELECT * FROM Name WHERE Name='Generic FPGA interface'",
      )[0];
      name = Object.fromEntries(
        row.columns.map((c, i) => [c, row.values[0][i]]),
      );
      const attributes = db.exec(
        `SELECT AttName,AttValue,ShowAtt FROM Attribute WHERE NameID=${name.NameID}`,
      )[0];
      name.Attributes = attributes.values.map((row) =>
        Object.fromEntries(attributes.columns.map((c, i) => [c, row[i]])),
      );
      xml = new TextDecoder().decode(
        db.exec(`SELECT Data FROM Symbol WHERE SymbolID=${name.SymbolID}`)[0]
          .values[0][0],
      );
    } finally {
      db.close();
    }
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'tinycad-fpga-save-'),
    );
    try {
      const decks = path.join(directory, 'decks.json');
      await runRegression(String.raw`
      import fs from 'node:fs';import assert from 'node:assert/strict';
      import {ioXML,blank} from './src/io/ioXml';import {XMLBuilder} from './src/util/xmlbuilder';
      import {updateView} from './src/manipulators/updateView';import {updateSymbol} from './src/manipulators/updateSymbol';
      import {buildDeck} from './src/simulation/deck';import {defaultSetup} from './src/simulation/contracts';
      globalThis.document={createElement:()=>({getContext:()=>({measureText:t=>({width:t.length*4,actualBoundingBoxDescent:2})})})};
      const xml=new XMLBuilder();xml.fromText(${JSON.stringify(
        xml,
      )});const doc=new ioXML().from_dsn(xml),drawing=blank();
      const placed=new updateView().handleSelectLibrarySymbol({},drawing.sheets[0],${JSON.stringify(
        name,
      )},doc.sheets.map(s=>s.items),[100,100]);
      const symbol=placed.sheet.items.at(-1);symbol.text.find(t=>t.description==='Ref').value='U1';
      const pins=new updateSymbol(symbol).active_points().map(p=>p[2]),nets={},labels={},harness=[];
      for(const p of pins){const id=p.number;labels[p.name==='GND'?'0':p.name]=id;nets[id]=[{reference:'U1',pin:id}];
        if(['VDD','GND','CLOCK','RESET','IO0','IO1'].includes(p.name))harness.push('V_'+id+' '+(p.name==='GND'?'0':p.name)+' 0 '+(['VDD','IO0'].includes(p.name)?5:0));
        else harness.push('R_'+id+' '+p.name+' 0 1meg');}
      // The ground port already maps to node 0; it needs no voltage source.
      const stimulus={...symbol,text:[{description:'Ref',value:'VFIXTURE'},{description:'$$SPICE',value:harness.filter(s=>!/^V_2 /.test(s)).join('\n')}]};
      const net={symbols:[['test',symbol],['test',stimulus]],nets,labels,nodes:{},eprops:{}};
      const setup=defaultSetup();setup.analysis.kind='op';
      const ordinary=buildDeck(net,setup);setup.signals=['_U1_q2'];const explicit=buildDeck(net,setup);
      assert.ok(!ordinary.includes('.save all'));
      fs.writeFileSync(${JSON.stringify(
        decks,
      )},JSON.stringify({ordinary,explicit}));
    `);
      const { ordinary, explicit } = JSON.parse(await readFile(decks, 'utf8'));
      for (const [kind, deck] of Object.entries({ ordinary, explicit })) {
        const file = path.join(directory, kind + '.cir');
        await writeFile(file, deck);
        const result = runNgspice(file);
        assert.equal(result.status, 0, result.log);
        const names = result.events.find((e) => e.type === 'vectors').names;
        assert.ok(names.length < 128);
        assert.ok(names.includes('io2'));
        assert.equal(names.includes('_u1_q2'), kind === 'explicit');
        const row = result.events
          .filter((e) => e.type === 'data')
          .flatMap((e) => e.rows)
          .at(-1);
        assert.ok(row[names.indexOf('io2')] > 4.9);
        assert.ok(
          names.includes('v_1#branch'),
          'Supply current remains available.',
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
