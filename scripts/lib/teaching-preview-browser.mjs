import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Use TinyCAD's installed Chromium runtime when no separate Playwright install
// is supplied. The renderer window stays hidden and uses an isolated session.
export async function teachingPreviewBrowser() {
  if(process.env.TINYCAD_PLAYWRIGHT_MODULE) {
    const {chromium}=await import(process.env.TINYCAD_PLAYWRIGHT_MODULE);
    return chromium.launch({headless:true,args:['--no-sandbox']});
  }
  const electron=createRequire(import.meta.url)('electron');
  if(typeof electron==='string') {
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    const child=spawnSync(electron,[fileURLToPath(new URL('./teaching-preview-main.cjs',import.meta.url)),process.argv[1],...process.argv.slice(2)],{
      env,stdio:'inherit',windowsHide:true,
    });
    if(child.error)throw child.error;
    process.exit(child.status??1);
  }
  const {app,BrowserWindow}=electron;
  await app.whenReady();
  return {
    async newPage({viewport}) {
      const window=new BrowserWindow({width:viewport.width,height:viewport.height,
        useContentSize:true,show:false,enableLargerThanScreen:true,webPreferences:{sandbox:true,contextIsolation:true,
          backgroundThrottling:false,offscreen:true,partition:'teaching-previews'}});
      const size=async next=>{
        viewport=next;
        window.setMinimumSize(next.width,next.height+100);
        window.setContentSize(next.width,next.height);
      };
      await size(viewport);
      return {
        async setContent(html) {
          await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<style>html,body{margin:0}</style>'+html));
          await window.webContents.executeJavaScript('Promise.all([document.fonts.ready,...Array.from(document.images,i=>i.decode())]).then(()=>true)');
        },
        async evaluate(fn) {
          return window.webContents.executeJavaScript('Promise.resolve(('+fn.toString()+')()).then(r => r instanceof FontFaceSet ? true : r)');
        },
        setViewportSize:size,
        async screenshot({path}) {
          await window.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))');
          await fs.writeFile(path,(await window.webContents.capturePage({x:0,y:0,...viewport})).toPNG());
        },
      };
    },
    async close() { app.exit(process.exitCode||0); },
  };
}
