import { test } from 'node:test';
import { runRegression } from './run-regression.mjs';

test('SPICE controls place, configure, validate and round-trip with their embedded definitions', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import { DocStoreReducer } from './src/state/stores/docStoreReducer';
    import { updateView } from './src/manipulators/updateView';
    import { updateSymbol } from './src/manipulators/updateSymbol';
    import { readControl, controlTemplate, defaultSource, compileSource, sourcePreview, probeResult } from './src/simulation/controls';
    import { createControl } from './src/simulation/controlSymbols';
    import { checkSpiceComponents } from './src/simulation/diagnostics';
    import { defaultSetup } from './src/simulation/contracts';
    import { ioXML } from './src/io/ioXml';
    import { XMLBuilder } from './src/util/xmlbuilder';
    import { NetlistWorkerState } from './src/web-worker/netlistState';
    import { createTeachingDrawing } from './src/simulation/examples';
    import { buildDeck } from './src/simulation/deck';
    const before = globalThis.document;
    globalThis.document={createElement:()=>({getContext:()=>({font:'',measureText:text=>({width:String(text).length*8,actualBoundingBoxDescent:3})})})};
    try {
      let state = DocStoreReducer(undefined,{type:'@@INIT'});
      const place = (tool, point) => {
        state = DocStoreReducer(state,{type:'simulation/insert-control',tool});
        const target = state.drawing.sheets[state.view.selected_sheet];
        const moved = new updateView().mousemove_add(state.view,target,point);
        assert.equal(moved.view.display_add,true,tool);
        const placed = new updateView().click_add(moved.view,moved.sheet,point);
        state = {...state,view:placed.view,drawing:{...state.drawing,sheets:state.drawing.sheets.map(s=>s===target?placed.sheet:s)}};
        return placed.sheet.items.at(-1);
      };
      const source = place('source',[100,100]);
      assert.equal(readControl(source).kind,'source');
      assert.equal(source.text.find(f=>f.description==='Ref').value,'V1');
      assert.equal(new updateSymbol(source).active_points().find(p=>p[2].number==='1')[0],100);
      const sourceBounds = new updateSymbol(source).getBoundingRect();
      assert.ok(sourceBounds.x1 <= 100 && sourceBounds.x2 >= 100 && sourceBounds.y1 <= 180 && sourceBounds.y2 >= 180,
        'the visible source body must lie inside its selection bounds');
      assert.deepEqual(state.view._selected_array,[source._id]);
      state = DocStoreReducer(state,{type:'simulation/configure-control',config:{...defaultSource(),type:'current',waveform:'sine'}});
      const current = state.drawing.sheets[0].items.at(-1);
      assert.equal(current.text.find(f=>f.description==='Ref').value,'I1');
      assert.match(current.text.find(f=>f.description==='$$SPICE').value,/SIN\(/);
      const probe = place('probe',[300,100]);
      assert.equal(readControl(probe).mode,'voltage');
      assert.equal(new updateSymbol(probe).active_points().length,1);
      const differential = place('differential-probe',[500,100]);
      assert.equal(readControl(differential).mode,'differential');
      const ammeter = place('current-probe',[700,100]);
      assert.match(ammeter.text.find(f=>f.description==='Ref').value,/^VP/);
      assert.match(controlTemplate(readControl(ammeter)),/DC 0/);
      const controlled = place('controlled',[900,100]);
      assert.equal(new updateSymbol(controlled).active_points().length,4);
      const ground = place('ground',[100,100]);
      assert.equal(ground.which,4);assert.equal(ground.text,'0');
      state = DocStoreReducer(state,{type:'simulation/add',name:'Test'});
      place('source',[1100,100]);
      assert.equal(state.view.selected_sheet,0,'insertion from simulation selects the schematic');
      const xml = new XMLBuilder();xml.fromText(new ioXML().to_dsn(state.drawing,true,true).tostring());
      const reopened = new ioXML().from_dsn(xml);
      const symbols = reopened.sheets[0].items.filter(i=>i.NodeName==='symbol');
      assert.equal(symbols.length,6);
      assert.deepEqual(symbols.map(readControl).map(c=>c.kind),['source','probe','probe','probe','controlled','source']);
      assert.equal(readControl(symbols[0]).type,'current');
      assert.deepEqual(new updateSymbol(symbols[0]).getBoundingRect(),new updateSymbol(current).getBoundingRect());
      assert.deepEqual(new updateSymbol(symbols[0]).active_points().map(p=>p.slice(0,2)),new updateSymbol(current).active_points().map(p=>p.slice(0,2)));
      const source2 = symbols.at(-1);
      const broken={...defaultSource(),period:'1ms',waveform:'pulse',width:'2ms'};
      assert.throws(()=>controlTemplate(broken),/period/);
      const invalid = {...source2,text:source2.text.map(f=>f.description==='$$SPICE_CONTROL'?{...f,value:JSON.stringify(broken)}:f)};
      const net={symbols:[['Circuit',invalid]],nets:{},nodes:{},labels:{},eprops:{}};
      assert.match(checkSpiceComponents(net,defaultSetup())[0].text,/period/);

      // Match recorded node and branch vectors without loading the circuit.
      const reference = p => p.text.find(f=>f.description==='Ref').value;
      const node = (p,pin)=>({reference:reference(p),pin});
      const probes={symbols:[],nets:{'1':[node(probe,'1'),node(differential,'1')],'2':[node(differential,'2')]},nodes:{},labels:{OUT:'1',IN:'2'},eprops:{}};
      const data={scale:'time',log:'',vectors:[{name:'time',unit:'s',real:[0,1]},{name:'out',unit:'V',real:[2,3],imaginary:[1,2]},
        {name:'in',unit:'V',real:[1,1],imaginary:[.5,.5]},{name:reference(ammeter).toLowerCase()+'#branch',unit:'A',real:[.01,.02]}]};
      assert.deepEqual(probeResult(probes,probe,data).vectors.at(-1).real,[2,3]);
      assert.deepEqual(probeResult(probes,differential,data).vectors.at(-1).real,[1,2]);
      assert.deepEqual(probeResult(probes,differential,data).vectors.at(-1).imaginary,[.5,1.5]);
      assert.deepEqual(probeResult(probes,ammeter,data).vectors.at(-1).real,[.01,.02]);
      const inverted={...ammeter,text:ammeter.text.map(f=>f.description==='$$SPICE_CONTROL'?{...f,value:JSON.stringify({...readControl(ammeter),invert:true})}:f)};
      assert.deepEqual(probeResult(probes,inverted,data).vectors.at(-1).real,[-.01,-.02]);
      assert.equal(probeResult({...probes,labels:{}},probe,data),undefined);
      // Ground must win over other labels assigned to the same net.
      assert.deepEqual(probeResult({...probes,labels:{OUT:'1','0':'1',IN:'2'}},probe,data).vectors.at(-1).real,[0,0]);
      for (const waveform of ['dc','sine','pulse','triangle','pwl','exponential','fm']) {
        const c={...defaultSource(),waveform};
        const compiled=compileSource(c), preview=sourcePreview(c);
        assert.ok(preview.vectors[1].real.every(Number.isFinite),waveform);
        assert.equal(preview.vectors[1].real[0],compiled.value(0));
      }
      assert.throws(()=>compileSource({...defaultSource(),waveform:'pwl',points:'1ms 0 0 1'}),/increase/);
      assert.throws(()=>compileSource({...defaultSource(),frequency:'0',waveform:'sine'}),/greater/);

      // Dropping a probe or ground on a wire splits it and joins the actual net.
      let connected=DocStoreReducer(undefined,{type:'@@INIT'});
      const wire={NodeName:'wire',_id:900001,d_points:[[0,0],[1000,0]],_magnetic:null};
      connected={...connected,drawing:{...connected.drawing,sheets:[{...connected.drawing.sheets[0],items:[wire]}]}};
      const drop=(tool,point)=>{
        connected=DocStoreReducer(connected,{type:'simulation/insert-control',tool});
        const placed=new updateView().click_add(connected.view,connected.drawing.sheets[0],point);
        connected={...connected,view:placed.view,drawing:{...connected.drawing,sheets:[placed.sheet]}};
        return placed.sheet.items.find(i=>i._id===placed.view._selected_array[0]);
      };
      const wireProbe=drop('probe',[500,0]);
      assert.equal(connected.drawing.sheets[0].items.filter(i=>i.NodeName==='wire').length,2);
      drop('ground',[750,0]);
      const joined=new NetlistWorkerState().init(connected.drawing);
      const recorded={scale:'time',log:'',vectors:[{name:'time',unit:'s',real:[0,1]}]};
      assert.deepEqual(probeResult(joined,wireProbe,recorded).vectors.at(-1).real,[0,0]);

      // Editing a copied source cannot replace the original source's artwork.
      const original=connected.drawing.sheets[0];
      const created=createControl('source',original,connected.drawing);
      const twin={...created.symbol,_id:900002,point:[400,400]};
      connected={...connected,view:{...connected.view,_selected_array:[twin._id]},drawing:{...connected.drawing,
        sheets:[{...created.sheet,items:[...created.sheet.items,created.symbol,twin]}]}};
      connected=DocStoreReducer(connected,{type:'simulation/configure-control',config:{...defaultSource(),type:'current'}});
      const copies=connected.drawing.sheets[0].items.filter(i=>i._id===twin._id || i._id===created.symbol._id);
      assert.notEqual(copies[0]._symbol.id,copies[1]._symbol.id);
      assert.equal(readControl(copies[0]).type,'voltage');assert.equal(readControl(copies[1]).type,'current');

      // A voltage probe added after acquisition must be able to read that run.
      const example=createTeachingDrawing('voltage-divider');
      const setup=example.sheets.find(s=>s.kind==='simulation').simulation;
      const originalDeck=buildDeck(new NetlistWorkerState().init(example),setup);
      const output=example.sheets[0].items.find(i=>i.NodeName==='label' && i.text.toLowerCase()==='out');
      assert.ok(output);
      let measured=DocStoreReducer({...connected,drawing:example,view:{...connected.view,selected_sheet:0}},
        {type:'simulation/insert-control',tool:'probe'});
      const placed=new updateView().click_add(measured.view,measured.drawing.sheets[0],output.point);
      const probed={...measured.drawing,sheets:[placed.sheet,...measured.drawing.sheets.slice(1)]};
      assert.deepEqual(checkSpiceComponents(new NetlistWorkerState().init(probed),setup),[]);
      assert.equal(buildDeck(new NetlistWorkerState().init(probed),setup),originalDeck,
        'adding a non-loading probe preserves the circuit fingerprint');
    } finally {globalThis.document=before;}
  `);
});
