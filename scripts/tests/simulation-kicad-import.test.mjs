import assert from 'node:assert/strict';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { zstdCompressSync } from 'node:zlib';
import { ngspiceAvailable, runNgspice } from './ngspice-runner.mjs';
import { runRegression } from './run-regression.mjs';

function embeddedFile(name, text) {
  const base64 = zstdCompressSync(Buffer.from(text)).toString('base64');
  return '(file (name "' + name + '") (type other) (data |' +
    base64.match(/.{1,76}/g).join('\n') + '|))';
}

function properties(fields) {
  return Object.entries(fields).map(([name, value]) =>
    '(property ' + JSON.stringify(name) + ' ' + JSON.stringify(value) + ')').join('\n');
}

function symbol(name, fields) {
  return '(symbol "' + name + '" ' + properties({ Reference: 'U', Value: name, ...fields }) +
    ' (symbol "' + name + '_1_1"' +
    ' (pin passive line (at -2.54 0 0) (length 2.54) (name "one") (number "1"))' +
    ' (pin passive line (at 2.54 0 180) (length 2.54) (name "two") (number "2"))))';
}

test('KiCad symbol import supplies executable Custom SPICE, preserves overrides and reports unavailable models', async () => {
  const rootModels = embeddedFile('helper.lib', '.subckt scale target input params: gain=1\nE1 target 0 input 0 {gain}\n.ends scale');
  const gainFile = embeddedFile('gain.lib', '* Vendor header\n'.repeat(30) +
    '* Model uses $ and % characters in comments\n.include "helper.lib"\n.subckt Gain out\n+ in params: factor=2\nXscale out in scale gain={factor}\n.ends Gain');
  const base = symbol('Base', {
    'Sim.Library': 'kicad-embed://gain.lib',
    'Sim.Name': 'GAIN',
    'Sim.Pins': '1=in 2=out',
    'Sim.Params': 'factor=3',
  });
  const lib = [
    '(kicad_symbol_lib (version 20251024) (generator kicad_symbol_editor)',
    '(embedded_files ' + rootModels + ')',
    '(symbol "Child" (extends "Base") (property "Value" "Child"))',
    base.slice(0, -1) + ' (embedded_files ' + gainFile + '))',
    symbol('External', { 'Sim.Library': '$' + '{SPICE_LIB_DIR}/vendor.lib', 'Sim.Name': 'VendorD', 'Sim.Pins': '1=K 2=A', 'Sim.Params': 'is=1e-14' }),
    symbol('Resistor', { 'Sim.Device': 'R', 'Sim.Params': 'r=2K0', 'Sim.Pins': '1=+ 2=-' }),
    symbol('Missing', { 'Sim.Library': 'no-model.lib', 'Sim.Name': 'D1' }),
    symbol('Invalid', { 'Sim.Library': 'bad.lib', 'Sim.Name': 'D1' }),
    symbol('Unmapped', { 'Sim.Library': 'vendor.lib', 'Sim.Name': 'VendorD', 'Sim.Pins': '5=A 2=K' }),
    symbol('BadFrame', { 'Sim.Library': 'kicad-embed://bogus.lib', 'Sim.Name': 'D1' })
      .replace(/\)$/, ' (embedded_files (file (name "bogus.lib") (type other) (data |AAAAAA==|))))'),
    ')',
  ].join('\n');
  const out = await mkdtemp(path.resolve('build/kicad-spice-'));
  const deckPath = path.join(out, 'import.cir');
  try {
    await runRegression(`
      import assert from 'node:assert/strict';
      import { writeFileSync } from 'node:fs';
      import { kicadImporter } from './src/io/kicad/kicadImporter';
      import { blank } from './src/io/ioXml';
      import { updateView } from './src/manipulators/updateView';
      import { writeSpiceWithModels } from './src/io/netlists/netlistSpice';
      import { symbolField } from './src/simulation/catalogBindings';
      globalThis.document = { createElement: () => ({ getContext: () => ({
        measureText: (text) => ({ width: String(text).length * 6, actualBoundingBoxDescent: 2 })
      }) }) };
      module.exports = (async () => {
        const imported = await kicadImporter.importSymbols(${JSON.stringify(lib)}, 'fixture.kicad_sym', [
          { fileName: 'vendor.lib', content: '.model VendorD D(IS=1e-12 N=1.1)' },
          { fileName: 'bad.lib', content: '.include "unselected.lib"\\n.model D1 D' },
        ]);
        const [child, base, diode, resistor, missing, invalid, unmapped, broken] = imported;
        for (const entry of [child, base, diode, resistor])
          assert.equal(entry.spiceImportError, undefined, entry.name.Name + ': ' + entry.spiceImportError);
        const attribute = (entry, name) => entry.name.Attributes.find(({ AttName }) => AttName === name)?.AttValue;
        assert.match(attribute(child, '$$SPICE'), /^XTC_\\$\\(ref\\) %\\(2\\) %\\(1\\) TC_KICAD_/);
        assert.equal(attribute(child, '$$SPICE_PROLOG'), attribute(base, '$$SPICE_PROLOG'));
        assert.match(attribute(child, '$$SPICE_PROLOG'), /factor=3/);
        assert.match(attribute(diode, '$$SPICE'), /%\\(2\\) %\\(1\\)/);
        assert.match(attribute(diode, '$$SPICE_PROLOG'), /is=1e-14/);
        assert.equal(attribute(resistor, '$$SPICE'), 'RTC_$(ref) %(1) %(2) 2.0k');
        assert.match(missing.spiceImportError, /no-model\\.lib is missing/);
        assert.match(invalid.spiceImportError, /unselected\\.lib is missing/);
        assert.match(unmapped.spiceImportError, /complete symbol pin mapping/);
        assert.match(broken.spiceImportError, /embedded model compression/);
        assert.equal(attribute(broken, '$$SPICE'), undefined);

        const updater = new updateView();
        let sheet = blank().sheets[0];
        const refs = ['U1', 'D1', 'R1'];
        for (const [index, entry] of [child, diode, resistor].entries()) {
          sheet = updater.handleSelectLibrarySymbol({}, sheet, entry.name, entry.symbolData, [100 + 100 * index, 100]).sheet;
          sheet.items.at(-1).text.find((field) => field.description === 'Ref').value = refs[index];
        }
        assert.equal(symbolField(sheet.items[0], '$$SPICE_PROLOG'), attribute(child, '$$SPICE_PROLOG'));
        const n = (reference, pin) => ({ reference, pin });
        const netlist = {
          symbols: sheet.items.map((item) => [sheet.name, item]),
          labels: { '0': 'g', input: 'i', amplified: 'a', forward: 'f', load: 'l' },
          nets: {
            g: [n('D1', '1'), n('R1', '2')], i: [n('U1', '1')],
            a: [n('U1', '2')], f: [n('D1', '2')], l: [n('R1', '1')],
          },
        };
        const deck = writeSpiceWithModels(netlist);
        assert.match(deck, /XTC_U1 amplified input/);
        assert.match(deck, /\\* Model uses \\$ and % characters/);
        writeFileSync(${JSON.stringify(deckPath)},
          deck + '\\nVin input 0 1\\nI1 0 forward 1m\\nI2 0 load 1m\\n.save v(amplified) v(forward) v(load)\\n.op\\n.end\\n');
      })();
`, {});
    if (ngspiceAvailable) {
      const result = runNgspice(deckPath);
      assert.equal(result.status, 0, result.log);
      if (result.events) {
        const names = result.events.find(({ type }) => type === 'vectors').names;
        const values = result.events.find(({ type }) => type === 'data').rows[0];
        assert.ok(Math.abs(values[names.indexOf('amplified')] - 3) < 1e-6);
        assert.ok(Math.abs(values[names.indexOf('load')] - 2) < 1e-6);
        assert.ok(values[names.indexOf('forward')] > 0.70 && values[names.indexOf('forward')] < 0.75);
      }
    }
  } finally {
    await rm(deckPath, { force: true });
    await rmdir(out);
  }
});
