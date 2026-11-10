import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { ioXML, blank } from '../../src/io/ioXml';
import { XMLBuilder } from '../../src/util/xmlbuilder';
import { updateView } from '../../src/manipulators/updateView';
import { updateSymbol } from '../../src/manipulators/updateSymbol';
import { writeSpice } from '../../src/io/netlists/netlistSpice';
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
  const io = new ioXML();
  const updater = new updateView();
  for (const name of library.names) {
    const builder = new XMLBuilder();
    builder.fromText(
      library.symbols.find((s) => s.SymbolID === name.SymbolID).Data,
    );
    const drawing = blank();
    const doc = io.from_dsn(builder);
    const placed = updater.handleSelectLibrarySymbol(
      {},
      drawing.sheets[0],
      name,
      doc.sheets.map((s) => s.items),
      [100, 100],
    );
    const symbol = placed.sheet.items.at(-1);
    const ref = name.Reference.replace('?', String(name.NameID));
    symbol.text.find((t) => t.description === 'Ref').value = ref;
    const pins = new updateSymbol(symbol).active_points();
    const nets = {};
    const labels = {};
    for (const [, , pin] of pins) {
      const id = pin.number;
      labels['n' + id] = id;
      nets[id] = [{ reference: ref, pin: id }];
    }
    const out = writeSpice({ symbols: [['test', symbol]], nets, labels });
    assert.ok(
      !/NO_MODEL|<pin |<attr |\$\(|\?\(/.test(out),
      name.Name + ' unresolved: ' + out,
    );
    assert.ok(symbol.text.some((t) => t.description === '$$SPICE'));
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
    const back = io.from_dsn(xml2).sheets[0].items.at(-1);
    assert.equal(
      back.text.find((t) => t.description === '$$SPICE_PROLOG')?.value,
      symbol.text.find((t) => t.description === '$$SPICE_PROLOG')?.value,
      name.Name + ' multiline SPICE survives save',
    );
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
      netlist: out,
    });
  }
  writeFileSync(exportFile, JSON.stringify(results, null, 2));
  console.log(
    'Actual placement, hidden metadata, SPICE expansion, and drawing save/load passed for ' +
      results.length +
      ' entries.',
  );
}
