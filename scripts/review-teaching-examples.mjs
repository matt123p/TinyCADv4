import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Run only after inspecting the newly rendered contact sheets/full-size images.
if(!process.argv.includes('--visual-review-complete'))
  throw Error('Inspect the generated previews, then pass --visual-review-complete');
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>fs.readFile(path.join(root,p));
const json=async p=>JSON.parse(await read(p));
const manifest=await json('bundled-examples/teaching/manifest.json');
const layout=await json('build/teaching-examples/layout-report.json');
const rendering=await json('build/teaching-examples/review/text-validation.json');
const verification=await json('build/teaching-examples/verification.json');
if(layout.length!==manifest.scenarios.length||rendering.images!==manifest.scenarios.length||
  verification.scenarios.length!==manifest.scenarios.length||rendering.issues.length||verification.failed)
  throw Error('Complete generation, unclipped rendering and simulation verification before recording review');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const scenarios=[];
for(const [index,s] of manifest.scenarios.entries()) {
  const result=layout.find(r=>r.id===s.id),simulation=verification.scenarios.find(r=>r.id===s.id);
  if(!result?.roundTripPreserved||!result.connectivityPreserved||!simulation||simulation.status==='failed')
    throw Error('Missing verification for '+s.id);
  scenarios.push({id:s.id,path:s.path,drawingSha256:digest(await read('bundled-examples/'+s.path)),
    preview:s.preview,previewSha256:digest(await read('bundled-examples/'+s.preview)),
    svgSha256:digest(await read('bundled-examples/'+s.preview.replace(/\.png$/,'.svg'))),
    visualReview:'inspected',contactSheet:Math.floor(index/6)+1,simulation,
    nativeWires:result.wires,junctions:result.junctions,roundTripPreserved:true,
    remainingLayoutDiagnostics:result.after.diagnostics.length});
}
await fs.writeFile(path.join(root,'bundled-examples/teaching/review.json'),JSON.stringify({
  version:2,date:new Date().toISOString().slice(0,10),
  method:'Regenerated native wire segments and editor junction cleanup; supply orientation chosen before wiring; medium auto-layout with native junction connectivity checks. Complete wire coverage and terminal connectivity checked after save/reopen. SVGs and 1800x1200 PNGs rendered through TinyCAD and hidden Chromium. All contact sheets inspected, representative circuits checked at full size; Markdown/circuit bounds checked automatically. Remaining layout diagnostics are recorded, not claimed absent.',
  engine:verification.engine,completeSimulations:verification.passed,connectionPlans:verification.diagrams,
  clippedPreviews:rendering.issues.length,
  remainingLayoutDiagnostics:scenarios.reduce((n,s)=>n+s.remainingLayoutDiagnostics,0),scenarios,
},null,2)+'\n');
console.log('Recorded review of '+scenarios.length+' regenerated teaching examples');
