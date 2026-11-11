import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
// Use a locally installed Playwright or specify an existing installation. Keeping
// this optional avoids downloading a browser for ordinary application builds.
const {chromium}=await import(process.env.TINYCAD_PLAYWRIGHT_MODULE || 'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const base=path.join(root,'bundled-examples');
const manifest=JSON.parse(await fs.readFile(path.join(base,'teaching/manifest.json')));
const review=path.join(root,'build/teaching-examples/review');await fs.mkdir(review,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1800,height:1200}});
const issues=[];
try{
 for(const lesson of manifest.scenarios){
  await page.setContent(await fs.readFile(path.join(base,lesson.preview.replace(/\.png$/,'.svg')),'utf8'));
  await page.evaluate(()=>document.fonts.ready);
  const clipped=await page.evaluate(()=>Array.from(document.querySelectorAll('svg[data-markdown] text,[data-markdown] text')).flatMap(t=>{const box=t.getBBox();const width=Number(t.closest('svg').getAttribute('width'));return box.x+box.width>width+1?[t.textContent]:[];}));
  const circuitOverflow=await page.evaluate(()=>{const root=document.querySelector('svg'),r=root.getBoundingClientRect(),scale=r.width/1200;return Array.from(document.querySelectorAll('text')).filter(t=>!t.closest('[data-markdown]')).flatMap(t=>{const b=t.getBoundingClientRect();return (b.right-r.left)/scale>735||(b.left-r.left)/scale<20||(b.bottom-r.top)/scale>780||(b.top-r.top)/scale<90?[t.textContent]:[];});});
  if(clipped.length||circuitOverflow.length)issues.push({id:lesson.id,clipped,circuitOverflow});
  await page.screenshot({path:path.join(base,lesson.preview)});
  console.log(lesson.id+' rendered');
 }
 // Full drawings, in curriculum order, for visual review. The individual PNGs
 // retain readable notes and can be opened from the course README.
 for(let i=0;i<manifest.scenarios.length;i+=6){
  const lessons=manifest.scenarios.slice(i,i+6);
  const images=await Promise.all(lessons.map(async l=>`<figure><figcaption>${l.id} · ${l.plan}</figcaption><img src="data:image/png;base64,${(await fs.readFile(path.join(base,l.preview))).toString('base64')}"/></figure>`));
  await page.setViewportSize({width:1800,height:860});
  await page.setContent(`<style>body{margin:0;background:#cbd5e1;display:grid;grid-template-columns:repeat(3,600px)}figure{margin:0;padding:2px;box-sizing:border-box}figcaption{height:24px;font:bold 16px Arial}img{width:596px;height:397px}</style>${images.join('')}`);
  await page.screenshot({path:path.join(review,`sheet-${String(i/6+1).padStart(2,'0')}.png`)});
 }
 await fs.writeFile(path.join(review,'text-validation.json'),JSON.stringify({images:manifest.scenarios.length,issues},null,2)+'\n');
 if(issues.length)throw Error(`${issues.length} previews have clipped text`);
}finally{await browser.close();}
