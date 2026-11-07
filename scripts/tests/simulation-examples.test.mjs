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
  import { XMLBuilder } from './src/util/xmlbuilder';
  import { ioXML } from './src/io/ioXml';
  import { NetlistWorkerState } from './src/web-worker/netlistState';
  import { buildDeck } from './src/simulation/deck';
  import { checkSpiceComponents } from './src/simulation/diagnostics';
  const previousDocument=globalThis.document;
  globalThis.document={createElement:()=>({getContext:()=>({font:'',measureText:text=>({width:String(text).length*8,actualBoundingBoxDescent:3})})})};
  const runtime=path.resolve('build/engines/native');
  const manifest=fs.existsSync(path.join(runtime,'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(runtime,'manifest.json'),'utf8')) : undefined;
  try {
   for(const name of teachingExamples){
    const xml=new XMLBuilder();xml.fromText(fs.readFileSync('examples/simulation/'+name+'.dsn','utf8'));
    const drawing=new ioXML().from_dsn(xml);
    assert.equal(drawing.sheets.length,2);
    const simulation=drawing.sheets.find(sheet=>sheet.kind==='simulation');
    assert.ok(simulation.simulation.instructions);
    const net=new NetlistWorkerState().init({...drawing,sheets:drawing.sheets.filter(sheet=>sheet.kind!=='simulation')});
    assert.equal(net.symbols.length,3);
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
     const out=names.indexOf('out');assert.ok(out>=0,name+': OUT must be recorded');
     if(name==='voltage-divider'){
      assert.ok(Math.abs(rows[0][out]-2.5)<1e-9);
      assert.ok(Math.abs(rows[0][names.indexOf('v1#branch')]+0.0025)<1e-9);
     } else if(name==='rc-charging'){
      const time=names.indexOf('time');const at=rows.reduce((a,b)=>Math.abs(a[time]-.001)<Math.abs(b[time]-.001)?a:b);
      assert.ok(Math.abs(at[out]-(1-Math.exp(-at[time]/.001)))<.005);
     } else {
      const frequency=names.indexOf('frequency');const index=rows.reduce((best,row,i)=>Math.abs(row[frequency]-159.154943)<Math.abs(rows[best][frequency]-159.154943)?i:best,0);
      const imaginary=data.flatMap(event=>event.imaginary);assert.ok(Math.abs(Math.hypot(rows[index][out],imaginary[index][out])-Math.SQRT1_2)<.01);
     }
    } finally {fs.rmSync(directory,{recursive:true,force:true});}
   }
  } finally {globalThis.document=previousDocument;}
 `);
});
