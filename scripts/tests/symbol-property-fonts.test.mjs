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
    import { ioXML } from './src/io/ioXml';
    import { XMLBuilder } from './src/util/xmlBuilder';
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
    const field = (description, value, pos, font = '', show = 1) =>
      '<FIELD pos="' + pos + '" value="' + value + '" description="' + description + '" type="0" show="' + show + '" ' + font + '/>';
    const symbol = (pos, ...fields) =>
      '<SYMBOL id="1" pos="' + pos + '" part="0" rotate="0" show_power="0" can_scale="0" scale_x="1" scale_y="1">' + fields.join('') + '</SYMBOL>';
    const first = symbol('20,20', field('Ref', 'U1', '3,5'), field('Name', 'First', '3,10'),
      field('Value', '1k', '3,15'), field('Value', '2k', '3,20'));
    const second = symbol('60,20', field('Name', 'Second', '4,11'),
      field('Ref', 'U2', '4,6', 'font="4" font_inherit="size"'),
      field('Value', '3k', '4,16', '', 0));
    const third = symbol('20,20', field('Ref', 'U3', '3,5'));
    const refFont = '<FONT id="4"><HEIGHT>10</HEIGHT><FACENAME>Courier New</FACENAME>' +
      '<WEIGHT>400</WEIGHT><ITALIC>0</ITALIC></FONT>';
    const labels = '<LABEL pos="100,20" style="0" font="4" direction="3">SIGNAL</LABEL>' +
      '<POWER pos="100,30" which="4" direction="1">0</POWER>';
    const xml = '<TinyCADSheets><TinyCAD>' + refFont + definition + first + second + labels + '</TinyCAD><TinyCAD>' +
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

      edit({ sheetIndex: 0, symbolIds: [firstId] }, { index: 3, description: 'Value', font: { font_size: 17.5 } });
      assert.deepEqual(style(parts()[0], 2), ['Arial', 16]);
      assert.deepEqual(style(parts()[0], 3), ['Arial', 17.5]);
      edit(selected, { description: 'Value', font: { font_name: 'Times' } });
      assert.deepEqual(style(parts()[0], 2), ['Times', 16]);
      assert.equal(parts()[1].text[2].font, undefined);
      assert.equal(parts()[1].textData[2], null);
      edit(selected, { description: 'Ref', font: { font_size: null } });
      assert.deepEqual(parts().map((part, i) => style(part, i === 1 ? 1 : 0)),
        [['Times', 22], ['Courier New', 22], ['Times', 22]]);
      assert.deepEqual(positions(), before);

      const saved = history.present.drawing;
      const raw = new TextDecoder().decode(await encodeDrawing(saved, 'xml'));
      assert.doesNotMatch(raw, /font_name=|font_size=/);
      const builder = new XMLBuilder();
      builder.fromText(raw);
      const root = builder.xmlDoc.documentElement;
      const children = (node, tag) => Array.from(node.childNodes).filter(child => child.nodeName === tag);
      const resource = (scope, element) => {
        const id = element.getAttribute('font');
        assert.ok(id, 'expected a font reference');
        const entry = children(scope, 'FONT').find(font => font.getAttribute('id') === id);
        assert.ok(entry, 'font reference resolves in its own resource table');
        return [children(entry, 'FACENAME')[0].textContent, Number(children(entry, 'HEIGHT')[0].textContent)];
      };
      const [firstSheet] = children(root, 'TinyCAD');
      const settings = children(root, 'DSNSETTINGS')[0];
      const [refDefault, valueDefault] = children(settings, 'SYMBOL_PROPERTY_FONT');
      assert.ok(raw.indexOf('<FONT ') < raw.indexOf('<TinyCAD '));
      assert.deepEqual(resource(root, refDefault), ['Times', 22]);
      assert.equal(refDefault.hasAttribute('font_inherit'), false);
      assert.deepEqual(resource(root, valueDefault), ['Arial', 16]);
      assert.equal(valueDefault.getAttribute('font_inherit'), 'name');

      const [firstSymbol, secondSymbol] = children(firstSheet, 'SYMBOL');
      const [firstRef, firstName, firstValue, secondValue] = children(firstSymbol, 'FIELD');
      const [secondName, secondRef] = children(secondSymbol, 'FIELD');
      assert.equal(firstRef.hasAttribute('font'), false);
      assert.deepEqual(resource(firstSheet, firstName), ['Courier New', 10]);
      assert.equal(firstName.getAttribute('font'), secondName.getAttribute('font'));
      assert.equal(firstName.getAttribute('font'), children(firstSheet, 'LABEL')[0].getAttribute('font'));
      assert.deepEqual(resource(firstSheet, firstValue), ['Times', 16]);
      assert.equal(firstValue.getAttribute('font_inherit'), 'size');
      assert.deepEqual(resource(firstSheet, secondValue), ['Times', 17.5]);
      assert.equal(secondValue.hasAttribute('font_inherit'), false);
      assert.deepEqual(resource(firstSheet, secondRef), ['Courier New', 22]);
      assert.equal(secondRef.getAttribute('font_inherit'), 'size');

      const fontIds = (scope) => new Set(children(scope, 'FONT').map(font => font.getAttribute('id')));
      const referencedIds = (nodes) => new Set(Array.from(nodes)
        .filter(node => node.hasAttribute('font')).map(node => node.getAttribute('font')));
      assert.deepEqual(fontIds(root), referencedIds(children(settings, 'SYMBOL_PROPERTY_FONT')));
      for (const sheet of children(root, 'TinyCAD')) {
        const fonts = children(sheet, 'FONT');
        const pinFont = fonts.find(font => font.getAttribute('id') === '1');
        assert.ok(pinFont, 'symbols implicitly use the legacy pin font');
        assert.equal(children(pinFont, 'FACENAME')[0].textContent, 'Arial');
        assert.equal(children(pinFont, 'HEIGHT')[0].textContent, '-10');
        const references = referencedIds(sheet.getElementsByTagName('*'));
        assert.ok(Array.from(references).every(id => Number(id) >= 3));
        assert.deepEqual(fontIds(sheet), new Set(['1', ...references]));
      }

      for (const format of ['xml', 'zip-v1']) {
        const restored = await decodeDrawing(await encodeDrawing(saved, format));
        assert.deepEqual(restored.settings.symbolPropertyFonts, saved.settings.symbolPropertyFonts);
        const restoredParts = restored.sheets.flatMap(sheet => sheet.items.filter(item => item.NodeName === DocItemTypes.Symbol));
        assert.deepEqual(restoredParts.map(item => item.text.map(({position, value}) => ({position, value}))), before);
        assert.deepEqual(restoredParts[0].text.map(field => field.font), [
          undefined, { font_name: 'Courier New' }, { font_name: 'Times' }, { font_name: 'Times', font_size: 17.5 },
        ]);
        assert.deepEqual(style(restoredParts[0], 3), ['Times', 17.5]);
        assert.deepEqual(style(restoredParts[1], 1), ['Courier New', 22]);
      }

      const labelOnly = new XMLBuilder();
      labelOnly.createDoc('TinyCADSheets');
      const label = saved.sheets[0].items.find(item => item.NodeName === DocItemTypes.Label);
      const labelSheet = new ioXML().to_tinycad(saved.sheets[0], labelOnly, [label], false, false, false).insert;
      assert.deepEqual(fontIds(labelSheet), new Set(['3']));
      assert.equal(children(labelSheet, 'LABEL')[0].getAttribute('font'), '3');

      const powerOnly = new XMLBuilder();
      powerOnly.createDoc('TinyCADSheets');
      const power = saved.sheets[0].items.find(item => item.NodeName === DocItemTypes.Power);
      const powerSheet = new ioXML().to_tinycad(saved.sheets[0], powerOnly, [power], false, false, false).insert;
      assert.deepEqual(fontIds(powerSheet), new Set(['1']));
      assert.equal(children(powerSheet, 'POWER')[0].hasAttribute('font'), false);

      const clipboard = new XMLBuilder();
      clipboard.createDoc('TinyCADSheets');
      new ioXML().to_tinycad(saved.sheets[0], clipboard, [parts()[1]], false, false, false);
      const pasted = (await decodeDrawing(clipboard.tostring())).sheets[0].items[0];
      assert.deepEqual(pasted.text[1].font, { font_name: 'Courier New' });
      assert.deepEqual(style(pasted, 1), ['Courier New', 10]);
    }
    module.exports = verify();
  `, { bundlePackages: ['redux-undo'] });
});
