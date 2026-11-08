import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = process.cwd();
const directory = path.join(root, 'build/qualification/chart-windows');
await fs.mkdir(directory, { recursive: true });
await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { Chart } from 'chart.js';
    import { openChartPopup, ChartPopupPortal } from './src/components/simulation/ChartPopup';
    import { Waveform } from './src/components/simulation/Waveform';
    import { FluentProvider, webLightTheme } from '@fluentui/react-components';
    import { SpiceControlPanel } from './src/components/panel/SpiceControlPanel';
    import { createControl, updateControl } from './src/simulation/controlSymbols';
    import { defaultSource, readControl } from './src/simulation/controls';
    import { blank } from './src/io/ioXml';
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const assert = (condition, message) => { if (!condition) throw Error(message); };
    async function waitFor(test) { for(let i=0;i<100;i++){if(test())return;await delay(50);}throw Error('Chart window timed out'); }
    async function verify() {
      const root = createRoot(document.getElementById('app'));
      const popup = openChartPopup('Chart window qualification');
      assert(popup, 'No scriptable chart popup');
      const second = openChartPopup('Second chart');
      assert(second, 'Second chart window did not open');
      const secondRoot = createRoot(document.createElement('div'));
      secondRoot.render(<ChartPopupPortal popup={second} onClose={() => secondRoot.unmount()}>
        <Waveform signals={['out']} data={{scale:'time',log:'',vectors:[
          {name:'time',unit:'s',real:[0,1]},{name:'out',unit:'V',real:[0,8]}]}} />
      </ChartPopupPortal>);
      let docked = false;
      const render = value => root.render(<ChartPopupPortal popup={popup} onClose={() => { docked=true;root.render(<div>Returned to panel</div>); }}>
        <Waveform signals={['out','current']} data={{scale:'time',log:'',vectors:[
          {name:'time',unit:'s',real:[0,1]},{name:'out',unit:'V',real:[0,value]},{name:'current',unit:'A',real:[0,.002]}]}} />
      </ChartPopupPortal>);
      render(3);
      await waitFor(() => !!Chart.getChart(popup.root.querySelector('canvas')));
      let chart = Chart.getChart(popup.root.querySelector('canvas'));
      assert(chart.width>0 && chart.height>0,'Popup chart has no drawing area');
      assert(chart.options.scales.y0.title.text==='Voltage (V)' && chart.options.scales.y1.title.text==='Current (A)','Popup unit axes are wrong');
      assert(popup.child.document.styleSheets.length>0,'Popup theme styles are missing');
      render(7);
      await waitFor(() => Chart.getChart(popup.root.querySelector('canvas'))?.data.datasets[0].data.at(-1).y===7);
      chart=Chart.getChart(popup.root.querySelector('canvas'));
      assert(chart.canvas.toDataURL().length>1000,'Popup canvas did not render');
      popup.child.close();
      await waitFor(() => docked);
      assert(!second.child.closed,'Closing one chart closed another');
      await waitFor(() => !!Chart.getChart(second.root.querySelector('canvas')));
      assert(Chart.getChart(second.root.querySelector('canvas')).data.datasets[0].data.at(-1).y===8,'Second chart has the wrong result');
      secondRoot.unmount(); second.child.close();
      const drawing=blank();
      let source=createControl('source',drawing.sheets[0],drawing).symbol;
      source=updateControl(source,{...defaultSource(),waveform:'pulse'},drawing);
      const renderSource=()=>root.render(<FluentProvider theme={webLightTheme} style={{height:340}}>
        <SpiceControlPanel symbol={source} drawing={drawing} dispatch={action=>{
          if(action.type==='simulation/configure-control') {source=updateControl(source,action.config,drawing);renderSource();}
        }} />
      </FluentProvider>);
      const sourceSelect=()=>Array.from(document.querySelectorAll('select')).find(s=>s.querySelector('option[value="sine"]'));
      renderSource(); await waitFor(()=>!!sourceSelect());
      assert(sourceSelect().getBoundingClientRect().top<340,'Signal type is outside the visible source editor');
      sourceSelect().value='sine';sourceSelect().dispatchEvent(new Event('change',{bubbles:true}));
      await waitFor(()=>readControl(source).waveform==='sine');
      await waitFor(()=>Array.from(document.querySelectorAll('label')).some(label=>label.textContent==='Amplitude'));
      const label=Array.from(document.querySelectorAll('label')).find(label=>label.textContent==='Amplitude');
      const amplitude=document.getElementById(label.htmlFor);
      assert(amplitude,'Amplitude input is not associated with its label');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(amplitude,'2');
      amplitude.dispatchEvent(new Event('input',{bubbles:true}));
      await waitFor(()=>readControl(source).amplitude==='2');
      await waitFor(()=>Chart.getChart(document.querySelector('canvas'))?.data.datasets[0].data.some(point=>point.y>1.99));
      window.chartSmoke.report({ok:true,windows:2,unitAxes:2,liveValue:7,returnedToPanel:docked,sourceWaveform:readControl(source).waveform,sourceAmplitude:readControl(source).amplitude});
    }
    verify().catch(error=>window.chartSmoke.report({ok:false,error:error.stack}));
  `,
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  outfile: path.join(directory, 'renderer.js'),
  define: {
    'process.env.TARGET_SYSTEM': '"electron"',
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'error',
  plugins: [
    {
      name: 'isolate-application-startup',
      setup(builder) {
        builder.onResolve({ filter: /\/(?:startup|i18n)$/ }, (args) => ({
          path: args.path.endsWith('/startup') ? 'startup' : 'i18n',
          namespace: 'fixture',
        }));
        builder.onLoad(
          { filter: /.*/, namespace: 'fixture' },
          ({ path: service }) => ({
            contents:
              service === 'startup'
                ? 'export const store={dispatch(){}};export function getStore(){return store;}'
                : 'export default {t:key=>key};',
          }),
        );
      },
    },
  ],
});
await fs.writeFile(
  path.join(directory, 'index.html'),
  '<!doctype html><html><body><div id="app"></div><script src="renderer.js"></script></body></html>',
);
await fs.writeFile(
  path.join(directory, 'preload.cjs'),
  `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('chartSmoke',{report:data=>ipcRenderer.send('chart-smoke',data)});`,
);
await fs.writeFile(
  path.join(directory, 'main.cjs'),
  `
const {app,BrowserWindow,ipcMain}=require('electron');
const path=require('node:path');
app.setPath('userData',path.join(__dirname,'profile'));
app.commandLine.appendSwitch('disable-gpu');
(async()=>{
 const {chartWindowOptions,configureChartWindow}=await import(${JSON.stringify(
   new URL('../../electron/chartWindows.js', import.meta.url).href,
 )});
 await app.whenReady();
 const owner=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,preload:path.join(__dirname,'preload.cjs')}});
 owner.webContents.setWindowOpenHandler(details=>{
   const allowed=chartWindowOptions(details,owner);
   return allowed?{...allowed,overrideBrowserWindowOptions:{...allowed.overrideBrowserWindowOptions,show:false}}:{action:'deny'};
 });
 owner.webContents.on('did-create-window',(child,details)=>configureChartWindow(child,details,owner));
 const timer=setTimeout(()=>{console.error('Chart smoke timed out');app.exit(1);},20000);
 ipcMain.once('chart-smoke',(_event,data)=>{clearTimeout(timer);console.log(JSON.stringify(data));app.exit(data.ok?0:1);});
 await owner.loadFile(path.join(__dirname,'index.html'));
})().catch(error=>{console.error(error);app.exit(1);});
`,
);
const executable = createRequire(import.meta.url)('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = await new Promise((resolve, reject) => {
  const child = spawn(executable, [path.join(directory, 'main.cjs')], {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  child.once('error', reject);
  child.once('exit', (code) => resolve(code));
});
process.exitCode = result ?? 1;
