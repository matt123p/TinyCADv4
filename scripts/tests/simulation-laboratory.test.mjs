import {test} from 'node:test';
import {runRegression} from './run-regression.mjs';
test('laboratory models produce native loading, current limiting, generator and resistance-test readings',async()=>{
 await runRegression(String.raw`
 import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
 import {defaultInstrument,instrumentTemplate,meterReading,scopeDisplay} from './src/simulation/instruments';
 import {createControl,updateControl} from './src/simulation/controlSymbols';
 import {createTeachingDrawing} from './src/simulation/examples';
 import {createLaboratoryDrawing} from './src/simulation/laboratoryExample';
 import {instrumentSignals} from './src/simulation/instruments';import {spicePinLabel} from './src/io/netlists/netlistSpice';import {vectorUnit} from './src/simulation/resultStore';
 import {studyPlan} from './src/simulation/studies';import {applyBindings} from './src/simulation/bindings';import {measure} from './src/simulation/metrics';import {resolvedSignals} from './src/simulation/signals';
 import {NetlistWorkerState} from './src/web-worker/netlistState';import {buildDeck} from './src/simulation/deck';import {resistanceCircuit} from './src/simulation/resistanceTest';
 import {symbolReference} from './src/simulation/bindings';import {DocItemTypes} from './src/model/dsnItem';import {updateSymbol} from './src/manipulators/updateSymbol';
 import {blank} from './src/io/ioXml';import {readControl} from './src/simulation/controls';import {encodeDrawing,decodeDrawing} from './src/io/dsnCodec';
 const runtime=path.resolve('build/engines/native'),manifest=JSON.parse(fs.readFileSync(path.join(runtime,'manifest.json'),'utf8'));
 function run(body){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tinycad-lab-'));try{const file=path.join(directory,'test.cir');fs.writeFileSync(file,'TinyCAD lab\n'+body+'\n.end\n');const result=spawnSync(path.join(runtime,manifest.helper),[path.join(runtime,manifest.library),file,...manifest.modules.map(m=>path.join(runtime,m))],{cwd:directory,encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});assert.equal(result.status,0,result.stderr);const events=result.stdout.trim().split('\n').map(l=>JSON.parse(l));assert.equal(events.at(-1).state,'complete',JSON.stringify(events.filter(e=>e.type==='log')));const names=events.find(e=>e.type==='vectors').names,rows=events.filter(e=>e.type==='data').flatMap(e=>e.rows);return{names,rows,get:name=>rows[0][names.indexOf(name)]};}finally{fs.rmSync(directory,{recursive:true,force:true});}}
 const template=(c,ref)=>instrumentTemplate(c).replaceAll('$(ref)',ref).replaceAll('%(1)','p').replaceAll('%(2)','0').replaceAll('%(3)','b').replaceAll('%(4)','0');
 const supply={...defaultInstrument('supply'),voltage:'5V',currentLimit:'10mA',outputResistance:'.1Ohm'};
 const loaded=run(template(supply,'PSU1')+'\nRload p 0 1000\n.op');assert.ok(Math.abs(loaded.get('p')-5)<.001);assert.ok(Math.abs(loaded.get('v_psu1_sense#branch')-.005)<.000001);
 const limited=run(template(supply,'PSU1')+'\nRload p 0 100\n.op');assert.ok(Math.abs(limited.get('p')-1)<.001);assert.ok(Math.abs(limited.get('v_psu1_sense#branch')-.01)<.000001);
 const off=run(template({...supply,enabled:false},'PSU1')+'\nRload p 0 100\n.op');assert.ok(Math.abs(off.get('p'))<1e-9);
 const meter={...defaultInstrument('meter'),inputResistance:'1kOhm'};
 const voltage=run('V1 in 0 10\nR1 in p 1k\n'+template(meter,'DMM1')+'\n.op');assert.ok(Math.abs(voltage.get('p')-5)<1e-9);
 const current=run('V1 in 0 5\nR1 in p 1k\n'+template({...meter,mode:'dcA',burden:'10Ohm'},'DMM1')+'\n.op');assert.ok(Math.abs(current.get('v_dmm1_sense#branch')-5/1010)<1e-9);
 const scope=run('V1 p 0 5\nV2 b 0 2\n'+template(defaultInstrument('scope'),'OSC1')+'\n.op');assert.ok(scope.get('p')===5&&scope.get('b')===2);
 const generator=run(template({...defaultInstrument('generator'),source:{...defaultInstrument('generator').source,offset:'2V',amplitude:'1V'}},'GEN1')+'\nRload p 0 50\n.op');assert.ok(Math.abs(generator.get('p')-1)<1e-9);
 const bjt=run('Vcc vcc 0 5\nVb b 0 .65\nR1 vcc c 1k\nQ1 c b 0 QTEST\n.model QTEST NPN (BF=100 IS=1e-14)\n.save all @q1[ic] @q1[ib]\n.op');assert.ok(bjt.get('@q1[ic]')>0);assert.ok(bjt.get('@q1[ib]')>0);
 const inductor=run('V1 in 0 1\nR1 in p 1k\nL1 p 0 1m\n.save all @l1[i]\n.op');assert.ok(Math.abs(inductor.get('@l1[i]')-.001)<1e-10);
 const time={scale:'time',log:'',vectors:[{name:'time',unit:'s',real:[0,1,2,3,4,5,6]},{name:'A',unit:'V',real:[1,1,3,3,1,1,3]},{name:'B',unit:'V',real:[0,0,1,1,0,0,1]}]};
 const display=scopeDisplay(time,{...defaultInstrument('scope'),level:'2V',timebase:'1s'});assert.equal(display.triggered,true);assert.equal(display.start,1.5);assert.equal(display.stop,11.5);
 const dcRemoved=scopeDisplay(time,{...defaultInstrument('scope'),couplingA:'AC'});assert.ok(dcRemoved.data.vectors[1].real.some(n=>n<0));
 assert.equal(meterReading({scale:'',log:'',vectors:[{name:'Reading',unit:'V',real:[3]}]},{...defaultInstrument('meter'),range:'2V'}).text,'OL');
 globalThis.document={createElement:()=>({getContext:()=>({font:'',measureText:text=>({width:String(text).length*8,actualBoundingBoxDescent:3})})})};
 async function verify(){
  const laboratory=createLaboratoryDrawing(),labSetup=laboratory.sheets[1].simulation,labNet=new NetlistWorkerState().init({...laboratory,sheets:[laboratory.sheets[0]]});
  const labScope=labNet.symbols.find(([,s])=>readControl(s)?.kind==='instrument'&&readControl(s).type==='scope')[1];
  assert.equal(spicePinLabel('1',labScope,labNet),'IN');assert.equal(spicePinLabel('2',labScope,labNet),'0');assert.equal(spicePinLabel('3',labScope,labNet),'OUT');assert.equal(spicePinLabel('4',labScope,labNet),'0');
  const acquisition=run(buildDeck(labNet,labSetup).replace(/^TinyCAD simulation\n/,'').replace(/\.end\s*$/,''));
  const labData={scale:'time',log:'',vectors:acquisition.names.map((name,i)=>({name,unit:vectorUnit(name),real:acquisition.rows.map(row=>row[i])}))};
  const channels=instrumentSignals(labNet,labScope,labData,readControl(labScope));assert.ok(channels.vectors.find(v=>v.name==='A').real.some(n=>n>.9));assert.ok(channels.vectors.find(v=>v.name==='B').real.some(n=>n>.1));
  assert.ok(acquisition.rows.every(row=>Math.abs(row[acquisition.names.indexOf('bench')]-5)<.001));
  const plan=studyPlan(labSetup.studies[0],laboratory,labSetup);assert.equal(plan.length,10);
  for(const point of plan.slice(0,3)){
   const varied=applyBindings(laboratory,labSetup,point.overrides),net=new NetlistWorkerState().init({...varied.drawing,sheets:[varied.drawing.sheets[0]]});
   const actual=run(buildDeck(net,varied.setup).replace(/^TinyCAD simulation\n/,'').replace(/\.end\s*$/,''));
   const data={scale:'time',log:'',vectors:actual.names.map((name,i)=>({name,unit:vectorUnit(name),real:actual.rows.map(row=>row[i])}))};
   const resolved=resolvedSignals(varied.drawing,net,data,labSetup.measurements.map(m=>m.source));
   assert.equal(measure(labSetup.measurements[0],resolved).state,'valid');assert.ok(Math.abs(measure(labSetup.measurements[1],resolved).value-1000)<1,JSON.stringify(measure(labSetup.measurements[1],resolved)));assert.ok(Math.abs(measure(labSetup.measurements[2],resolved).value-.025)<.0001);
  }
  for(const test of labSetup.testCases){const changed=applyBindings(laboratory,{...labSetup,bindings:test.bindings},test.overrides),net=new NetlistWorkerState().init({...changed.drawing,sheets:[changed.drawing.sheets[0]]});const actual=run(buildDeck(net,{...changed.setup,analysis:{...test.analysis,kind:'op'}}).replace(/^TinyCAD simulation\n/,'').replace(/\.end\s*$/,''));assert.ok(Math.abs(actual.get('bench')-Number(test.overrides['bench-voltage']))<.002);}
  const reopenedLab=await decodeDrawing(await encodeDrawing(laboratory));assert.deepEqual(reopenedLab.sheets[1].simulation.studies,labSetup.studies);assert.deepEqual(reopenedLab.sheets[1].simulation.testCases,labSetup.testCases);
  let drawing=blank(),sheet=drawing.sheets[0];
  for(const tool of ['scope','meter','generator','supply']){const added=createControl(tool,sheet,drawing);sheet={...added.sheet,items:[...sheet.items,added.symbol]};drawing={...drawing,sheets:[sheet]};assert.equal(readControl(added.symbol).type,tool);assert.equal(new updateSymbol(added.symbol).active_points().length,tool==='scope'?4:2);assert.match(added.symbol._symbol.uid,/tinycad-spice-instrument/);}
  const encoded=await encodeDrawing(drawing);const reopened=await decodeDrawing(encoded);assert.equal(reopened.sheets[0].items.filter(i=>i.NodeName===DocItemTypes.Symbol).length,4);
  const circuit=createTeachingDrawing('voltage-divider'),base=circuit.sheets[0],resistor=base.items.find(i=>i.NodeName===DocItemTypes.Symbol&&symbolReference(i)==='R2');
  const added=createControl('meter',base,circuit);let dmm=updateControl(added.symbol,{...defaultInstrument('meter'),mode:'ohm'},circuit);
  const desired=new updateSymbol(resistor).active_points().find(p=>p[2].number==='1'),actual=new updateSymbol(dmm).active_points().find(p=>p[2].number==='1');
  dmm=new updateSymbol({...dmm,point:[dmm.point[0]+desired[0]-actual[0],dmm.point[1]+desired[1]-actual[1]],_active_points:null}).post_construction();
  // Use a netlist-level isolated resistor fixture to verify the explicit stimulus.
  const ohms=run('Itest 0 p 1m\nRtest p 0 2200\n.op');assert.ok(Math.abs(ohms.get('p')/.001-2200)<1e-8);
  const low=new updateSymbol(dmm).active_points().find(p=>p[2].number==='2'),ground=base.items.find(i=>i.NodeName===DocItemTypes.Power).point;
  const target={...circuit,sheets:[{...added.sheet,items:[...base.items,dmm,{NodeName:DocItemTypes.Wire,_id:987654,d_points:[[low[0],low[1]],ground],_magnetic:null}]},circuit.sheets[1]]};const original=JSON.stringify(target);
  const unpowered=resistanceCircuit(target,{sheet:base.id,reference:symbolReference(dmm),current:'1mA',baseHash:'test'});assert.equal(JSON.stringify(target),original);assert.match(unpowered.sheets[0].items.find(i=>i._id===dmm._id).text.find(f=>f.description==='$$SPICE').value,/I_\$\(ref\)_test/);
  const testNet=new NetlistWorkerState().init({...unpowered,sheets:[unpowered.sheets[0]]});const ohmRun=run(buildDeck(testNet,circuit.sheets[1].simulation).replace(/^TinyCAD simulation\n/,'').replace(/\.end\s*$/,''));assert.ok(Math.abs(ohmRun.get('out')/.001-500)<.001,'Unpowered meter must read R1 || R2 with the independent source suppressed');
 }
 module.exports=verify();
 `);
});

test('P1 studies are deterministic and classify failed cases; advanced metrics match analytic signals',async()=>{
 await runRegression(String.raw`
 import assert from 'node:assert/strict';import {studyPlan,studyStatistics} from './src/simulation/studies';import {createTeachingDrawing} from './src/simulation/examples';import {measure} from './src/simulation/metrics';import {validateSetup} from './src/simulation/document';
 globalThis.document={createElement:()=>({getContext:()=>({font:'',measureText:text=>({width:String(text).length*8,actualBoundingBoxDescent:3})})})};
 const drawing=createTeachingDrawing('rc-low-pass'),setup=drawing.sheets[1].simulation;
 const definition={id:'mc',name:'Monte Carlo',kind:'monteCarlo',seed:12345,count:20,variations:[{binding:'resistance',percent:'5',distribution:'uniform',group:''}]};
 assert.deepEqual(studyPlan(definition,drawing,setup),studyPlan(definition,drawing,setup));assert.notDeepEqual(studyPlan({...definition,seed:2},drawing,setup),studyPlan(definition,drawing,setup));
 const sampled=studyPlan(definition,drawing,setup);assert.ok(sampled.every(p=>Number(p.overrides.resistance)>=950&&Number(p.overrides.resistance)<=1050));assert.equal(studyPlan({...definition,kind:'corners'},drawing,setup).length,2);
 const statistic=studyStatistics({points:[{runId:'a',state:'complete'},{runId:'b',state:'failed'},{runId:'c',state:'complete'}]},[{id:'a',explorer:{measurements:[{id:'fc',state:'valid',value:10}],checks:[{state:'pass'}]}},{id:'c',explorer:{measurements:[{id:'fc',state:'valid',value:20}],checks:[{state:'fail'}]}}],'fc');assert.equal(statistic.passed,1);assert.equal(statistic.failed,1);assert.equal(statistic.unavailable,1);assert.equal(statistic.yield,1/3);assert.equal(statistic.mean,15);
 const power={scale:'',log:'',vectors:[{name:'load',unit:'W',real:[8]},{name:'supply',unit:'W',real:[-10]}]};const efficiency=measure({id:'eff',name:'Efficiency',kind:'efficiency',source:'load',reference:'supply'},power);assert.equal(efficiency.state,'valid');assert.equal(efficiency.value,80);assert.equal(efficiency.unit,'%');assert.equal(measure({id:'loss',name:'Loss',kind:'loss',source:'load',reference:'supply'},power).value,2);
 const frequencies=Array.from({length:401},(_,i)=>10*10**(i/100)),tau=.001,ac={scale:'frequency',log:'',vectors:[{name:'frequency',unit:'Hz',real:frequencies},{name:'in',unit:'V',real:frequencies.map(()=>1)},{name:'out',unit:'V',real:frequencies.map(f=>1/(1+(2*Math.PI*f*tau)**2)),imaginary:frequencies.map(f=>-2*Math.PI*f*tau/(1+(2*Math.PI*f*tau)**2))}]};
 const delay=measure({id:'delay',name:'Group delay',kind:'groupDelay',source:'out',reference:'in',at:'100Hz'},ac);assert.equal(delay.state,'valid');assert.ok(Math.abs(delay.value-tau/(1+(2*Math.PI*100*tau)**2))<1e-6);
 assert.throws(()=>validateSetup({...setup,studies:[{...definition,count:1000}]}));assert.throws(()=>validateSetup({...setup,studies:[{...definition,variations:[definition.variations[0],definition.variations[0]]}]}));
 `);
});
