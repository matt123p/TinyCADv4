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

test('generated polylines save every leg and native cleanup places branch dots without joining crossings',async()=>{
 const b=new api.LessonBuilder({id:'TEST',title:'Wire persistence',uuid:'test-wiring'},[]);
 b.wire([20,20],[80,20],[80,80],[20,80]);
 b.wire([50,20],[50,50]);
 b.wire([30,5],[30,35]); // An interior/interior crossing is not a junction.
 b.ground([20,80]);
 assert.equal(b.sheet.items.filter(i=>i.NodeName==='wire').length,5);
 assert.ok(b.sheet.items.filter(i=>i.NodeName==='wire').every(w=>w.d_points.length===2));
 b.sheet=api.prepareTeachingWiring(b.sheet);b.sync();
 const dots=b.sheet.items.filter(i=>i.NodeName==='junction');
 assert.ok(dots.some(j=>j.point[0]===50&&j.point[1]===20));
 assert.ok(!dots.some(j=>j.point[0]===30&&j.point[1]===20));
 for(const format of ['xml','zip-v1']){
  const loaded=await api.decodeDrawing(await api.encodeDrawing(b.drawing,format));
  api.validateTeachingRoundTrip(b.sheet,loaded.sheets[0]);
  assert.equal(api.wireCoverage(b.sheet),api.wireCoverage(loaded.sheets[0]));
 }
});

test('generator orients a reversed potentiometer and supply pins before wiring',()=>{
 // Synthetic pin geometry exercises all rotations/mirrors without altering a net.
 const turn=(r,p)=>{let [x,y]=p;if(r&4)x=-x;for(let i=0;i<(r&3);i++)[x,y]=[-y,x];return[x,y];};
 for(const id of ['potentiometer','supply-block']){
  const names=id==='potentiometer'?['END_A','END_B','WIPER']:['VCC','GND','OUT'];
  const entry={id,pins:names.map((name,i)=>({name,electrical_type:i<2?'power_input':'output',side:i===0?'top':i===1?'bottom':'right'}))};
  const ports=s=>Object.fromEntries(names.map((n,i)=>[n,turn(s.rotation,[[0,20],[0,-20],[20,0]][i])]));
  const result=api.orientTeachingSymbol({rotation:0},entry,ports),p=ports(result);
  assert.ok(p[names[0]][1]<p[names[1]][1]);
  assert.ok(p[names[2]][0]>p[names[0]][0]);
 }
});
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
  assert.equal(audited.svgSha256,digest(await read('bundled-examples/'+entry.preview.replace(/\.png$/,'.svg'))),scenario.id+': SVG changed since review');
  assert.equal(audited.drawingSha256,digest(await read('bundled-examples/'+entry.path)),scenario.id+': drawing changed since review');
  assert.deepEqual([...image.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.deepEqual([image.readUInt32BE(16),image.readUInt32BE(20)],[1800,1200],scenario.id+': complete preview canvas');
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
  assert.ok(circuit.items.filter(i=>i.NodeName==='wire').every(w=>w.d_points.length===2),scenario.id);
  const tidy=api.prepareTeachingWiring(circuit);
  const dots=s=>s.items.filter(i=>i.NodeName==='junction').map(i=>i.point.join(',')).sort();
  assert.deepEqual(dots(tidy),dots(circuit),scenario.id+': junctions already match editor cleanup');
  api.validateTeachingRoundTrip(circuit,(await api.decodeDrawing(await api.encodeDrawing(drawing,scenario.format==='dzn'?'zip-v1':'xml'))).sheets[0]);
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
 for(const id of ['G01','G02','A38','F11','A37','A33','S13']){const lesson=manifest.scenarios.find(s=>s.id===id);const checked=await api.inspectLesson(await read('bundled-examples/'+lesson.path));await fs.writeFile(path.join(root,'build/teaching-examples/decks',id+'.cir'),checked.deck);}
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
 const resistance=1.1e-6*.5/(Math.PI*.0003*.0003/4);
 assert.ok(Math.abs(solve('G01').values('out')[0]-5*2000/(2000+resistance))<1e-6,'wire-resistance loop includes its return');
 const series=solve('G02');
 assert.ok(Math.abs(series.values('n0')[0]-3.75)<1e-6&&Math.abs(series.values('n1')[0]-2.5)<1e-6,'complete series loop has the expected divider voltages');
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
