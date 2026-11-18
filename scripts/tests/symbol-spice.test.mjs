import { test } from 'node:test';
import { runRegression } from './run-regression.mjs';

test('placed symbols inherit SPICE defaults and save editable instance overrides', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import { DocStoreReducer } from './src/state/stores/docStoreReducer';
    import { SymbolActionTypes } from './src/state/actions/symbolActions';
    import { updateView } from './src/manipulators/updateView';
    import { ioXML } from './src/io/ioXml';
    import { XMLBuilder } from './src/util/xmlbuilder';
    import { DocItemTypes } from './src/model/dsnItem';
    import { TextDisplayMethod } from './src/model/tclib';
    const spiceName = '$' + '$SPICE';
    const libraryName = { NameID: 1, SymbolID: 1, Name: 'Resistor', Reference: 'R?', ppp: 1,
      Description: 'Resistor', ShowName: 2, ShowRef: 2,
      Attributes: [{ AttName: spiceName, AttValue: 'library model', ShowAtt: 0 }] };
    const rectangle = { _id: 1, NodeName: DocItemTypes.Rectangle, point: [0, 0], point_b: [20, 10],
      line_width: 1, line_colour: '#000000', stroked: true, filled: false };
    function place(name) {
      const state = DocStoreReducer(undefined, { type: '@@INIT' });
      const result = new updateView().handleSelectLibrarySymbol(state.view, state.drawing.sheets[0], name, [[rectangle]], [0, 0]);
      const symbol = result.sheet.items.at(-1);
      return { ...state, drawing: { ...state.drawing, sheets: [result.sheet] }, view: { ...result.view, _selected_array: [symbol._id] } };
    }
    const symbol = state => state.drawing.sheets[0].items.at(-1);
    const property = state => symbol(state).text.find(field => field.description === spiceName);
    const edit = (state, value) => DocStoreReducer(state, { type: SymbolActionTypes.SetSymbolSpiceProperty, name: spiceName, value });
    const roundTrip = state => {
      const io = new ioXML(), xml = new XMLBuilder();
      xml.fromText(io.to_dsn(state.drawing, true, true).tostring());
      return io.from_dsn(xml).sheets[0].items.at(-1).text.find(field => field.description === spiceName);
    };
    const inherited = place(libraryName);
    assert.equal(property(inherited).value, 'library model');
    assert.equal(property(inherited).show, false);
    assert.equal(property(inherited).display, TextDisplayMethod.NeverShow);
    const overridden = edit(inherited, 'instance model\nsecond line');
    assert.equal(property(overridden).value, 'instance model\nsecond line');
    assert.equal(property(inherited).value, 'library model');
    assert.equal(libraryName.Attributes[0].AttValue, 'library model');
    assert.equal(roundTrip(overridden).value, 'instance model\nsecond line');
    assert.equal(roundTrip(edit(overridden, '')).value, '', 'clearing an override must survive save/reload');
    const ordinary = place({ ...libraryName, Attributes: [] });
    assert.equal(property(ordinary), undefined);
    const added = edit(ordinary, 'new model');
    assert.equal(property(added).value, 'new model');
    assert.equal(property(added).show, false);
    assert.equal(property(added).display, TextDisplayMethod.NeverShow);
    assert.equal(roundTrip(added).value, 'new model');
    assert.equal(symbol(edit(added, 'updated model')).text.filter(field => field.description === spiceName).length, 1);
    assert.ok(overridden.drawingVersion > inherited.drawingVersion);
  `);
});
