import { test } from 'node:test';
import { runRegression } from './run-regression.mjs';

test('measurement titles follow active signal, reference, window and threshold settings without changing identity', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import { measurementTitle, sameMeasurementDefinitions, measurementValue } from './src/simulation/measurementPresentation';
    import { deviceSignal } from './src/simulation/signals';
    const def={id:'rms',name:'Old manual name',kind:'rippleRms',source:'out',from:'2ms',to:'5ms'};
    assert.equal(measurementTitle(def),'out · AC RMS · 2ms–5ms');
    assert.notEqual(measurementTitle({...def,to:'8ms'}),measurementTitle(def));
    assert.match(measurementTitle({...def,kind:'frequency',threshold:'.5V'}),/Frequency.*crossing .5V/);
    assert.match(measurementTitle({...def,kind:'gain',reference:'in',at:'1kHz'}),/Gain.*ref in.*at 1kHz/);
    assert.match(measurementTitle({...def,kind:'settlingTime',initial:'0V',final:'5V',tolerance:'1'}),/0V → 5V.*±1%/);
    assert.match(measurementTitle({...def,source:deviceSignal('sheet id','R3','power')}),/^R3 power/);
    assert.ok(sameMeasurementDefinitions([def],[{to:'5ms',from:'2ms',source:'out',kind:'rippleRms',name:measurementTitle(def),id:'rms'}]));
    assert.ok(!sameMeasurementDefinitions([def],[{...def,to:'8ms'}]));
    assert.equal(measurementValue({state:'valid',value:.125,unit:'V'}),'0.125 V');
    assert.equal(measurementValue({state:'unavailable',unit:''}),'—');
    assert.equal(measurementTitle({...def,source:'x'.repeat(1024)}).length,256,'Generated names remain valid in saved documents');
  `);
});

test('measurement failures identify analysis mismatch, malformed settings, acquisition limits and missing crossings', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import { measure } from './src/simulation/metrics';
    const def={id:'m',name:'RMS',kind:'rms',source:'out',from:'2ms',to:'5ms'};
    const op={scale:'',log:'',vectors:[{name:'out',unit:'V',real:[1]}]};
    assert.match(measure(def,op).explanation,/RMS requires a transient.*scalar.*DC/);
    assert.ok(!measure(def,op).explanation.includes('Expected a number'));
    const data={scale:'time',log:'',vectors:[{name:'time',unit:'s',real:[0,.001,.002]},{name:'out',unit:'V',real:[1,1,1]}]};
    assert.match(measure(def,data).explanation,/0.002–0.005 s.*acquired range 0–0.002 s/);
    assert.match(measure({...def,from:'bad'},data).explanation,/Window start "bad" is invalid/);
    assert.match(measure({...def,from:'.002',to:'.001'},data).explanation,/start.*after window end/);
    assert.match(measure({...def,kind:'frequency',from:'',to:''},data).explanation,/two rising crossings.*found 0/);
    assert.match(measure({...def,source:'missing',from:'',to:''},data).explanation,/Signal missing is unavailable/);
    assert.match(measure(def).explanation,/No acquisition/);
    assert.equal(measure({...def,from:'',to:'',reference:'hidden-old-reference'},data).state,'valid','Fields hidden by the current measurement kind must not block it');
  `);
});

test('RMS diagrams use measured levels and selected windows; missing/incompatible data is explicitly illustrative', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import { measurementDiagram } from './src/simulation/measurementDiagram';
    import { metricKinds } from './src/simulation/explorerTypes';
    import { measure } from './src/simulation/metrics';
    const time=Array.from({length:1001},(_,i)=>i*.000005);
    const data={scale:'time',log:'',vectors:[{name:'time',unit:'s',real:time},{name:'out',unit:'V',real:time.map(t=>2+Math.sin(t*2*Math.PI*1000))}]};
    const def={id:'rms',name:'Old',kind:'rms',source:'out',from:'2ms',to:'5ms'};
    const result=measure(def,data),diagram=measurementDiagram(def,data,result);
    assert.equal(diagram.actual,true);assert.equal(diagram.from,.002);assert.equal(diagram.to,.005);
    assert.equal(diagram.lines[0].label,'RMS');assert.equal(diagram.lines[0].value,result.value);
    const ac={...def,kind:'rippleRms'},acResult=measure(ac,data),acDiagram=measurementDiagram(ac,data,acResult);
    assert.ok(Math.abs(acResult.value-Math.SQRT1_2)<.001);
    assert.deepEqual(acDiagram.points.map(p=>p.y),data.vectors[1].real,'The captured waveform must remain unchanged for AC RMS');
    assert.equal(acDiagram.lines[1].reading,acResult.value);
    assert.ok(Math.abs(acDiagram.lines[1].value-(2+acResult.value))<.001,'AC RMS is shown relative to the captured DC mean');
    assert.equal(measurementDiagram(def).actual,false);
    const scalar=measurementDiagram(def,{scale:'',log:'',vectors:[{name:'out',unit:'V',real:[1]}]},measure(def,{scale:'',log:'',vectors:[{name:'out',unit:'V',real:[1]}]}));
    assert.equal(scalar.actual,true);assert.deepEqual(scalar.points,[{x:0,y:1}]);assert.equal(scalar.annotations,false);
    const frequency={...def,kind:'frequency',threshold:'2V'},f=measurementDiagram(frequency,data,measure(frequency,data));
    assert.ok(Math.abs(f.interval.to-f.interval.from-.001)<1e-8);
    const failed={...def,to:'8ms'},invalid=measurementDiagram(failed,data,measure(failed,data));
    assert.equal(invalid.lines.length,0,'Never show an invented result line when the measurement fails');
    assert.equal(invalid.annotations,false);assert.equal(invalid.fill,false);assert.equal(invalid.interval,undefined);assert.equal(invalid.at,undefined);
    const efficiency={...def,kind:'efficiency'},eff=measurementDiagram(efficiency,data,measure(efficiency,data));
    assert.equal(eff.actual,true,'An incompatible measurement still plots the real captured signal');
    assert.equal(eff.unit,'V');assert.equal(eff.reference,undefined);assert.equal(eff.annotations,false);
    assert.deepEqual(eff.points.map(p=>p.y),data.vectors[1].real,'Never substitute illustrative power data for the captured voltage');
    const failedAc={...ac,to:'8ms'},rawAc=measurementDiagram(failedAc,data,measure(failedAc,data));
    assert.deepEqual(rawAc.points.map(p=>p.y),data.vectors[1].real,'Failed AC RMS shows the raw record without subtracting an unmeasured mean');
    const missing=measurementDiagram({...def,source:'missing'},data,measure({...def,source:'missing'},data));
    assert.equal(missing.captured,true);assert.equal(missing.points.length,0,'Missing captured signals must not be replaced by illustrations');
    const band=measurementDiagram({...def,kind:'bandwidth',from:'100Hz',to:'10kHz'});
    assert.ok(band.interval && band.interval.from<1000 && band.interval.to>1000,'Bandwidth illustration marks both half-power crossings');
    assert.equal(measurementDiagram({...def,kind:'efficiency'}).unit,'W');
    for(const kind of metricKinds){
      const diagram=measurementDiagram({...def,kind});
      assert.ok(diagram.description && diagram.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)),kind);
    }
  `);
});

test('editor and summary evaluation reject stale data and recompute obsolete saved failure messages', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import { evaluateMeasurements } from './src/simulation/measurementResults';
    import { createTeachingDrawing } from './src/simulation/examples';
    import { NetlistWorkerState } from './src/web-worker/netlistState';
    import { defaultSetup } from './src/simulation/contracts';
    globalThis.document={createElement:()=>({getContext:()=>({font:'',measureText:text=>({width:String(text).length*8,actualBoundingBoxDescent:3})})})};
    const drawing=createTeachingDrawing('voltage-divider'),net=new NetlistWorkerState().init({...drawing,sheets:[drawing.sheets[0]]});
    const def={id:'rms',name:'Old name',kind:'rms',source:'out',from:'2ms',to:'5ms'};
    const setup={...defaultSetup(),measurements:[def]};
    const data={scale:'time',log:'',vectors:[{name:'time',unit:'s',real:[0,.002,.005]},{name:'out',unit:'V',real:[2,2,2]}]};
    const run={id:'test',analysis:{kind:'tran'},explorer:{definitions:[def],measurements:[{id:def.id,state:'unavailable',unit:'',explanation:'Expected a number, received 2ms'}],overrides:{},traces:[]}};
    const context={drawing,net,data,setup,run,fresh:true};
    assert.equal(evaluateMeasurements(context).results[0].value,2,'Re-evaluate against the selected record rather than reusing an obsolete error');
    const stale=evaluateMeasurements({...context,fresh:false});assert.equal(stale.results[0].state,'unavailable');assert.match(stale.results[0].explanation,/circuit has changed/);
    assert.match(evaluateMeasurements({...context,checking:true}).results[0].explanation,/Checking/);
    assert.match(evaluateMeasurements({...context,running:true}).results[0].explanation,/still running/);
    assert.match(evaluateMeasurements({...context,data:undefined}).results[0].explanation,/Numerical data.*not available/);
    const saved={...run,explorer:{...run.explorer,measurements:[{id:def.id,state:'valid',value:2,unit:'V',explanation:'Captured'}]}};
    assert.equal(evaluateMeasurements({...context,run:saved,data:undefined}).results[0].value,2,'Compact copies retain captured values when numeric vectors are removed');
    const traceDef={...def,source:'delta'},capturedTrace={name:'delta',operation:'subtract',left:'out',right:'in'},currentTrace={...capturedTrace,operation:'divide'};
    const traced={...context,data:{...data,vectors:[...data.vectors,{name:'in',unit:'V',real:[1,1,1]}]},setup:{...setup,measurements:[traceDef],traces:[currentTrace]},run:{...run,explorer:{...run.explorer,definitions:[traceDef],traces:[capturedTrace]}}};
    assert.equal(evaluateMeasurements(traced).results[0].value,1,'Captured trace settings must be used for both the editor and the summary');
  `);
});
