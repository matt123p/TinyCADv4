import { test } from 'node:test';
import { runRegression } from './run-regression.mjs';

test('hidden symbol attributes have no pointer or rectangle hit targets', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import { blank } from './src/io/ioXml';
    import { createControl } from './src/simulation/controlSymbols';
    import { updateSymbol } from './src/manipulators/updateSymbol';
    import { TextDisplayMethod } from './src/model/tclib';
    globalThis.document = {createElement: () => ({getContext: () => ({
      font: '', measureText: text => ({width: String(text).length * 8, actualBoundingBoxDescent: 3}),
    })})};
    const drawing = blank();
    const original = createControl('source', drawing.sheets[0], drawing).symbol;
    const field = {description: 'Value', value: '', show: true, type: 0, position: [40, 20]};
    const make = text => new updateSymbol({
      ...original, point: [0, 0], text, textData: null,
      _symbol: {...original._symbol, uid: 'test-attributes',
        outlines: original._symbol.outlines.map(outline => ({...outline, items: []}))},
    }).post_construction();
    const delta = {dx: 0, dy: 0, dr: 0, scale_x: 1, scale_y: 1};
    const hidden = [
      {...field, display: TextDisplayMethod.NeverShow, value: 'Hidden model'},
      {...field, display: TextDisplayMethod.ShowValuePresent},
      {...field, display: TextDisplayMethod.ShowNameValuePresent},
      {...field, display: TextDisplayMethod.ShowValue, show: false, value: 'Hidden value'},
    ];
    for (const attribute of hidden) {
      const symbol = make([attribute]);
      assert.equal(symbol.textData[0], null, 'Display rules intentionally omit this text');
      const updater = new updateSymbol(symbol);
      assert.equal(updater.is_inside(delta, [42, 22], false), null);
      assert.deepEqual(updater.is_inside_rect(delta, [39, 19], [200, 60], []), []);
    }
    const visible = {...field, display: TextDisplayMethod.ShowValuePresent, value: '1k'};
    const symbol = make([...hidden, visible]);
    const updater = new updateSymbol(symbol);
    assert.ok(symbol.textData[hidden.length]);
    const hit = updater.is_inside(delta, [42, 22], false);
    assert.equal(hit.item, symbol);
    assert.equal(hit.handle, -(100 + hidden.length), 'Visible fields retain their original editing handle');
    assert.deepEqual(updater.is_inside_rect(delta, [39, 19], [200, 60], []), [symbol]);
  `);
});

test('saved example symbols support hover and rectangle selection after loading', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import path from 'node:path';
    import { DOMParser } from 'common-xml-features';
    import { decodeDrawing } from './src/io/dsnCodec';
    import { updateSymbol } from './src/manipulators/updateSymbol';
    globalThis.DOMParser = DOMParser;
    globalThis.document = {createElement: () => ({getContext: () => ({
      font: '', measureText: text => ({width: String(text).length * 8, actualBoundingBoxDescent: 3}),
    })})};
    module.exports = (async () => {
      let drawings = 0, symbols = 0;
      const delta = {dx: 0, dy: 0, dr: 0, scale_x: 1, scale_y: 1};
      for (const course of ['spice', 'xspice']) {
        const directory = path.join('tutorials', course, 'circuits');
        for (const filename of fs.readdirSync(directory).filter(name => name.endsWith('.dzn'))) {
          const drawing = await decodeDrawing(fs.readFileSync(path.join(directory, filename)));
          drawings++;
          for (const symbol of drawing.sheets.flatMap(sheet => sheet.items).filter(item => item.NodeName === 'symbol')) {
            const updater = new updateSymbol(symbol);
            assert.doesNotThrow(() => updater.is_inside(delta, [100000, 100000], false), filename);
            assert.doesNotThrow(() => updater.is_inside(delta, symbol.point, true), filename);
            assert.doesNotThrow(() => updater.is_inside_rect(delta, [100000, 100000], [100010, 100010], []), filename);
            symbols++;
          }
        }
      }
      assert.equal(drawings, 28);
      assert.ok(symbols > 100);
    })();
  `);
});
