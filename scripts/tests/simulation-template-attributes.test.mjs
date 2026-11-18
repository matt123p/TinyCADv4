import { test } from 'node:test';
import { runRegression } from './run-regression.mjs';

test('legacy SPICE templates resolve attribute names regardless of capitalization', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { XMLBuilder } from './src/util/xmlbuilder';
    import { ioXML } from './src/io/ioXml';
    import { NetlistWorkerState } from './src/web-worker/netlistState';
    import { writeSpice } from './src/io/netlists/netlistSpice';
    import { buildDeck } from './src/simulation/deck';
    import { defaultSetup } from './src/simulation/contracts';
    import { checkSpiceComponents } from './src/simulation/diagnostics';

    const previousDocument = globalThis.document;
    globalThis.document = { createElement: () => ({ getContext: () => ({
      font: '', measureText: text => ({ width: String(text).length * 8, actualBoundingBoxDescent: 3 }),
    }) }) };
    try {
      const xml = new XMLBuilder();
      xml.fromText(fs.readFileSync('scripts/tests/fixtures/simple-spice.dsn', 'utf8'));
      const drawing = new ioXML().from_dsn(xml);
      const net = new NetlistWorkerState().init(drawing);
      const setup = defaultSetup();
      assert.equal(net.symbols.length, 2);
      assert.deepEqual(checkSpiceComponents(net, setup), []);
      const deck = buildDeck(net, setup);
      assert.match(deck, /^R1\s+\S+\s+\S+\s+1K\s*$/m);
      assert.match(deck, /^C1\s+\S+\s+\S+\s+1p\s+IC=0V\s*$/m);
      assert.ok(!deck.includes('not found'));

      const source = net.symbols.find(([, symbol]) => symbol.text.some(field => field.value === 'R1'));
      const spice = '$' + '$SPICE';
      function expand(template, extra = []) {
        const symbol = { ...source[1], text: [
          ...source[1].text.filter(field => field.description !== spice),
          { description: spice, value: template }, ...extra,
        ] };
        return writeSpice({ ...net, symbols: [[source[0], symbol]] }).split('\n').slice(1).join('\n').trim();
      }
      assert.equal(expand('$(NAME) $(Name) $(name) $(ReF) $(REFNUM)'), '1K 1K 1K R1 1');
      assert.equal(expand('?(defined(NAME),$(name),bad) ?(not_defined(missing),ok,bad)'), '1K ok');
      assert.equal(expand('?(not_empty(NAME),ok,bad) ?(empty(tc1),ok,bad)'), 'ok ok');
      assert.equal(expand('?(defined(missing),bad,ok) ?(not_defined(NAME),bad,ok)'), 'ok ok');
      assert.equal(expand('?(empty(NAME),bad,ok) ?(not_empty(tc1),bad,ok)'), 'ok ok');
      assert.equal(expand('$(NAME) $(Name)', [{ description: 'NAME', value: '2K' }]), '2K 1K');
      assert.equal(expand('B1 out 0 V={v(in)>1 ? max(0,2) : 0}'), 'B1 out 0 V={v(in)>1 ? max(0,2) : 0}');
      assert.equal(expand('B1 out 0 V={v(in)>1?(2):(0)}'), 'B1 out 0 V={v(in)>1?(2):(0)}');
      assert.equal(expand('$(Missing)'), "<attr 'Missing' not found>");
    } finally {
      globalThis.document = previousDocument;
    }
  `);
});
