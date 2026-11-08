import { test } from 'node:test';
import { runRegression } from './run-regression.mjs';

test('named metrics use time-weighted windows, explicit timing semantics and complex gain with typed failures', async () => {
 await runRegression(String.raw`
 import assert from 'node:assert/strict';
 import { measure, checkRequirement } from './src/simulation/metrics';
 const data={scale:'time',log:'',vectors:[{name:'time',unit:'s',real:[0,.1,1]},{name:'out',unit:'V',real:[0,.1,1]}]};
 const m=(kind,extra={},source=data)=>measure({id:'m',name:'Test',source:'OUT',kind,...extra},source);
 const near=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<tolerance,a+' != '+b);
 near(m('mean').value,.5);near(m('rms').value,Math.sqrt(1/3));near(m('mean',{from:'.2s',to:'.8s'}).value,.5);
 near(m('rippleRms').value,Math.sqrt(1/12));near(m('integral').value,.5);near(m('value',{at:'.25s'}).value,.25);
 near(m('riseTime',{initial:'0V',final:'1V'}).value,.8);assert.equal(m('riseTime').state,'unavailable');
 assert.equal(m('value',{at:'2s'}).state,'unavailable');assert.equal(m('mean',{from:'1',to:'.1'}).state,'unavailable');
 assert.equal(m('value',{source:'missing'}).state,'unavailable');assert.equal(m('mean',{},undefined).state,'valid');
 const pulse={scale:'time',log:'',vectors:[{name:'time',unit:'s',real:[0,1,2,3,4,5,6]},{name:'out',unit:'V',real:[0,0,1,1,0,0,1]}]};
 near(m('period',{},pulse).value,4);near(m('frequency',{},pulse).value,.25);near(m('dutyCycle',{},pulse).value,50);near(m('pulseWidth',{},pulse).value,2);
 const falling={...data,vectors:[data.vectors[0],{name:'out',unit:'V',real:[1,.9,0]}]};
 near(m('fallTime',{initial:'0',final:'1'},falling).value,.8);
 const step={scale:'time',log:'',vectors:[{name:'time',unit:'s',real:Array.from({length:1001},(_,i)=>i/100)},{name:'out',unit:'V',real:Array.from({length:1001},(_,i)=>1-Math.exp(-i/100))}]};
 near(m('timeConstant',{initial:'0',final:'1'},step).value,1,1e-6);near(m('settlingTime',{initial:'0',final:'1',tolerance:'2'},step).value,-Math.log(.02),.0001);
 assert.equal(m('settlingTime',{initial:'0',final:'2'},step).state,'unavailable');
 const frequency=Array.from({length:401},(_,i)=>100*10**(i/100)),rc=1/(2*Math.PI*159.154943);
 const ac={scale:'frequency',log:'',vectors:[{name:'frequency',unit:'Hz',real:frequency},{name:'in',unit:'V',real:frequency.map(()=>1)},{name:'out',unit:'V',real:frequency.map(f=>1/(1+(2*Math.PI*f*rc)**2)),imaginary:frequency.map(f=>-(2*Math.PI*f*rc)/(1+(2*Math.PI*f*rc)**2))}]};
 near(m('cutoff',{reference:'in',referenceGain:'1'},ac).value,159.154943,.03);
 near(m('gain',{reference:'in',at:'159.154943Hz'},ac).value,Math.SQRT1_2,.0001);near(m('phase',{reference:'in',at:'159.154943Hz'},ac).value,-45,.005);
 assert.equal(m('rms',{},ac).state,'unavailable');assert.equal(m('bandwidth',{reference:'in'},ac).state,'unavailable');
 const bandpass={...ac,vectors:[ac.vectors[0],ac.vectors[1],{name:'out',unit:'V',real:frequency.map(f=>{const w=f/1000;return w*w/((1-w*w)**2+w*w);}),imaginary:frequency.map(f=>{const w=f/1000;return w*(1-w*w)/((1-w*w)**2+w*w);})}]};
 near(m('bandwidth',{reference:'in',referenceGain:'peak'},bandpass).value,1000,.5);near(m('resonance',{reference:'in'},bandpass).value,1000,.01);
 const excursion={scale:'time',log:'',vectors:[{name:'time',unit:'s',real:[0,1,2,3]},{name:'out',unit:'V',real:[0,-.1,1.1,1]}]};
 near(m('overshoot',{initial:'0',final:'1'},excursion).value,10);near(m('undershoot',{initial:'0',final:'1'},excursion).value,10);
 assert.equal(checkRequirement({id:'duty',name:'Duty',measurement:'m',comparison:'between',lower:'45%',upper:'55%',unit:'%'},[m('dutyCycle',{},pulse)]).state,'pass');
 const result=m('rms');
 const rule={id:'rule',name:'RMS',measurement:'m',comparison:'between',lower:'.5V',upper:'.6V',unit:'V'};
 assert.equal(checkRequirement(rule,[result]).state,'pass');assert.equal(checkRequirement({...rule,upper:'.55'},[result]).state,'fail');
 assert.equal(checkRequirement({...rule,unit:'A'},[result]).state,'unavailable');assert.equal(checkRequirement(rule,[]).state,'unavailable');
 const broken={...data,vectors:[{...data.vectors[0],real:[0,0,1]},data.vectors[1]]};assert.equal(m('mean',{},broken).state,'unavailable');
 `);
});

test('bindings preserve original values, support source/model properties and preferred series, and validate saved definitions', async () => {
 await runRegression(String.raw`
 import assert from 'node:assert/strict';
 import { createTeachingDrawing } from './src/simulation/examples';
 import { applyBindings, bindingValue, preferredValue, sweepValues } from './src/simulation/bindings';
 import { readControl } from './src/simulation/controls';
 import { validateSetup } from './src/simulation/document';
 import { defaultSetup } from './src/simulation/contracts';
 import { DocStoreReducer } from './src/state/stores/docStoreReducer';
 globalThis.document={createElement:()=>({getContext:()=>({font:'',measureText:text=>({width:String(text).length*8,actualBoundingBoxDescent:3})})})};
 const drawing=createTeachingDrawing('rc-low-pass'),sheet=drawing.sheets[0],setup=drawing.sheets[1].simulation;
 const b={id:'r',name:'R1 Value',sheet:sheet.id,reference:'r1',property:'value',unit:'Ohm',minimum:'100',maximum:'10k',logarithmic:true,series:'continuous'};
 setup.bindings=[b];
 const before=JSON.stringify(drawing);const changed=applyBindings(drawing,setup,{r:'2.2kOhm'});
 assert.equal(bindingValue(changed.drawing,setup,b),'2200');assert.equal(bindingValue(drawing,setup,b),'1k');assert.equal(JSON.stringify(drawing),before);
 const initial=DocStoreReducer(undefined,{type:'@@INIT'}),state={...initial,drawing};
 const applied=DocStoreReducer(state,{type:'simulation/apply-tuning',sheetId:drawing.sheets[1].id,overrides:{r:'3.3k'}});
 assert.equal(bindingValue(applied.drawing,setup,b),'3300');assert.equal(bindingValue(state.drawing,setup,b),'1k');
 const source={...b,id:'v',reference:'V1',property:'source:acMagnitude',unit:'V'};
 const sourceSetup={...setup,bindings:[source]};const tuned=applyBindings(drawing,sourceSetup,{v:'2V'});
 assert.equal(bindingValue(tuned.drawing,tuned.setup,source),'2');assert.equal(bindingValue(drawing,sourceSetup,source),'1');
 const parameter={...b,id:'p',sheet:'$parameter',property:'gain',reference:'',unit:''};
 assert.equal(applyBindings(drawing,{...setup,parameters:{gain:'3'},bindings:[parameter]},{p:'4'}).setup.parameters.gain,'4');
 assert.throws(()=>applyBindings(drawing,setup,{missing:'2'}));assert.throws(()=>applyBindings(drawing,{...setup,bindings:[{...b,reference:'R99'}]},{r:'2'}));
 assert.equal(preferredValue(2650,'E12'),2700);assert.equal(preferredValue(1060,'E96'),1070);assert.equal(preferredValue(2410,'E24'),2400);
 assert.deepEqual(sweepValues({binding:'r',mode:'list',start:'',stop:'',count:5,values:'1k 2.2k 4.7k 6.8k 10k'},b),[1000,2200,4700,6800,10000]);
 const log=sweepValues({binding:'r',mode:'log',start:'1k',stop:'10k',count:3,values:''},b);assert.ok(Math.abs(log[1]-Math.sqrt(1e7))<1e-9);
 assert.throws(()=>sweepValues({mode:'linear',start:'0',stop:'1',count:101},b));
 assert.throws(()=>validateSetup({...defaultSetup(),measurements:[{id:'bad',kind:'eval',source:'out',name:'Bad'}]}));
 assert.throws(()=>validateSetup({...defaultSetup(),bindings:[{...b,series:'E999'}]}));
 `);
});

test('native RC sweeps capture reproducible cutoff measurements, cache runs, retain originals and round-trip requirements', async () => {
 await runRegression(String.raw`
 import assert from 'node:assert/strict';
 import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import { spawn } from 'node:child_process';
 import { createTeachingDrawing } from './src/simulation/examples';
 import { exploreOnce, runSweep, restoredSweep } from './src/simulation/exploration';
 import { bindingValue } from './src/simulation/bindings';
 import { getResult } from './src/simulation/resultStore';
 import { encodeDrawing, decodeDrawing } from './src/io/dsnCodec';
 import { NetlistWorkerState } from './src/web-worker/netlistState';
 import { operatingAnnotations } from './src/simulation/operatingPoint';
 import { measure } from './src/simulation/metrics';
 import { resolvedSignals, deviceSignal } from './src/simulation/signals';
 async function verify(){
  const previousDocument=globalThis.document,previousWindow=globalThis.window,previousTarget=process.env.TARGET_SYSTEM;
  process.env.TARGET_SYSTEM='electron';globalThis.document={createElement:()=>({getContext:()=>({font:'',measureText:text=>({width:String(text).length*8,actualBoundingBoxDescent:3})})})};
  const runtime=path.resolve('build/engines/native'),manifest=JSON.parse(fs.readFileSync(path.join(runtime,'manifest.json'),'utf8'));
  const listeners=new Set();const jobs=new Map();let starts=0;
  globalThis.window={electronAPI:{onSimulation:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},stopSimulation:id=>jobs.get(id)?.kill(),startSimulation:request=>new Promise((resolve,reject)=>{
   starts++;const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tinycad-explorer-'));const file=path.join(directory,'run.cir');fs.writeFileSync(file,request.deck);
   const child=spawn(path.join(runtime,manifest.helper),[path.join(runtime,manifest.library),file,...manifest.modules.map(m=>path.join(runtime,m))],{cwd:directory,windowsHide:true});jobs.set(request.runId,child);
   let pending='';child.stdout.on('data',chunk=>{pending+=chunk;let index;while((index=pending.indexOf('\n'))>=0){const line=pending.slice(0,index);pending=pending.slice(index+1);if(line.trim()){const event=JSON.parse(line);listeners.forEach(fn=>fn(request.runId,event));}}});
   child.on('error',reject);child.on('close',()=>{jobs.delete(request.runId);fs.rmSync(directory,{recursive:true,force:true});resolve();});
  })}};
  try{
   const drawing=createTeachingDrawing('rc-low-pass'),sheet=drawing.sheets[1],setup=sheet.simulation;
   setup.measurements=[{id:'cutoff',name:'Cutoff',kind:'cutoff',source:'out',reference:'in',referenceGain:'1'}];
   setup.requirements=[{id:'fc-range',name:'Corner in range',measurement:'cutoff',comparison:'between',lower:'10Hz',upper:'200Hz',unit:'Hz'}];
   setup.bindings=[{id:'resistance',name:'R1 resistance',sheet:drawing.sheets[0].id,reference:'R1',property:'Value',unit:'Ohm',minimum:'1k',maximum:'10k',logarithmic:true,series:'continuous'}];
   const points=[],controller=new AbortController(),runs=[];
   await runSweep([1000,2200,4700,6800,10000],value=>exploreOnce(drawing,sheet.id,{...setup,runs}, {resistance:String(value)},run=>runs.push(run),controller.signal),point=>points.push(point),controller.signal);
   assert.equal(points.length,5);assert.equal(starts,5);assert.equal(runs.length,5);
   for(const p of points){assert.equal(p.run.state,'complete',p.run.error);assert.equal(p.run.explorer.measurements[0].state,'valid',p.run.explorer.measurements[0].explanation);const expected=1/(2*Math.PI*p.value*1e-6);assert.ok(Math.abs(p.run.explorer.measurements[0].value/expected-1)<.001);assert.equal(p.run.explorer.checks[0].state,'pass');assert.equal(p.run.explorer.overrides.resistance,String(p.value));assert.ok(p.run.circuitHash&&p.run.buildId);assert.ok(p.data.vectors.length);}
   assert.equal(bindingValue(drawing,setup,setup.bindings[0]),'1k');
   const cached=await exploreOnce(drawing,sheet.id,{...setup,runs},{resistance:'1000'},run=>runs.push(run),controller.signal);assert.equal(cached.id,runs[0].id);assert.equal(starts,5);
   assert.equal(new Set(runs.map(r=>r.circuitHash)).size,5);
   const sweeps=[{id:'batch',created:runs[0].created,state:'complete',binding:setup.bindings[0],definition:{binding:'resistance',mode:'list',start:'1k',stop:'10k',count:5,values:'1k 2.2k 4.7k 6.8k 10k'},measurements:setup.measurements,points:points.map(p=>({value:p.value,runId:p.run.id}))}];
   const saved={...drawing,sheets:drawing.sheets.map(s=>s.id===sheet.id?{...s,simulation:{...setup,runs,sweeps}}:s)};
   const encoded=await encodeDrawing(saved);const reopened=await decodeDrawing(encoded.bytes||encoded);
   assert.deepEqual(reopened.sheets[1].simulation.measurements,setup.measurements);assert.deepEqual(reopened.sheets[1].simulation.runs[0].explorer,runs[0].explorer);
   assert.deepEqual(reopened.sheets[1].simulation.sweeps,sweeps);const restored=restoredSweep(reopened.sheets[1].simulation.sweeps[0],reopened.sheets[1].simulation);assert.equal(restored.length,5);assert.ok(restored.every(p=>p.data));
   // A stopped sweep must not schedule subsequent points.
   const cancelled=new AbortController();let calls=0;
   await runSweep([1,2,3],async()=>{calls++;cancelled.abort();return runs[0];},()=>assert.fail('Aborted points must not publish'),cancelled.signal);assert.equal(calls,1);
   const divider=createTeachingDrawing('voltage-divider'),dcSheet=divider.sheets[1];
   let dcRun;await exploreOnce(divider,dcSheet.id,dcSheet.simulation,{},run=>dcRun=run,new AbortController().signal);
   assert.equal(dcRun.state,'complete',dcRun.error);const dc=getResult(dcRun.id),net=new NetlistWorkerState().init({...divider,sheets:[divider.sheets[0]]});
   const annotations=operatingAnnotations(divider,net,dc,dcRun,divider.sheets[0].name,'voltages');assert.ok(annotations.some(a=>a.text==='2.5 V'));
   const current=operatingAnnotations(divider,net,dc,dcRun,divider.sheets[0].name,'currents');assert.ok(current.some(a=>a.text==='0.0025 A'));
   const power=operatingAnnotations(divider,net,dc,dcRun,divider.sheets[0].name,'power');assert.ok(power.some(a=>a.text==='0.00625 W'));assert.ok(power.some(a=>a.text==='-0.0125 W'));
   assert.equal(operatingAnnotations(divider,net,dc,{...dcRun,analysis:{...dcRun.analysis,kind:'tran'}},divider.sheets[0].name,'voltages').length,0);
  }finally{globalThis.document=previousDocument;globalThis.window=previousWindow;process.env.TARGET_SYSTEM=previousTarget;}
 }
 module.exports=verify();
 `);
});
