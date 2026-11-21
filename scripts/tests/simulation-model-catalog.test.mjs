import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { librarySqlite } from '../lib/library-from-sql.mjs';
import { runRegression } from './run-regression.mjs';
import { ngspiceAvailable, runNgspice } from './ngspice-runner.mjs';

test('both bundled packs expose a source link to each pinned model definition', async () => {
  for (const provider of ['openjellybean', 'circsim']) {
    const { models, pack } = JSON.parse(
      await readFile(`bundled-libraries/spice/${provider}.json`, 'utf8'),
    );
    assert.equal(
      createHash('sha256').update(pack.spice).digest('hex'),
      pack.sha256,
    );
    assert.ok(pack.licenseText.includes('MIT License'));
    const sources = new Map();
    for (const model of models) {
      const url = new URL(model.source.url);
      const line = Number(url.hash.slice(2)) - 1;
      const file = url.pathname.split('/').at(-1);
      assert.equal(url.protocol, 'https:');
      assert.equal(url.hostname, 'github.com');
      assert.equal(model.source.revision, pack.revision);
      assert.ok(url.pathname.includes(`/blob/${pack.revision}/`));
      if (!sources.has(file))
        sources.set(
          file,
          (
            await readFile(`library-sources/${provider}/${file}.txt`, 'utf8')
          ).split(/\r?\n/),
        );
      assert.equal(sources.get(file)[line], model.definition.split('\n')[0]);
      assert.ok(pack.spice.includes(model.definition));
    }
  }
});

test('catalog results, attachment, undo, simulation decks and drawing round-trips share both packs', async () => {
  const SQL = await librarySqlite();
  const db = new SQL.Database(
    await readFile('bundled-libraries/spice/spice.tclib'),
  );
  const entries = [];
  try {
    for (const name of ['Diode', 'LED (yellow)', '741 op-amp', 'Resistor']) {
      const rows = db.exec(
        'SELECT NameID, Name, Name.SymbolID, Reference, ppp, Description, ShowName, ShowRef, Data FROM Name JOIN Symbol USING (SymbolID) WHERE Name = ?',
        [name],
      )[0];
      const row = Object.fromEntries(
        rows.columns.map((key, index) => [key, rows.values[0][index]]),
      );
      const attributes = db.exec(
        'SELECT AttName, AttValue, ShowAtt FROM Attribute WHERE NameID = ?',
        [row.NameID],
      )[0];
      entries.push({
        name: {
          ...row,
          Data: undefined,
          Attributes: attributes.values.map(([AttName, AttValue, ShowAtt]) => ({
            AttName,
            AttValue,
            ShowAtt,
          })),
        },
        definition: new TextDecoder().decode(row.Data),
      });
    }
  } finally {
    db.close();
  }
  const folder = await mkdtemp(path.resolve('build/catalog-export-test-'));
  const spiceFile = path.join(folder, 'catalog.cir');
  const customFile = path.join(folder, 'custom.cir');
  try {
    await runRegression(
      `
    import assert from 'node:assert/strict';
    import { blank } from './src/io/ioXml';
    import { decodeDrawing, encodeDrawing } from './src/io/dsnCodec';
    import { librarySymbolSelection } from './src/io/librarySymbols';
    import { updateView } from './src/manipulators/updateView';
    import { defaultSetup } from './src/simulation/contracts';
    import { prepareSpiceDeck } from './src/simulation/deck';
    import { createSimulationSheet } from './src/simulation/document';
    import { bindSpiceModel, catalogModelPack, changeSpiceModel, inspectSpiceModel, searchSpiceModels } from './src/simulation/spiceModelCatalog';
    import { spiceDefinitionText } from './src/simulation/spiceModelDefinitions';
    import { modelBinding, symbolField } from './src/simulation/catalogBindings';
    import { writeSpiceWithModels } from './src/io/netlists/netlistSpice';
    import { DocStoreWithHistory } from './src/state/undo/undo';
    import { createEditorTools } from './src/chat/tools';
    import { XMLBuilder } from './src/util/xmlbuilder';
    import { ActionCreators } from 'redux-undo';
    import { writeFileSync } from 'node:fs';
    const createDoc = XMLBuilder.prototype.createDoc;
    XMLBuilder.prototype.createDoc = function (name) { createDoc.call(this, name); this.insert = this.xmlDoc.documentElement; };
    const stringify = XMLBuilder.prototype.tostring;
    XMLBuilder.prototype.tostring = function () {
      function normalize(node) {
        if (node.attributes) for (let i=0;i<node.attributes.length;i++) node.attributes[i].value = String(node.attributes[i].value);
        if (node.nodeType === 3 || node.nodeType === 4) node.data = String(node.data);
        for(let child=node.firstChild;child;child=child.nextSibling) normalize(child);
      }
      normalize(this.xmlDoc);
      return stringify.call(this);
    };
    globalThis.document = { createElement: () => ({ getContext: () => ({ measureText: (text) => ({ width: String(text).length * 6, actualBoundingBoxDescent: 2 }) }) }) };
    module.exports = (async () => {
      const entries = ${JSON.stringify(entries)};
      const updater = new updateView();
      let drawing = blank();
      let sheet = drawing.sheets[0];
      for (const [i, {name, definition}] of entries.entries()) {
        const library = { fileId: 'bundled:spice', symbols: [{ SymbolId: name.SymbolID, Data: definition }] };
        const selection = librarySymbolSelection(library, name);
        sheet = updater.handleSelectLibrarySymbol({}, sheet, selection.name, selection.symbolData, [100 + 80*i, 100]).sheet;
        sheet.items.at(-1).text.find((field) => field.description === 'Ref').value = ['D1','D2','U1','R1'][i];
      }
      const [diode, yellow, opamp, resistor] = sheet.items;
      const sheetId = sheet.id;
      drawing = { ...drawing, sheets: [sheet, createSimulationSheet(sheet, 'First'), createSimulationSheet(sheet, 'Second')] };
      assert.equal(searchSpiceModels('').length, 57);
      for (const entry of searchSpiceModels(''))
        assert.match(spiceDefinitionText(catalogModelPack(entry), entry.id), /^\\.(model|subckt) /im);
      assert.equal(searchSpiceModels('LED_YELLOW', diode).length, 0);
      assert.equal(searchSpiceModels('', resistor).length, 0);
      assert.equal(searchSpiceModels('MMBT3904')[0].id, '2N3904_OJ');
      const chosenDiode = searchSpiceModels('1N914', diode)[0];
      const chosenYellow = searchSpiceModels('', yellow)[0];
      const chosenOpamp = searchSpiceModels('UA741', opamp)[0];
      assert.equal(chosenDiode.id, '1N4148_OJ');
      assert.equal(chosenYellow.id, 'LED_YELLOW');
      assert.deepEqual(inspectSpiceModel(opamp, chosenOpamp).mapping, ['3','2','6','7','4']);
      const select = ({ id, packId, revision }) => ({modelId: id, packId, revision});
      assert.throws(() => changeSpiceModel(drawing, sheetId, diode._id, select(chosenYellow)), /incompatible/i);
      const yellowManual = { ...yellow, text: yellow.text.filter((field) => field.description !== '$$BUNDLED_SPICE_SYMBOL') };
      const custom = { ...drawing, sheets: [{ ...sheet, items: [yellowManual] }] };
      assert.throws(() => changeSpiceModel(custom, sheetId, yellow._id, select(chosenYellow)), /Confirm/);
      assert.throws(() => changeSpiceModel(custom, sheetId, yellow._id, { ...select(chosenYellow), replaceExisting:true, pins:['1','1'] }), /different pin/i);
      const manuallyMapped = changeSpiceModel(custom, sheetId, yellow._id, { ...select(chosenYellow), replaceExisting:true, pins:['2','1'] });
      assert.deepEqual(modelBinding(manuallyMapped.sheets[0].items[0]).pins, ['2','1']);

      let state = DocStoreWithHistory(undefined, { type: '@@init' });
      state = { ...state, present: { ...state.present, drawing, view: { ...state.present.view, selected_sheet: 0, _selected_array: [yellow._id] } } };
      const tools = createEditorTools({
        getState: () => ({docStore: state}),
        dispatch: (action) => { state = DocStoreWithHistory(state, action); return action; },
      }, () => assert.fail('Model tools should not emit files'), () => assert.fail('Model tools should not call a worker'), () => assert.fail('Model tools should not make a network request'));
      const { signal } = new AbortController();
      const duplicateSheet = { ...blank().sheets[0], name: 'Another schematic', items: [yellow] };
      state = { ...state, present: { ...state.present, drawing: { ...drawing, sheets: [...drawing.sheets, duplicateSheet] } } };
      await assert.rejects(tools('inspect_spice_target', { reference:'D2' }, signal), /unambiguous/i);
      state = { ...state, present: { ...state.present, drawing } };
      const found = await tools('search_spice_models', { query:'yellow', selected:true }, signal);
      assert.equal(found.data.models[0].source.name, 'circsim');
      assert.equal((await tools('search_spice_models', { query:'LED_YELLOW', reference:'D1' }, signal)).data.total, 0);
      const inspected = await tools('inspect_spice_target', { ...select(chosenYellow) }, signal);
      assert.equal(inspected.data.reference, 'D2');
      assert.equal(inspected.data.mapping.preverified, true);
      assert.equal(state.present.drawing, drawing);
      const toolArgs = { ...select(chosenYellow), reference:'D2', sheet:1, baseRevision:inspected.data.revision };
      await assert.rejects(tools('attach_spice_model', { ...toolArgs, baseRevision:'invalid' }, signal), /drawing changed/i);
      await tools('attach_spice_model', toolArgs, signal);
      assert.deepEqual(state.present.drawing, changeSpiceModel(drawing, sheetId, yellow._id, select(chosenYellow)));
      state = DocStoreWithHistory(state, ActionCreators.undo());
      assert.equal(modelBinding(state.present.drawing.sheets[0].items[1]), undefined);
      state = DocStoreWithHistory(state, ActionCreators.redo());
      assert.equal(modelBinding(state.present.drawing.sheets[0].items[1]).modelId, 'LED_YELLOW');

      let attached = changeSpiceModel(state.present.drawing, sheetId, diode._id, select(chosenDiode));
      attached = changeSpiceModel(attached, sheetId, opamp._id, select(chosenOpamp));
      assert.equal(attached.spiceModelPacks.length, 2);
      const tampered = { ...attached, spiceModelPacks: attached.spiceModelPacks.map(pack => ({ ...pack, spice: pack.spice + 'changed' })) };
      await assert.rejects(decodeDrawing(await encodeDrawing(tampered, 'xml')), /checksum/i);
      for (const format of ['xml', 'zip-v1']) {
        const saved = await encodeDrawing(attached, format);
        const loaded = await decodeDrawing(saved);
        assert.deepEqual(loaded.spiceModelPacks, attached.spiceModelPacks);
        const symbols = loaded.sheets[0].items.slice(0,3).map((symbol) => [sheet.name, symbol]);
        assert.equal(modelBinding(symbols[1][1]).source.url, chosenYellow.source.url);
        const nets = Object.fromEntries(symbols.flatMap(([, symbol]) => modelBinding(symbol).pins.map((pin) => {
          const reference = symbolField(symbol, 'Ref');
          return [reference + '_' + pin, [{ reference, pin }]];
        })));
        const netlist = { nets, labels:{'0':'D1_2'}, symbols };
        for (const simulation of loaded.sheets.slice(1)) {
          const setup = { ...defaultSetup(), ...simulation.simulation, models: {'custom.lib': '.model CUSTOM_TEST D(IS=1p)'} };
          const prepared = prepareSpiceDeck(netlist, setup, loaded.spiceModelPacks);
          assert.equal(Object.keys(prepared.files).length, 3);
          assert.equal((prepared.deck.match(/^\.include /gm) ?? []).length, 2);
          assert.match(prepared.deck, /DTC_D2 .*LED_YELLOW/);
          const exportText = writeSpiceWithModels(netlist, loaded.spiceModelPacks);
          assert.match(exportText, /\.model LED_YELLOW/i);
          assert.match(exportText, /MIT License/);
          const filename = loaded.spiceModelPacks.find(pack => pack.id === 'circsim').filename;
          assert.throws(() => prepareSpiceDeck(netlist, { ...setup, models: {[filename]:'other text'} }, loaded.spiceModelPacks), /Conflicting/);
          assert.throws(() => prepareSpiceDeck(netlist, { ...setup, models: {'conflict.lib':'.model led_yellow D(IS=1p)'} }, loaded.spiceModelPacks), /Duplicate/);
        }
        const restored = changeSpiceModel(loaded, loaded.sheets[0].id, symbols[1][1]._id);
        assert.equal(symbolField(restored.sheets[0].items[1], '$$SPICE'), symbolField(yellow,'$$SPICE'));
        const clipboard = updater.copy_tinycad_doc({ _selected_array: [symbols[1][1]._id] }, loaded.sheets[0], loaded.spiceModelPacks);
        assert.match(clipboard, /SPICE_MODEL_PACKS/);
        assert.match(clipboard, /circsim/);
        assert.doesNotMatch(clipboard, /openjellybean/);
        const pasted = updater.paste_tinycad_doc({}, blank().sheets[0], clipboard, [100, 100]);
        assert.equal(pasted.spiceModelPacks.length, 1);
        assert.equal(modelBinding(pasted.sheet.items[0]).modelId, 'LED_YELLOW');
        if (format === 'xml') {
          const pair = { symbols: symbols.slice(0,2), nets, labels: {'0':'D1_2', oj:'D1_1', led:'D2_1', sink:'D2_2'} };
          writeFileSync(${JSON.stringify(
            spiceFile,
          )}, writeSpiceWithModels(pair, loaded.spiceModelPacks) +
            '\\nIoj 0 oj 5m\\nIyellow 0 led 20m\\nVsink sink 0 0\\n.save v(oj) v(led)\\n.op\\n.end\\n');
          const amp = symbols[2][1];
          const copy = (ref, id) => ({ ...amp, _id: id, text: amp.text.map((field) =>
            field.description === 'Ref' ? { ...field, value: ref } : field) });
          const mixed = { ...loaded, sheets: [{ ...loaded.sheets[0], items: [amp, copy('U2', -200), copy('U3', -300)] }] };
          const firstCustom = changeSpiceModel(mixed, mixed.sheets[0].id, amp._id, 'custom');
          const bothCustom = changeSpiceModel(firstCustom, mixed.sheets[0].id, -200, 'custom');
          const [customAmp, otherAmp, bundledAmp] = bothCustom.sheets[0].items;
          assert.equal(modelBinding(customAmp), undefined);
          assert.equal(modelBinding(bundledAmp).modelId, 'LM741');
          const prologue = symbolField(customAmp, '$$SPICE_PROLOG');
          assert.match(prologue, /\\.subckt TC_CUSTOM_opamp_core_\\$\\(ref\\)/);
          assert.match(prologue, /\\.subckt TC_CUSTOM_LM741_\\$\\(ref\\)/);
          assert.doesNotMatch(prologue, /\\.model LED_YELLOW/);
          const edited = { ...customAmp, text: customAmp.text.map((field) =>
            field.description === '$$SPICE_PROLOG' ? { ...field, value: field.value.replace('vos=1e-3', 'vos=20e-3') } : field) };
          assert.notEqual(symbolField(edited, '$$SPICE_PROLOG'), prologue);
          assert.equal(symbolField(otherAmp, '$$SPICE_PROLOG'), prologue);
          const withEdits = { ...bothCustom, sheets: [{ ...bothCustom.sheets[0], items: [edited, otherAmp, bundledAmp] }] };
          const switched = changeSpiceModel(withEdits, mixed.sheets[0].id, amp._id, 'bundled');
          const reloaded = await decodeDrawing(await encodeDrawing(switched, 'zip-v1'));
          const restoredAmp = reloaded.sheets[0].items[0];
          assert.equal(modelBinding(restoredAmp).source.url, chosenOpamp.source.url);
          assert.deepEqual(modelBinding(restoredAmp).pins, ['3','2','6','7','4']);
          assert.equal(symbolField(restoredAmp, '$$SPICE_PROLOG'), undefined);
          const restoredCustom = changeSpiceModel(reloaded, reloaded.sheets[0].id, restoredAmp._id, 'custom');
          assert.equal(symbolField(restoredCustom.sheets[0].items[0], '$$SPICE_PROLOG'),
            symbolField(edited, '$$SPICE_PROLOG'));
          const inherited = bindSpiceModel(bundledAmp, select(chosenOpamp), true).symbol;
          const amps = [edited, otherAmp, inherited].map((item) => [sheet.name, item]);
          const terminals = (pin) => ['U1','U2','U3'].map((reference) => ({ reference, pin }));
          const ampNetlist = { symbols: amps, labels: { vin: 'in', vp: 'p', vn: 'n', out1:'1', out2:'2', out3:'3' },
            nets: { in: terminals('3'), p: terminals('7'), n: terminals('4'),
              ...Object.fromEntries(['U1','U2','U3'].map((reference, i) =>
                [String(i+1), ['2','6'].map(pin => ({ reference, pin }))])) } };
          const ampDeck = writeSpiceWithModels(ampNetlist);
          assert.deepEqual(Object.keys(prepareSpiceDeck(ampNetlist, defaultSetup()).files), [
            modelBinding(inherited).embeddedPack.filename,
          ]);
          assert.match(ampDeck, /\\.subckt TC_CUSTOM_LM741_U1/);
          assert.match(ampDeck, /\\.subckt TC_CUSTOM_LM741_U2/);
          assert.match(ampDeck, /\\.subckt LM741 /);
          assert.match(ampDeck, /^xa .*TC_CUSTOM_opamp_core_U1/im);
          writeFileSync(${JSON.stringify(customFile)}, ampDeck +
            '\\nVin vin 0 1\\nVp vp 0 15\\nVn vn 0 -15\\n.save v(out1) v(out2) v(out3)\\n.op\\n.end\\n');
        }
      }
    })();
  `,
      { bundlePackages: ['redux-undo'] },
    );
    if (ngspiceAvailable) {
      const result = runNgspice(spiceFile);
      assert.equal(result.status, 0, result.log);
      if (result.events) {
        const names = result.events.find(
          ({ type }) => type === 'vectors',
        ).names;
        const row = result.events.find(({ type }) => type === 'data').rows[0];
        assert.ok(Math.abs(row[names.indexOf('led')] - 2.1) < 0.01);
        assert.ok(Math.abs(row[names.indexOf('oj')] - 0.68) < 0.05);
      }
      const customResult = runNgspice(customFile);
      assert.equal(customResult.status, 0, customResult.log);
      if (customResult.events) {
        const names = customResult.events.find(({ type }) => type === 'vectors').names;
        const row = customResult.events.find(({ type }) => type === 'data').rows[0];
        assert.ok(Math.abs(row[names.indexOf('out1')] - 1.020) < 0.002);
        assert.ok(Math.abs(row[names.indexOf('out2')] - row[names.indexOf('out3')]) < 1e-8);
      }
    }
  } finally {
    await rm(spiceFile, { force: true });
    await rm(customFile, { force: true });
    await rmdir(folder);
  }
});
