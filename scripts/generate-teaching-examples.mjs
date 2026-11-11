import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {librarySqlite} from './lib/library-from-sql.mjs';
import {drawFunctionalBlock} from './lib/functional-artwork.mjs';
import {plans,diagramPlans,guidance} from './teaching/scenarios.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'build/teaching-examples/generator.cjs');
await build({stdin:{contents:`export {LessonBuilder,initialiseGenerator,encodeDrawing,decodeDrawing,inspectLesson} from './scripts/teaching/LessonBuilder';export {circuit} from './scripts/teaching/circuits';`,resolveDir:root,loader:'tsx'},bundle:true,platform:'node',format:'cjs',packages:'external',outfile:output,logLevel:'error',plugins:[{name:'editor-services',setup(b){
 b.onResolve({filter:/\/(?:startup|i18n)$/},({path:p})=>({path:p.endsWith('/startup')?'startup':'i18n',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path:p})=>({contents:p==='startup'?'export const store={dispatch(){}};export function getStore(){return store;}':'export default {t:key=>key};'}));
 b.onResolve({filter:/(^|\/)measureText$/},()=>({path:path.join(root,'scripts/teaching/renderMeasureText.ts')}));
 b.onLoad({filter:/src[\\/]util[\\/]font_metrics[\\/].+\.js$/},async({path:p})=>({contents:(await fs.readFile(p,'utf8')).replace(/^module\.exports\s*=\s*/m,'export default '),loader:'js'}));
}}]});
if(process.argv.includes('--compile-only'))process.exit(0);
const{LessonBuilder,initialiseGenerator,encodeDrawing,decodeDrawing,circuit}=createRequire(import.meta.url)(output);initialiseGenerator();
const manifest=JSON.parse(await fs.readFile(path.join(root,'docs/symbol-libraries/library-manifest.json')));
const master=JSON.parse(await fs.readFile(path.join(root,'docs/symbol-libraries/all-symbols.json')));
const provenance=JSON.parse(await fs.readFile(path.join(root,'bundled-libraries/teaching/teaching.provenance.json')));
const SQL=await librarySqlite(),db=new SQL.Database(await fs.readFile(path.join(root,'bundled-libraries/teaching/teaching.tclib')));
const query=sql=>{const r=db.exec(sql)[0];return r?r.values.map(v=>Object.fromEntries(r.columns.map((c,i)=>[c,v[i]]))):[];};
const library=provenance.entries.map(e=>{const name=query(`SELECT * FROM Name WHERE NameID=${e.nameId}`)[0];name.Attributes=query(`SELECT * FROM Attribute WHERE NameID=${e.nameId}`);const xml=new TextDecoder().decode(query(`SELECT Data FROM Symbol WHERE SymbolID=${name.SymbolID}`)[0].Data);const requirement=master.symbols.find(s=>s.id===e.id);return{id:e.id,style:e.candidateId.endsWith('-us')?'us':'eu',name,xml,pins:requirement.pins,mapping:e.logicalToSymbolPins};});db.close();
// The compact source 555 has overlapping internal pin names. Use the same
// functional-block construction and retain its exact electrical pin contract.
const timer=library.find(e=>e.id==='timer_555');
timer.xml=drawFunctionalBlock(library.find(e=>e.id==='gate_and'),master.symbols.find(s=>s.id==='timer_555'),{style:{leadLengthMm:4,pinPitchMm:4}},'555',null).xml;
const destination=path.join(root,'bundled-examples/teaching');await fs.mkdir(destination,{recursive:true});
const uuid=key=>{const s=createHash('sha256').update('tinycad-teaching-'+key).digest('hex');return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20,32);};
const all=[],failures=[];const only=process.argv.includes('--only')?process.argv[process.argv.indexOf('--only')+1]:null;
for(const course of manifest.libraries){
 const selected=plans[course.library_id]?.split(/\s+/);if(!selected||selected.length!==course.experiments.length)throw Error('Incomplete scenario plan '+course.library_id);
 const dir=path.join(destination,course.library_id);await fs.mkdir(dir,{recursive:true});
 for(const [i,activity]of course.experiments.entries()){
  if(only&&activity.id!==only&&course.library_id!==only)continue;
  const plan=selected[i],diagram=diagramPlans.has(plan),level=course.library_id.startsWith('gcse')?'GCSE · ages 14–16':course.library_id==='btec-first-engineering'?'BTEC First · ages 14–16':course.library_id.startsWith('degree')?'First-year degree · ages 18+':course.library_id.includes('hnc')?'Higher National · level 4':'Post-16 · ages 16–19';
  const info=guidance[plan]||[activity.title,activity.catalogue_description,'Record a prediction, follow the stated task and compare the result with your prediction.'];
  try{
   const data={id:activity.id,title:activity.title,uuid:uuid(course.library_id+'/'+activity.id)};const b=new LessonBuilder(data,library);circuit(b,plan);
   const markdown=`## ${info[0]}\n\n**${level}**\n\n${info[1]}\n\n### Your investigation\n\n${info[2]}\n\n### This activity\n\n${activity.catalogue_description}\n\n### Getting started\n\n${diagram?'This is a connection-planning drawing. Follow each labelled net, identify the real terminals and add your bench measurements. No simulation is attached.':'Open the Simulation tab and press Run. Select a source or component to see its values. Read the labelled signals, then change one quantity at a time. Equal net labels identify connected points.'}\n\n${b.notes.join(' ')}\n\n**Explain:** ${level.includes('14–16')?'What changed, and why? Use your readings as evidence.':'Use an equation, a truth table or a state sequence to justify your prediction. Include units and discuss the model assumptions.'}\n\n${diagram?'Check the physical layout with your teacher before construction.':'The model predicts electrical behaviour; it does not replace real practical measurements.'}`;
   const result=b.finish(markdown,diagram),ext=diagram?'dsn':'dzn',file=activity.id+'.'+ext;
   const bytes=await encodeDrawing(result.drawing,diagram?'xml':'zip-v1');
   await fs.writeFile(path.join(dir,file),bytes);await fs.writeFile(path.join(dir,activity.id+'.svg'),result.svg);await fs.writeFile(path.join(dir,activity.id+'.md'),markdown+'\n');
   if(result.deck){await fs.mkdir(path.join(root,'build/teaching-examples/decks'),{recursive:true});await fs.writeFile(path.join(root,'build/teaching-examples/decks',activity.id+'.cir'),result.deck);}
   all.push({course:course.library_id,id:activity.id,title:activity.title,sourceDocument:course.source_document,plan,format:ext,path:'teaching/'+course.library_id+'/'+file,preview:'teaching/'+course.library_id+'/'+activity.id+'.png',descriptionPath:'teaching/'+course.library_id+'/'+activity.id+'.md',simulation:diagram?null:result.drawing.sheets.at(-1).simulation.analysis,markdown:true});console.log(activity.id+' '+plan+' '+ext);
  }catch(error){failures.push({id:activity.id,plan,error:String(error.stack||error)});console.error(activity.id+': '+error.message);}
 }
}
await fs.writeFile(path.join(root,'build/teaching-examples/generation-errors.json'),JSON.stringify(failures,null,2)+'\n');
if(!only){await fs.writeFile(path.join(destination,'manifest.json'),JSON.stringify({version:1,source:'docs/symbol-libraries/library-manifest.json',scenarios:all},null,2)+'\n');}
console.log(JSON.stringify({generated:all.length,failures:failures.length}));if(failures.length)process.exitCode=1;
if(!only && !failures.length){
 const configPath=path.join(root,'bundled-examples/config.json');
 const catalog=JSON.parse(await fs.readFile(configPath,'utf8'));
 const courseIds=new Set(manifest.libraries.map(c=>c.library_id));
 catalog.groups=catalog.groups.filter(g=>!courseIds.has(g.id));
 for(const course of manifest.libraries){
  const lessons=all.filter(s=>s.course===course.library_id);
  const intro=`# ${course.title}\n\nStudent circuit activities following ${course.source_document.split('/').pop()}. Each drawing contains a Markdown guide with a prediction, investigation and explanation task.\n\nOpen a simulation (.dzn), select its **Simulation** tab and press **Run**. Ordinary drawings (.dsn) are connection plans for physical work, measurements or programming. Equal net labels mean an electrical connection.\n\nThese are configurable educational models: compare their assumptions with the real components and equipment used in class. Save your changes as your own copy.\n`;
  await fs.writeFile(path.join(destination,course.library_id,'overview.md'),intro);
  await fs.writeFile(path.join(destination,course.library_id,'README.md'),intro+`\n| Activity | Drawing | Preview |\n| --- | --- | --- |\n`+lessons.map(l=>`| ${l.id} · ${l.title.replaceAll('|','/')} | [${l.format.toUpperCase()}](${path.basename(l.path)}) | [Image](${path.basename(l.preview)}) |`).join('\n')+'\n');
  catalog.groups.push({id:course.library_id,title:course.title,preview:lessons[0].preview,descriptionPath:`teaching/${course.library_id}/overview.md`,examples:lessons.map(l=>({id:l.id,title:`${l.id} · ${l.title}`,path:l.path,preview:l.preview,descriptionPath:l.descriptionPath}))});
 }
 await fs.writeFile(configPath,JSON.stringify(catalog,null,2)+'\n');
}
