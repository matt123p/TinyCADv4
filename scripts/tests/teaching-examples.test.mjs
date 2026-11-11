import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {parseExampleCatalog,exampleResourcePaths} from '../../shared/bundledExamples.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=relative=>fs.readFile(path.join(root,relative));
const json=async relative=>JSON.parse(await read(relative));
const curriculum=await json('docs/symbol-libraries/library-manifest.json');
const manifest=await json('bundled-examples/teaching/manifest.json');
// Generation also bundles the real codec/netlist/renderer for use under Node.
execFileSync(process.execPath,['scripts/generate-teaching-examples.mjs','--compile-only'],{cwd:root,stdio:'pipe'});
const api=createRequire(import.meta.url)(path.join(root,'build/teaching-examples/generator.cjs'));api.initialiseGenerator();
test('every curriculum activity has one browsable teaching drawing and readable resources',async()=>{
 const expected=curriculum.libraries.flatMap(c=>c.experiments.map(e=>c.library_id+'/'+e.id));
 assert.equal(expected.length,214);
 assert.deepEqual(manifest.scenarios.map(s=>s.course+'/'+s.id),expected);
 assert.equal(new Set(manifest.scenarios.map(s=>s.path)).size,214);
 const review=await json('bundled-examples/teaching/review.json');
 assert.equal(review.scenarios.length,214);
 const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
 const catalog=parseExampleCatalog(await json('bundled-examples/config.json'));
 for(const scenario of manifest.scenarios){
  const entry=catalog.groups.find(g=>g.id===scenario.course)?.examples.find(e=>e.id===scenario.id);
  assert.equal(entry?.path,scenario.path);
  const image=await read('bundled-examples/'+entry.preview);
  const audited=review.scenarios.find(s=>s.id===scenario.id);
  assert.equal(audited.visualReview,'inspected');
  assert.equal(audited.previewSha256,digest(image),scenario.id+': preview changed since review');
  assert.equal(audited.drawingSha256,digest(await read('bundled-examples/'+entry.path)),scenario.id+': drawing changed since review');
  assert.deepEqual([...image.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.match((await read('bundled-examples/'+entry.descriptionPath)).toString(),/Your investigation/);
 }
 for(const resource of exampleResourcePaths(catalog))assert.ok((await fs.stat(path.join(root,'bundled-examples',resource))).isFile(),resource);
});
test('saved files reopen with student Markdown and simulation setups, or plain connection plans',async()=>{
 let simulations=0,diagrams=0;
 for(const scenario of manifest.scenarios){
  const bytes=await read('bundled-examples/'+scenario.path);
  const drawing=await api.decodeDrawing(bytes);
  const circuit=drawing.sheets.find(s=>s.kind!=='simulation');
  const text=circuit.items.filter(i=>i.NodeName==='text');
  assert.equal(text.length,2,scenario.id);
  assert.ok(text.some(t=>t.text.includes('### Your investigation')&&t.text.includes('### Getting started')),scenario.id);
  assert.ok(text.some(t=>t.text.includes(scenario.title)),scenario.id);
  const checked=await api.inspectLesson(bytes);
  if(scenario.format==='dzn'){
   simulations++;assert.ok(checked.simulation,scenario.id);
   const simulation=drawing.sheets.find(s=>s.kind==='simulation').simulation;
   assert.ok(simulation.signals.length,scenario.id);
   assert.equal(simulation.analysis.kind,scenario.simulation.kind);
   assert.match(checked.deck,/\.end\s*$/i);
  }else{
   diagrams++;assert.equal(checked.simulation,false,scenario.id);
   assert.equal(drawing.sheets.length,1,scenario.id);
   assert.ok(!circuit.items.some(i=>i.NodeName==='symbol'&&i.text.some(t=>t.description.startsWith('$$SPICE'))),scenario.id);
  }
 }
 assert.equal(simulations,201);assert.equal(diagrams,13);
});

test('feedback lessons reach the end and produce the intended observable behaviour',async t=>{
 const {runNgspice,ngspiceAvailable,ngspiceBackend}=await import('./ngspice-runner.mjs');
 if(!ngspiceAvailable||ngspiceBackend==='CLI override'){t.skip('Build the native engine for numerical lesson checks');return;}
 await fs.mkdir(path.join(root,'build/teaching-examples/decks'),{recursive:true});
 for(const id of ['A38','F11','A37','A33','S13']){const lesson=manifest.scenarios.find(s=>s.id===id);const checked=await api.inspectLesson(await read('bundled-examples/'+lesson.path));await fs.writeFile(path.join(root,'build/teaching-examples/decks',id+'.cir'),checked.deck);}
 function solve(id){
  const result=runNgspice(path.join(root,'build/teaching-examples/decks',id+'.cir'));
  assert.equal(result.status,0,id);
  assert.doesNotMatch(result.log,/timestep too small|doanalyses:|simulation interrupted/i,id);
  const names=result.events.find(e=>e.type==='vectors').names;
  const rows=result.events.filter(e=>e.type==='data').flatMap(e=>e.rows);
  const values=name=>{const index=names.indexOf(name);assert.ok(index>=0,id+': '+name);return rows.map(r=>r[index]);};
  const time=names.includes('time')?values('time'):[];
  return{values,time};
 }
 const astable=solve('A38'),astableOut=astable.values('out');
 assert.ok(astable.time.at(-1)>=.008*(1-1e-8));
 assert.ok(astableOut.filter((v,i)=>i&&v>2.5&&astableOut[i-1]<=2.5).length>=3,'555 must keep oscillating');
 const mono=solve('F11'),out=mono.values('out');
 const rise=out.findIndex((v,i)=>i&&v>2.5&&out[i-1]<=2.5),fall=out.findIndex((v,i)=>i>rise&&v<=2.5&&out[i-1]>2.5);
 assert.ok(mono.time.at(-1)>=.008*(1-1e-8));
 assert.ok(Math.abs((mono.time[fall]-mono.time[rise])-.0011)<.00005,'monostable width ≈ 1.1 RC');
 const modulo=solve('A37');assert.ok(modulo.time.at(-1)>=85e-6*(1-1e-8));
 const bits=[0,1,2].map(i=>modulo.values('u1_q'+i));
 const countAt=time=>{const i=modulo.time.findIndex(t=>t>=time);return bits.reduce((n,b,k)=>n+(b[i]>2.5?2**k:0),0);};
 assert.deepEqual(Array.from({length:8},(_,i)=>countAt(i*10e-6+5e-6)),[1,2,3,4,0,1,2,3]);
 const adc=solve('A33');assert.ok(adc.time.at(-1)>=.02*(1-1e-8));
 assert.ok(Math.max(...adc.values('out'))>4&&Math.max(...adc.values('out'))<4.7);
 const bridge=solve('S13');const v=bridge.values('out')[0];assert.ok(v<-.01&&v>-.014,'unbalanced bridge amplified with the expected polarity');
});

test('native bridge reports a transient convergence abort as failed',async t=>{
 const {runNgspice,ngspiceAvailable,ngspiceBackend}=await import('./ngspice-runner.mjs');
 if(!ngspiceAvailable||ngspiceBackend==='CLI override'){t.skip('Requires the bundled native bridge');return;}
 // Remove comparator response from a known feedback circuit to reproduce the
 // threshold chatter. ngSpice_Command returns zero even though TRAN aborts.
 const file=path.join(root,'build/teaching-examples/decks/known-bad-timer.cir');
 const lesson=manifest.scenarios.find(s=>s.id==='A38');
 await fs.mkdir(path.dirname(file),{recursive:true});
 const deck=(await api.inspectLesson(await read('bundled-examples/'+lesson.path))).deck
  .replace(/^[RC]U1_(?:reset|set)_delay .*\n/gm,'')
  .replaceAll('_U1_reset_raw','_U1_reset').replaceAll('_U1_set_raw','_U1_set');
 await fs.writeFile(file,deck);
 const result=runNgspice(file);
 assert.notEqual(result.status,0);
 assert.match(result.log,/timestep too small|aborted/i);
 assert.equal(result.events.filter(e=>e.type==='finished').at(-1).state,'failed');
});
