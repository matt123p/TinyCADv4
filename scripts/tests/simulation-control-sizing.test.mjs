import { test } from 'node:test';
import { runRegression } from './run-regression.mjs';

test('compact SPICE controls match library scale, expose their body to selection and retain legacy wiring', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { DocStoreReducer } from './src/state/stores/docStoreReducer';
    import { createControl } from './src/simulation/controlSymbols';
    import { readControl, defaultSource } from './src/simulation/controls';
    import { updateView } from './src/manipulators/updateView';
    import { updateSymbol } from './src/manipulators/updateSymbol';
    import { ioXML, blank } from './src/io/ioXml';
    import { XMLBuilder } from './src/util/xmlbuilder';
    import { NetlistWorkerState } from './src/web-worker/netlistState';
    import { buildDeck } from './src/simulation/deck';
    const previous=globalThis.document;
    globalThis.document={createElement:()=>({getContext:()=>({font:'',measureText:text=>({width:String(text).length*8,actualBoundingBoxDescent:3})})})};
    try {
      const drawing=blank();
      const source=createControl('source',drawing.sheets[0],drawing).symbol;
      const updater=new updateSymbol(source), bounds=updater.getBoundingRect();
      assert.equal(bounds.y2-bounds.y1,40,'source pin span is 8 mm rather than 32 mm');
      const reader=new XMLBuilder();reader.fromText(fs.readFileSync('scripts/tests/fixtures/simple-spice.dsn','utf8'));
      const reference=new ioXML().from_dsn(reader).sheets[0].items.find(i=>i.NodeName==='symbol' && i.text.some(f=>f.value==='R1'));
      const resistorPins=new updateSymbol(reference).active_points();
      assert.ok(40 <= Math.abs(resistorPins[0][1]-resistorPins[1][1])*1.25,'size is comparable to the supplied library resistor');
      const hit=updater.is_inside({dx:0,dy:0,dr:0},[(bounds.x1+bounds.x2)/2,(bounds.y1+bounds.y2)/2],false);
      assert.equal(hit.item,source,'clicking the empty body selects its settings');
      let state=DocStoreReducer(undefined,{type:'@@INIT'});
      state=DocStoreReducer(state,{type:'simulation/insert-control',tool:'source'});
      state=DocStoreReducer(state,{type:'simulation/configure-control',config:{...defaultSource(),waveform:'sine',amplitude:'2',frequency:'2kHz'}});
      assert.equal(readControl(state.view.add).waveform,'sine');
      assert.equal(readControl(state.view.add).amplitude,'2');
      state=DocStoreReducer(state,{type:'simulation/control-reference',value:'Vdrive'});
      assert.equal(state.view.add.text.find(f=>f.description==='Ref').value,'Vdrive');
      assert.match(state.view.add.text.find(f=>f.description==='$$SPICE').value,/SIN\(0 2 2000/);
      const placed=new updateView().click_add(state.view,state.drawing.sheets[0],[100,100]);
      assert.equal(readControl(placed.sheet.items.at(-1)).amplitude,'2');

      const xml=new XMLBuilder();xml.fromText(fs.readFileSync('scripts/tests/fixtures/legacy-simulation-controls.dsn','utf8'));
      const legacy=new ioXML().from_dsn(xml);
      const oldSource=legacy.sheets[0].items.find(i=>i.NodeName==='symbol' && readControl(i)?.kind==='source');
      const setup=legacy.sheets.find(s=>s.kind==='simulation').simulation;
      const beforeDeck=buildDeck(new NetlistWorkerState().init(legacy),setup);
      const beforePin=new updateSymbol(oldSource).active_points()[0].slice(0,2);
      state={...state,drawing:legacy,view:{...state.view,selected_sheet:0,_selected_array:[oldSource._id],add:null}};
      state=DocStoreReducer(state,{type:'simulation/compact-control'});
      const resized=state.drawing.sheets[0].items.find(i=>i._id===oldSource._id);
      const afterBounds=new updateSymbol(resized).getBoundingRect();
      assert.equal(afterBounds.y2-afterBounds.y1,40);
      assert.deepEqual(new updateSymbol(resized).active_points()[0].slice(0,2),beforePin);
      assert.equal(buildDeck(new NetlistWorkerState().init(state.drawing),setup),beforeDeck,'compact conversion preserves the electrical circuit');
      assert.ok(resized._symbol.uid.endsWith('-v2'));
    } finally {globalThis.document=previous;}
  `);
});
