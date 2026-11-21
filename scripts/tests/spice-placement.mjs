import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { ioXML, blank } from '../../src/io/ioXml';
import { XMLBuilder } from '../../src/util/xmlbuilder';
import { updateView } from '../../src/manipulators/updateView';
import { updateSymbol } from '../../src/manipulators/updateSymbol';
import { writeSpice, writeSpiceWithModels } from '../../src/io/netlists/netlistSpice';
import { modelBinding } from '../../src/simulation/catalogBindings';
import { changeSpiceTemplateMode, inspectSpiceModel, searchSpiceModels } from '../../src/simulation/spiceModelCatalog';
import { librarySymbolSelection } from '../../src/io/librarySymbols';
export function checkSpicePlacement(library, exportFile) {
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({
        measureText: (text) => ({
          width: String(text).length * 6,
          actualBoundingBoxDescent: 2,
        }),
      }),
    }),
  };
  // Adapt the Node XML implementation to native browser DOM coercion/root behavior.
  const createDoc = XMLBuilder.prototype.createDoc;
  XMLBuilder.prototype.createDoc = function (name) {
    createDoc.call(this, name);
    this.insert = this.xmlDoc.documentElement;
  };
  const stringify = XMLBuilder.prototype.tostring;
  XMLBuilder.prototype.tostring = function () {
    function normalize(node) {
      if (node.attributes)
        for (let a = 0; a < node.attributes.length; a++)
          node.attributes[a].value = String(node.attributes[a].value);
      if (node.nodeType === 3 || node.nodeType === 4)
        node.data = String(node.data);
      for (let child = node.firstChild; child; child = child.nextSibling)
        normalize(child);
    }
    normalize(this.xmlDoc);
    return stringify.call(this);
  };
  const results = [];
  const packageSymbols = [];
  const io = new ioXML();
  const updater = new updateView();
  for (const name of library.names) {
    const selection = librarySymbolSelection(
      {
        ...library,
        fileId: 'bundled:spice',
        symbols: library.symbols.map((symbol) => ({
          ...symbol,
          SymbolId: symbol.SymbolID,
        })),
      },
      name,
    );
    const drawing = blank();
    const preview = updater.beginLibrarySymbolPlacement(
      { tracker: {}, _selected_array: [] },
      drawing.sheets[0],
      selection.name,
      selection.symbolData,
    );
    assert.equal(preview.sheet.items.length, 0, 'preview does not place a symbol');
    assert.equal(preview.view.add.text[0].value, name.Name);
    const moved = updater.mousemove_add(preview.view, preview.sheet, [203, 207]);
    assert.equal(moved.view.display_add, true);
    const clicked = updater.click_add(moved.view, moved.sheet, [203, 207]);
    assert.equal(clicked.sheet.items.length, 1, 'click commits one symbol');
    assert.equal(clicked.view.add, null);
    const cancelled = updater.cancel_add(preview.view, preview.sheet);
    assert.equal(cancelled.sheet.items.length, 0, 'cancel leaves no placed symbol');
    assert.equal(cancelled.view.add, null);
    assert.ok(clicked.sheet.items[0].text.some((text) => text.description === '$$SPICE'));
    const placed = updater.handleSelectLibrarySymbol(
      {},
      drawing.sheets[0],
      selection.name,
      selection.symbolData,
      [100, 100],
    );
    const symbol = placed.sheet.items.at(-1);
    const ref = name.Reference.replace('?', String(name.NameID));
    symbol.text.find((t) => t.description === 'Ref').value = ref;
    const pinUpdater = new updateSymbol(symbol);
    const pins = [...pinUpdater.active_points(), ...pinUpdater.power_pins()];
    for (let rotation = 0; rotation < 8; rotation++) {
      const variant = { ...symbol, rotation, _active_points: null };
      for (const [x, y, pin] of new updateSymbol(variant).active_points()) {
        assert.ok(
          [x, y].every(
            (value) => Math.abs(value / 5 - Math.round(value / 5)) < 1e-6,
          ),
          name.Name +
            ' pin ' +
            pin.number +
            ' off grid at rotation ' +
            rotation +
            ': ' +
            [x, y],
        );
      }
    }

    const nets = {};
    const labels = {};
    for (const [, , pin] of pins) {
      const id = pin.number;
      labels['n' + id] = id;
      nets[id] = [{ reference: ref, pin: id }];
    }
    const netlist = { symbols: [['test', symbol]], nets, labels };
    const out = writeSpice(netlist);
    assert.ok(
      !/NO_MODEL|<pin |<attr |\$\(|\?\(/.test(out),
      name.Name + ' unresolved: ' + out,
    );
    assert.ok(symbol.text.some((t) => t.description === '$$SPICE'));
    const binding = modelBinding(symbol);
    assert.ok(binding, name.Name + ' has a bundled model');
    assert.equal(binding.embeddedPack, undefined);
    assert.ok(!symbol.text.some((t) => t.description === '$$SPICE_PROLOG'));
    assert.ok(binding.pins.every((pin) => pins.some((entry) => entry[2].number === pin)));
    const selectedModel = searchSpiceModels('', symbol).find(({ id }) => id === binding.modelId);
    assert.ok(selectedModel, name.Name + ' default is offered in the compatible picker');
    assert.deepEqual(inspectSpiceModel(symbol, selectedModel).mapping, binding.pins);
    if (name.Name === 'Diode') {
      const custom = changeSpiceTemplateMode(symbol, 'custom');
      const other = { ...symbol, text: symbol.text.map((field) =>
        field.description === 'Ref' ? { ...field, value: 'D999' } : field) };
      const mixed = writeSpice({
        ...netlist,
        symbols: [['test', custom], ['test', other]],
      });
      assert.match(mixed, new RegExp(`^\\.model TC_CUSTOM_TC_D_${ref} D\\(`, 'm'));
      assert.match(mixed, /^\.model TC_D D\(/m);
      assert.deepEqual(modelBinding(changeSpiceTemplateMode(custom, 'bundled')), binding);
      const both = { ...placed.sheet, items: [symbol, other] };
      const xml = io.to_dsn({ ...drawing, sheets: [both] }, true, true);
      assert.equal(io.from_dsn(xml).spiceModelPacks.length, 1);
    }
    if (name.Name === 'LM358' || name.Name === 'LM324') {
      const model =
        name.Name === 'LM358' ? 'LM358_DUAL_OJ' : 'LM324_QUAD_OJ';
      const terminalCount = name.Name === 'LM358' ? 8 : 14;
      assert.equal(pins.length, terminalCount);
      const orderedNets = Array.from(
        { length: terminalCount },
        (_, i) => `n${i + 1}`,
      );
      assert.ok(
        out.split('\n').includes(`XTC_${ref} ${orderedNets.join(' ')} ${model}`),
      );
      packageSymbols.push(['test', symbol]);
    }
    assert.ok(
      symbol.text
        .filter((t) => t.description.startsWith('$$'))
        .every((t) => !t.show && t.display === 2),
    );
    const xml = io
      .to_dsn({ ...drawing, sheets: [placed.sheet] }, true, true)
      .tostring();
    const xml2 = new XMLBuilder();
    xml2.fromText(xml);
    const reopened = io.from_dsn(xml2);
    assert.deepEqual(modelBinding(reopened.sheets[0].items.at(-1)), binding);
    assert.equal(reopened.spiceModelPacks.length, 1);
    const old = {
      ...symbol,
      text: symbol.text.map((t) => ({
        ...t,
        value: t.description.startsWith('$$')
          ? 'OLD TEMPLATE'
          : t.description === 'Value'
          ? '47k'
          : t.value,
      })),
    };
    const replacement = updater.createReplacementText(
      old,
      symbol._symbol,
      name,
      true,
      symbol.part,
    );
    assert.equal(
      replacement.find((t) => t.description === '$$SPICE').value,
      symbol.text.find((t) => t.description === '$$SPICE').value,
      'replacement uses new SPICE template',
    );
    assert.ok(
      replacement
        .filter((t) => t.description.startsWith('$$'))
        .every((t) => !t.show && t.display === 2),
    );
    if (symbol.text.some((t) => t.description === 'Value'))
      assert.equal(
        replacement.find((t) => t.description === 'Value').value,
        '47k',
        'replacement keeps user values',
      );
    results.push({
      name: name.Name,
      reference: ref,
      pins: pins.map((p) => ({ number: p[2].number, name: p[2].name })),
      netlist: writeSpiceWithModels(netlist),
    });
  }
  assert.equal(packageSymbols.length, 2);
  const packageDeck = writeSpiceWithModels({
    symbols: packageSymbols,
    nets: {},
    labels: {},
  });
  assert.equal(
    (packageDeck.match(/^\.subckt OPAMP_OJ\b/gm) || []).length,
    1,
  );
  writeFileSync(exportFile, JSON.stringify(results, null, 2));
  console.log(
    'Actual placement, hidden metadata, SPICE expansion, and drawing save/load passed for ' +
      results.length +
      ' entries.',
  );
}
