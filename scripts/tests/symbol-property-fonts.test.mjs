import { test } from 'node:test';
import { runRegression } from './run-regression.mjs';

test('symbol property fonts inherit by name, support bulk overrides, and round-trip', async () => {
  await runRegression(`
    import assert from 'node:assert/strict';
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { ActionCreators } from 'redux-undo';
    import { DocStoreWithHistory } from './src/state/undo/undo';
    import { SymbolActionTypes } from './src/state/actions/symbolActions';
    import { DocActionTypes } from './src/state/actions/docActions';
    import { decodeDrawing, encodeDrawing } from './src/io/dsnCodec';
    import { DocItemTypes } from './src/model/dsnItem';
    import ServerSymbol from './renderer/ServerSymbol';

    globalThis.OffscreenCanvas = class {
      getContext() {
        return {
          font: '',
          measureText(value) {
            const size = parseFloat(this.font);
            return { width: value.length * size, actualBoundingBoxDescent: size / 5 };
          },
        };
      }
    };

    const definition = '<SYMBOLDEF id="1"><NAME type="0">Part</NAME><GUID>font-test</GUID>' +
      '<REF type="0">U?</REF><DESCRIPTION>Test</DESCRIPTION><PPP>1</PPP>' +
      '<REF_POINT pos="0,0" power="0" part="1"/><TinyCAD><RECTANGLE a="0,0" b="10,10"/></TinyCAD></SYMBOLDEF>';
    const field = (description, value, pos, font = '') =>
      '<FIELD pos="' + pos + '" value="' + value + '" description="' + description + '" type="0" show="1" ' + font + '/>';
    const symbol = (pos, ...fields) =>
      '<SYMBOL id="1" pos="' + pos + '" part="0" rotate="0" show_power="0" can_scale="0" scale_x="1" scale_y="1">' + fields.join('') + '</SYMBOL>';
    const first = symbol('20,20', field('Ref', 'U1', '3,5'), field('Name', 'First', '3,10'),
      field('Value', '1k', '3,15'), field('Value', '2k', '3,20'));
    const second = symbol('60,20', field('Name', 'Second', '4,11'),
      field('Ref', 'U2', '4,6', 'font_name="Courier New"'));
    const third = symbol('20,20', field('Ref', 'U3', '3,5'));
    const xml = '<TinyCADSheets><TinyCAD>' + definition + first + second + '</TinyCAD><TinyCAD>' +
      definition + third + '</TinyCAD></TinyCADSheets>';

    async function verify() {
      const original = await decodeDrawing(xml);
      let history = DocStoreWithHistory(undefined, { type: '@@INIT' });
      history = DocStoreWithHistory(history, { type: DocActionTypes.SetDocument, doc: original });
      history = DocStoreWithHistory(history, ActionCreators.clearHistory());
      const parts = () => history.present.drawing.sheets.flatMap(sheet => sheet.items.filter(item => item.NodeName === DocItemTypes.Symbol));
      const positions = () => parts().map(item => item.text.map(({position, value}) => ({position, value})));
      const before = positions();
      const style = (part, index) => {
        const { font_name, font_size } = part.textData[index].textArea.drawItem;
        return [font_name, font_size];
      };
      const edit = (target, ...edits) => {
        history = DocStoreWithHistory(history, { type: SymbolActionTypes.SetPropertyFonts, target, edits });
      };
      const markup = () => renderToStaticMarkup(React.createElement(ServerSymbol, { data: parts()[0], options: original.sheets[0].options }));
      const baseline = text => {
        const match = text.match(/translate\\( [^ ]+ ([^)]*)\\)[^>]*><text[^>]* y="([^"]+)"[^>]*><tspan>U1<\\/tspan>/);
        assert.ok(match, text);
        return Number(match[1]) + Number(match[2]);
      };
      const originalBaseline = baseline(markup());
      assert.deepEqual(style(parts()[0], 0), ['Arial', 10]);

      edit(null, { description: 'Ref', font: { font_name: 'Times', font_size: 22 } },
        { description: 'Value', font: { font_size: 16 } });
      assert.deepEqual(parts().map((part, i) => style(part, i === 1 ? 1 : 0)),
        [['Times', 22], ['Courier New', 22], ['Times', 22]]);
      assert.deepEqual(style(parts()[0], 2), ['Arial', 16]);
      assert.equal(baseline(markup()), originalBaseline);
      assert.match(markup(), /font-size:22px;font-family:Times/);
      const firstId = parts()[0]._id;
      const secondId = parts()[1]._id;
      const selected = { sheetIndex: 0, symbolIds: [firstId, secondId] };
      edit(selected, { description: 'Ref', font: { font_size: 13 } }, { description: 'Name', font: { font_name: 'Courier New' } });
      assert.deepEqual(parts().map((part, i) => style(part, i === 1 ? 1 : 0)),
        [['Times', 13], ['Courier New', 13], ['Times', 22]]);
      assert.deepEqual(style(parts()[0], 1), ['Courier New', 10]);
      assert.deepEqual(style(parts()[1], 0), ['Courier New', 10]);
      history = DocStoreWithHistory(history, ActionCreators.undo());
      assert.deepEqual(style(parts()[0], 0), ['Times', 22]);
      assert.deepEqual(style(parts()[0], 1), ['Arial', 10]);
      history = DocStoreWithHistory(history, ActionCreators.redo());
      assert.deepEqual(style(parts()[0], 0), ['Times', 13]);

      edit({ sheetIndex: 0, symbolIds: [firstId] }, { index: 3, description: 'Value', font: { font_size: 17 } });
      assert.deepEqual(style(parts()[0], 2), ['Arial', 16]);
      assert.deepEqual(style(parts()[0], 3), ['Arial', 17]);
      edit(selected, { description: 'Ref', font: { font_size: null } });
      assert.deepEqual(parts().map((part, i) => style(part, i === 1 ? 1 : 0)),
        [['Times', 22], ['Courier New', 22], ['Times', 22]]);
      assert.deepEqual(positions(), before);

      for (const format of ['xml', 'zip-v1']) {
        const saved = history.present.drawing;
        const restored = await decodeDrawing(await encodeDrawing(saved, format));
        assert.deepEqual(restored.settings.symbolPropertyFonts, saved.settings.symbolPropertyFonts);
        const restoredParts = restored.sheets.flatMap(sheet => sheet.items.filter(item => item.NodeName === DocItemTypes.Symbol));
        assert.deepEqual(restoredParts.map(item => item.text.map(({position, value}) => ({position, value}))), before);
        assert.deepEqual(style(restoredParts[0], 3), ['Arial', 17]);
        assert.deepEqual(style(restoredParts[1], 1), ['Courier New', 22]);
      }
    }
    module.exports = verify();
  `, { bundlePackages: ['redux-undo'] });
});
