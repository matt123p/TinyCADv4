import {execFileSync} from'node:child_process';import fs from'node:fs/promises';import path from'node:path';import{createRequire}from'node:module';import{fileURLToPath}from'node:url';import{runNgspice,ngspiceAvailable,ngspiceBackend}from'./tests/ngspice-runner.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));execFileSync(process.execPath,['scripts/generate-teaching-examples.mjs','--compile-only'],{cwd:root,stdio:'pipe'});const api=createRequire(import.meta.url)(path.join(root,'build/teaching-examples/generator.cjs'));api.initialiseGenerator();
const manifest=JSON.parse(await fs.readFile(path.join(root,'bundled-examples/teaching/manifest.json'))),report=[];
if(!ngspiceAvailable)throw Error('Build the native engine before verifying teaching scenarios.');
for(const lesson of manifest.scenarios){
 try{const bytes=await fs.readFile(path.join(root,'bundled-examples',lesson.path)),checked=await api.inspectLesson(bytes);if(checked.simulation){const file=path.join(root,'build/teaching-examples/decks',lesson.id+'.cir');await fs.writeFile(file,checked.deck);const result=runNgspice(file);if(result.status!==0)throw Error(result.log.slice(-3500));const data=(result.events||[]).filter(e=>e.type==='data').flatMap(e=>e.rows);if(result.events&&!data.length)throw Error('No solver samples');
 const vectors=result.events?.find(e=>e.type==='vectors')?.names||[];
 const stop=/^\.tran\s+\S+\s+(\S+)/m.exec(checked.deck);
 if(stop){const ti=vectors.indexOf('time'),last=data.at(-1)?.[ti];if(ti>=0&&!(last>=Number(stop[1])*(1-1e-8)))throw Error(`Transient stopped early at ${last}; expected ${stop[1]}. ${result.log.slice(-300)}`);}
 if(/timestep too small|doanalyses:|simulation interrupted/i.test(result.log))throw Error(result.log.slice(-500));
 report.push({id:lesson.id,status:'passed',samples:data.length});}else report.push({id:lesson.id,status:'diagram'});
 console.log(lesson.id+' '+report.at(-1).status);
 }catch(error){report.push({id:lesson.id,status:'failed',error:String(error.message)});console.error(lesson.id+' FAILED '+String(error.message).slice(-140));}
}
const summary={engine:ngspiceBackend,passed:report.filter(r=>r.status==='passed').length,diagrams:report.filter(r=>r.status==='diagram').length,failed:report.filter(r=>r.status==='failed').length,scenarios:report};await fs.writeFile(path.join(root,'build/teaching-examples/verification.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({engine:summary.engine,passed:summary.passed,diagrams:summary.diagrams,failed:summary.failed}));if(summary.failed)process.exitCode=1;
