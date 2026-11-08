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
    import { Provider } from 'react-redux';
    import { createStore } from 'redux';
    import { DocStoreReducer } from './src/state/stores/docStoreReducer';
    import { ChartWorkspace } from './src/components/simulation/ChartWorkspace';
    import { OperatingPointOverlay } from './src/components/simulation/OperatingPointOverlay';
    import { createTeachingDrawing } from './src/simulation/examples';
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
      // DOM integration checks use deterministic solver events; the separate native
      // Explorer regression runs the exact same orchestration against ngspice.
      const events = new Set(); let acquisitions=0;
      window.electronAPI={onSimulation:fn=>{events.add(fn);return()=>events.delete(fn);},stopSimulation(){},async startSimulation(request){
        acquisitions++;await delay(20);
        const send=event=>events.forEach(fn=>fn(request.runId,event));
        send({type:'ready',info:{backend:'native',buildId:'ui-fixture'}});
        const resistance=Number(/^R1\\s+\\S+\\s+\\S+\\s+(\\S+)/im.exec(request.deck)?.[1]?.replace('k','e3')||1000);
        if(request.deck.includes('.op')){
          send({type:'vectors',names:['in','out','v1#branch','vp1#branch']});send({type:'data',rows:[[5,2.5,-.0025,.0025]]});
        }else{
          const frequency=Array.from({length:401},(_,i)=>10*10**(i/100));
          send({type:'vectors',names:['frequency','in','out','vp1#branch']});
          send({type:'data',rows:frequency.map(f=>{const w=2*Math.PI*f*resistance*1e-6;return[f,1,1/(1+w*w),0];}),imaginary:frequency.map(f=>{const w=2*Math.PI*f*resistance*1e-6;return[0,0,-w/(1+w*w),0];})});
        }
        send({type:'finished',state:'complete'});
      }};
      const fixtureDrawing=createTeachingDrawing('rc-low-pass');
      const initial={...DocStoreReducer(undefined,{type:'@@INIT'}),drawing:fixtureDrawing};
      const store=createStore((state={docStore:{present:initial}},action)=>({docStore:{present:DocStoreReducer(state.docStore.present,action)}}));
      root.render(<Provider store={store}><FluentProvider theme={webLightTheme} style={{height:1000}}><ChartWorkspace/><svg><OperatingPointOverlay sheetName={fixtureDrawing.sheets[0].name}/></svg></FluentProvider></Provider>);
      const button=(name)=>Array.from(document.querySelectorAll('button,[role="tab"]')).find(b=>b.textContent.trim()===name || (b.getAttribute('role')==='tab' && b.textContent.trim().startsWith(name)));
      await waitFor(()=>!!button('Run'));button('Run').click();
      const setup=()=>store.getState().docStore.present.drawing.sheets[1].simulation;
      await waitFor(()=>setup().runs.length===1);
      assert(setup().runs[0].explorer.measurements[0].state==='valid','Named metric did not capture');
      button('Tune / sweep').click();
      const tuningInput=()=>document.querySelector('input[aria-label="R1 resistance temporary value"]');
      await waitFor(()=>!!tuningInput());
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(tuningInput(),'2.2kOhm');tuningInput().dispatchEvent(new Event('input',{bubbles:true}));
      await waitFor(()=>setup().runs.length===2 && !button('Apply').disabled);
      assert(setup().runs.at(-1).explorer.measurements[0].value>72 && setup().runs.at(-1).explorer.measurements[0].value<73,'Tuned cutoff is wrong');
      const resistor=()=>store.getState().docStore.present.drawing.sheets[0].items.find(i=>i.text?.find?.(f=>f.description==='Ref'&&f.value==='R1'));
      assert(resistor().text.find(f=>f.description==='Value').value==='1k','Tuning changed the saved value');
      button('Reset').click();
      await waitFor(()=>tuningInput().value==='1k' && !button('Run tuning').disabled);
      assert(acquisitions===2,'Reset failed to reuse the original acquisition');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(tuningInput(),'2.2kOhm');tuningInput().dispatchEvent(new Event('input',{bubbles:true}));
      await delay(600);await waitFor(()=>!button('Apply').disabled);button('Apply').click();
      await waitFor(()=>resistor().text.find(f=>f.description==='Value').value==='2200');
      Array.from(document.querySelectorAll('summary')).find(s=>s.textContent==='One-variable sweep').click();
      button('Run sweep').click();
      await waitFor(()=>Array.from(document.querySelectorAll('canvas')).some(canvas=>Chart.getChart(canvas)?.data.datasets.length===5));
      const trend=Array.from(document.querySelectorAll('canvas')).map(canvas=>Chart.getChart(canvas)).find(chart=>chart?.data.datasets[0]?.label?.startsWith('Low-pass cutoff'));
      assert(trend?.data.datasets[0].data.length===5,'Metric versus parameter chart is missing');
      assert(trend.options.scales.y0.title.text==='Hz','Metric axis has the wrong unit');
      const explorerRows=Array.from(document.querySelector('[aria-label="Circuit Explorer"]').querySelectorAll('tbody tr'));
      assert(explorerRows.length===5,'Sweep table does not contain all values');
      assert(explorerRows.every(tr=>tr.textContent.includes('complete')),'Sweep contains failed acquisitions');
      button('Requirements').click();await waitFor(()=>document.querySelector('[aria-label="Circuit Explorer"]').textContent.includes('Nominal component check'));
      const checks=setup().runs.at(-1).explorer.checks;
      assert(checks[0].state==='fail','Changed design should fail the nominal cutoff requirement');
      assert(setup().sweeps.length===1 && setup().sweeps[0].state==='complete' && setup().sweeps[0].points.length===5,'Sweep history was not captured');
      root.render(<Provider key="restored-sweep" store={store}><FluentProvider theme={webLightTheme} style={{height:1000}}><ChartWorkspace/></FluentProvider></Provider>);
      await waitFor(()=>document.querySelector('[aria-label="Circuit Explorer"]')?.textContent.includes('Captured results'));button('Tune / sweep').click();
      await waitFor(()=>Array.from(document.querySelectorAll('canvas')).some(canvas=>Chart.getChart(canvas)?.data.datasets.length===5));
      assert(document.querySelector('[aria-label="Circuit Explorer"]').querySelectorAll('tbody tr').length===5,'Reopened sweep table is incomplete');
      const dcDrawing=createTeachingDrawing('voltage-divider');
      const dcInitial={...DocStoreReducer(undefined,{type:'@@INIT'}),drawing:dcDrawing};
      const dcStore=createStore((state={docStore:{present:dcInitial}},action)=>({docStore:{present:DocStoreReducer(state.docStore.present,action)}}));
      root.render(<Provider key="dc-check" store={dcStore}><FluentProvider theme={webLightTheme} style={{height:1000}}><ChartWorkspace/><svg><OperatingPointOverlay sheetName={dcDrawing.sheets[0].name}/></svg></FluentProvider></Provider>);
      await waitFor(()=>document.querySelector('[aria-label="Circuit Explorer"]')?.textContent.includes('Output voltage'));button('Run').click();
      await waitFor(()=>dcStore.getState().docStore.present.drawing.sheets[1].simulation.runs.length===1);
      button('DC overlay').click();
      await waitFor(()=>!!document.querySelector('select[aria-label="Schematic DC annotations"]'));
      const overlaySelect=document.querySelector('select[aria-label="Schematic DC annotations"]');overlaySelect.value='voltages';overlaySelect.dispatchEvent(new Event('change',{bubbles:true}));
      await waitFor(()=>Array.from(document.querySelectorAll('svg text')).some(t=>t.textContent.includes('2.5 V')));
      dcStore.dispatch({type:'simulation/apply-tuning',sheetId:dcDrawing.sheets[1].id,overrides:{resistance:'2kOhm'}});
      await waitFor(()=>!document.querySelector('g[aria-label="DC operating point"]'));
      window.chartSmoke.report({ok:true,windows:2,unitAxes:2,liveValue:7,returnedToPanel:docked,sourceWaveform:readControl(source).waveform,sourceAmplitude:readControl(source).amplitude,explorer:{temporaryTuning:true,cachedReset:true,apply:true,sweepCurves:5,metricPoints:5,restoredSweep:true,typedRequirement:checks[0].state,dcOverlay:true,staleOverlayHidden:true}});
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
