import { test } from 'node:test';
import { runRegression } from './run-regression.mjs';

test('teaching drawings reopen as configured shared circuits and produce the expected native measurements', async () => {
  await runRegression(String.raw`
  import assert from 'node:assert/strict';
  import fs from 'node:fs';
  import path from 'node:path';
  import os from 'node:os';
  import { spawnSync } from 'node:child_process';
  import { teachingExamples } from './src/simulation/examples';
  import { decodeDrawing } from './src/io/dsnCodec';
  import { drawingSaveFormat } from './src/io/drawingSaveFormat';
  import { NetlistWorkerState } from './src/web-worker/netlistState';
  import { buildDeck } from './src/simulation/deck';
  import { checkSpiceComponents } from './src/simulation/diagnostics';
  import { readControl, probeResult, compileSource } from './src/simulation/controls';
  import { vectorUnit } from './src/simulation/resultStore';
  async function verifyExamples() {
  const previousDocument=globalThis.document;
  globalThis.document={createElement:()=>({getContext:()=>({font:'',measureText:text=>({width:String(text).length*8,actualBoundingBoxDescent:3})})})};
  const runtime=path.resolve('build/engines/native');
  const manifest=fs.existsSync(path.join(runtime,'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(runtime,'manifest.json'),'utf8')) : undefined;
  try {
   for(const name of teachingExamples){
    const drawing=await decodeDrawing(fs.readFileSync('examples/simulation/'+name+'.dzn'));
    assert.equal(drawing.representation,'zip-v1');
    assert.equal(drawingSaveFormat(drawing),'zip-v1');
    assert.equal(drawing.sheets.length,2);
    const simulation=drawing.sheets.find(sheet=>sheet.kind==='simulation');
    assert.ok(simulation.simulation.instructions);
    const net=new NetlistWorkerState().init({...drawing,sheets:drawing.sheets.filter(sheet=>sheet.kind!=='simulation')});
    assert.equal(net.symbols.length,6);
    assert.equal(simulation.simulation.runs.length,0);
    const controls=net.symbols.map(([,symbol])=>({symbol,control:readControl(symbol)})).filter(entry=>entry.control);
    const source=controls.find(entry=>entry.control.kind==='source');
    assert.equal(source.control.waveform,name==='rc-charging'?'pulse':'dc');
    assert.equal(source.control.dc,name==='voltage-divider'?'5':'0');
    assert.equal(source.control.acMagnitude,name==='rc-low-pass'?'1':'0');
    assert.equal(controls.filter(entry=>entry.control.kind==='probe').length,3);
    assert.equal(controls.filter(entry=>entry.control.kind==='probe' && entry.control.mode==='current').length,1);
    assert.ok(drawing.sheets[0].items.some(item=>item.NodeName==='power' && item.which===4 && item.text==='0'));
    assert.ok(simulation.simulation.signals.includes('vp1#branch'));
    assert.deepEqual(checkSpiceComponents(net,simulation.simulation),[]);
    const deck=buildDeck(net,simulation.simulation);
    assert.ok(!deck.includes('NO_MODEL'));
    if(!manifest) continue;
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tinycad-example-'));
    try{
     const file=path.join(directory,'example.cir');fs.writeFileSync(file,deck);
     const result=spawnSync(path.join(runtime,manifest.helper),[path.join(runtime,manifest.library),file,...manifest.modules.map(module=>path.join(runtime,module))],{cwd:directory,encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});
     assert.equal(result.status,0,name+': '+result.stderr+' '+result.stdout);
     const events=result.stdout.trim().split('\n').map(line=>JSON.parse(line));
     assert.equal(events.at(-1).state,'complete',name);
     const names=events.find(event=>event.type==='vectors').names;
     const data=events.filter(event=>event.type==='data');const rows=data.flatMap(event=>event.rows);
     const imaginary=data.flatMap(event=>event.imaginary || []);
     const recorded={scale:names.includes('time')?'time':names.includes('frequency')?'frequency':'',log:'',
       vectors:names.map((name,index)=>({name,unit:vectorUnit(name),real:rows.map(row=>row[index]),
         imaginary:imaginary.length?imaginary.map(row=>row[index]):undefined}))};
     for(const {symbol,control} of controls.filter(entry=>entry.control.kind==='probe')){
      const measured=probeResult(net,symbol,recorded).vectors.at(-1);
      const ref=symbol.text.find(field=>field.description==='Ref').value;
      const expected=recorded.vectors.find(vector=>vector.name===(ref==='PR1'?'in':ref==='PR2'?'out':'vp1#branch'));
      assert.deepEqual(measured.real,expected.real,name+': '+ref+' must measure its connected signal');
      if(expected.imaginary) assert.deepEqual(measured.imaginary,expected.imaginary);
     }
     const out=names.indexOf('out');assert.ok(out>=0,name+': OUT must be recorded');
     if(name==='voltage-divider'){
      assert.ok(Math.abs(rows[0][out]-2.5)<1e-9);
      assert.ok(Math.abs(rows[0][names.indexOf('v1#branch')]+0.0025)<1e-9);
      assert.ok(Math.abs(rows[0][names.indexOf('vp1#branch')]-0.0025)<1e-9);
     } else if(name==='rc-charging'){
      const time=names.indexOf('time');const at=rows.reduce((a,b)=>Math.abs(a[time]-.001)<Math.abs(b[time]-.001)?a:b);
      assert.ok(Math.abs(at[out]-(1-Math.exp(-at[time]/.001)))<.005);
      const preview=compileSource(source.control);
      for(const row of rows) assert.ok(Math.abs(row[names.indexOf('in')]-preview.value(row[time]))<1e-9);
     } else {
      const frequency=names.indexOf('frequency');const index=rows.reduce((best,row,i)=>Math.abs(row[frequency]-159.154943)<Math.abs(rows[best][frequency]-159.154943)?i:best,0);
      assert.ok(Math.abs(Math.hypot(rows[index][out],imaginary[index][out])-Math.SQRT1_2)<.01);
     }
    } finally {fs.rmSync(directory,{recursive:true,force:true});}
   }
  } finally {globalThis.document=previousDocument;}
  }
  module.exports=verifyExamples();
 `);
});
