import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { compileString } from 'sass';

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
    import { SimulationSheet } from './src/components/simulation/SimulationSheet';
    import { ChartWorkspace } from './src/components/simulation/ChartWorkspace';
    import { OperatingPointOverlay } from './src/components/simulation/OperatingPointOverlay';
    import { createTeachingDrawing } from './src/simulation/examples';
    import { createLaboratoryDrawing } from './src/simulation/laboratoryExample';
    import { InstrumentPanel } from './src/components/panel/InstrumentPanel';
    import { InstrumentWindowHost } from './src/components/simulation/InstrumentWindows';
    import { getResult,putResult,activateResultDocument } from './src/simulation/resultStore';
    import { digest } from './src/io/dsnContainer';
    import { buildDeck } from './src/simulation/deck';
    import { NetlistWorkerState } from './src/web-worker/netlistState';
    import { runSimulation } from './src/simulation/session';
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const assert = (condition, message) => { if (!condition) throw Error(message); };
    async function waitFor(test) { for(let i=0;i<100;i++){if(test())return;await delay(50);}throw Error('Chart window timed out'); }
    async function verify() {
      let updateDepthWarning = false;
      const originalError = console.error;
      console.error = (...args) => {
        if (args.some(arg => String(arg).includes('Maximum update depth exceeded'))) updateDepthWarning = true;
        originalError(...args);
      };
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
        if(request.deck.includes('.tran')){
          const time=Array.from({length:1001},(_,i)=>i*.000005);
          send({type:'vectors',names:['time','in','out','bench','vp1#branch','v_psu1_sense#branch','@r3[i]']});
          send({type:'data',rows:time.map(t=>[t,Math.sin(2*Math.PI*1000*t),.15*Math.sin(2*Math.PI*1000*t-1.4),5,.001,.005,.005])});
        }else if(request.deck.includes('.op')){
          send({type:'vectors',names:['in','out','v1#branch','vp1#branch']});send({type:'data',rows:[[5,2.5,-.0025,.0025]]});
        }else{
          const frequency=Array.from({length:401},(_,i)=>10*10**(i/100));
          send({type:'vectors',names:['frequency','in','out','vp1#branch']});
          send({type:'data',rows:frequency.map(f=>{const w=2*Math.PI*f*resistance*1e-6;return[f,1,1/(1+w*w),0];}),imaginary:frequency.map(f=>{const w=2*Math.PI*f*resistance*1e-6;return[0,0,-w/(1+w*w),0];})});
        }
        send({type:'finished',state:'complete'});
      }};
      const fixtureDrawing=createTeachingDrawing('rc-low-pass');
      const base=DocStoreReducer(undefined,{type:'@@INIT'});
      const initial={...base,drawing:fixtureDrawing,view:{...base.view,selected_sheet:1}};
      const store=createStore((state={docStore:{present:initial}},action)=>({docStore:{present:DocStoreReducer(state.docStore.present,action)}}));
      const discoveryDrawing={...fixtureDrawing,sheets:fixtureDrawing.sheets.map(s=>s.kind==='simulation'?{...s,simulation:{...s.simulation,measurements:[],requirements:[],bindings:[],studies:[],studyRuns:[],testCases:[],sweeps:[],runs:[]}}:s)};
      const discoveryInitial={...initial,drawing:discoveryDrawing};
      const discoveryStore=createStore((state={docStore:{present:discoveryInitial}},action)=>({docStore:{present:DocStoreReducer(state.docStore.present,action)}}));
      root.render(<Provider key="tool-discovery" store={discoveryStore}><FluentProvider theme={webLightTheme}><SimulationSheet toolbarTarget={null}/></FluentProvider></Provider>);
      await waitFor(()=>!!document.querySelector('[aria-label="Circuit Explorer tools"]'));
      const emptyToolTabs=Array.from(document.querySelector('[aria-label="Circuit Explorer tools"]').querySelectorAll('[role="tab"]'));
      assert(emptyToolTabs.length===1 && emptyToolTabs[0].getAttribute('value')==='tools','New setups should start with the tool catalog only');
      document.querySelector('button[aria-label="Add Measurements"]').click();await delay(30);
      assert(!!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Add measurement'),'Adding measurements should reveal its editor');
      root.render(<Provider store={store}><FluentProvider theme={webLightTheme} style={{height:1000}}><SimulationSheet toolbarTarget={null}/><ChartWorkspace/><svg><OperatingPointOverlay sheetName={fixtureDrawing.sheets[0].name}/></svg></FluentProvider></Provider>);
      const button=(name)=>Array.from(document.querySelectorAll('button,[role="tab"]')).find(b=>b.textContent.trim()===name || (b.getAttribute('role')==='tab' && b.textContent.trim().startsWith(name)));
      const openExplorerTool=async name=>{
        const nav=document.querySelector('[aria-label="Circuit Explorer tools"]');
        const existing=Array.from(nav.querySelectorAll('[role="tab"]')).find(t=>t.textContent.startsWith(name));
        if(existing)existing.click();
        else {
          Array.from(nav.querySelectorAll('[role="tab"]')).find(t=>t.textContent.startsWith('Add tools')).click();
          await waitFor(()=>!!document.querySelector('button[aria-label="Add '+name+'"]'));
          document.querySelector('button[aria-label="Add '+name+'"]').click();
        }
        await delay(30);
      };
      await waitFor(()=>!!document.querySelector('[aria-label="Simulation views"]'));
      await waitFor(()=>document.querySelector('[aria-label="Circuit Explorer"]')?.textContent.includes('Low-pass cutoff'));
      const sheetTabs=()=>Array.from(document.querySelector('[aria-label="Simulation views"]').querySelectorAll('[role="tab"]')).map(t=>t.getAttribute('value'));
      assert(JSON.stringify(sheetTabs())===JSON.stringify(['setup']),'Empty simulation sheets must only show Setup');
      assert(!!document.querySelector('[aria-label="Simulation sheet"] [aria-label="Circuit Explorer"]'),'Circuit Explorer is missing from the simulation sheet');
      assert(!document.querySelector('[aria-label="Simulation charts"] [aria-label="Circuit Explorer"]'),'Circuit Explorer is still in the chart panel');
      const toolNav=document.querySelector('[aria-label="Circuit Explorer tools"]');
      assert(toolNav.getAttribute('aria-orientation')==='vertical','Explorer tools must use vertical navigation');
      assert(!Array.from(toolNav.querySelectorAll('[role="tab"]')).some(t=>t.textContent.startsWith('DC overlay')),'Unused tools should be hidden');
      assert(Array.from(document.querySelectorAll('.simulation-optional-section')).every(d=>!d.open),'Optional setup editors should start collapsed');
      const models=document.querySelector('[aria-label="Attached SPICE models"]');
      const modelsDisclosure=models.closest('details');
      modelsDisclosure.open=true;await delay(30);
      assert(!models.querySelector('details'),'SPICE models should not have another disclosure inside');
      assert(models.querySelector('input[aria-label="Attach SPICE model file"]').getBoundingClientRect().height>0,'Opening SPICE models must reveal the editor directly');
      modelsDisclosure.open=false;
      const beforeTools=JSON.stringify(store.getState().docStore.present.drawing.sheets[1].simulation);
      await openExplorerTool('DC overlay');
      assert(!!document.querySelector('select[aria-label="Schematic DC annotations"]'),'Adding a tool must reveal its controls');
      button('Hide tool').click();await delay(30);
      assert(!document.querySelector('select[aria-label="Schematic DC annotations"]'),'Hidden tool controls should not remain visible');
      assert(JSON.stringify(store.getState().docStore.present.drawing.sheets[1].simulation)===beforeTools,'Showing and hiding tools must preserve the saved setup');
      await openExplorerTool('Measurements');
      await waitFor(()=>!!button('Run'));button('Run').click();
      const setup=()=>store.getState().docStore.present.drawing.sheets[1].simulation;
      await waitFor(()=>setup().runs.length===1);
      await waitFor(()=>sheetTabs().includes('data'));
      assert(!sheetTabs().includes('plot') && sheetTabs().includes('data') && sheetTabs().includes('diagnostics'),'Simulation result tabs are incorrect');
      button('Data').click();await waitFor(()=>document.querySelector('[role="tabpanel"][aria-label="data"]')?.textContent.includes('samples'));
      button('Diagnostics').click();await waitFor(()=>document.querySelector('[role="tabpanel"][aria-label="diagnostics"]')?.textContent.includes('ui-fixture'));
      button('Setup').click();await waitFor(()=>!!document.querySelector('[aria-label="Circuit Explorer"]'));
      const panel=document.querySelector('[aria-label="Simulation charts"]');
      assert(!panel.querySelector('input[aria-label="Chart title"]'),'Charts still have editable names');
      button('Add chart').click();await delay(50);
      const chartSections=()=>Array.from(panel.querySelectorAll('section[aria-label="Chart"]'));
      const added=chartSections().at(-1);
      const chartOf=section=>Chart.getChart(section.querySelector('canvas'));
      await waitFor(()=>!!chartOf(added));
      assert(chartOf(added).data.datasets.length>0,'A new chart should start with sensible signals');
      added.querySelector('button[aria-label="Signals"]').click();await delay(30);
      const toggleSignal=async(section,name)=>{const item=Array.from(section.ownerDocument.querySelectorAll('[role="menuitemcheckbox"]')).find(l=>l.textContent===name);assert(item,'Missing signal '+name);item.click();await delay(30);};
      for(const dataset of [...chartOf(added).data.datasets])await toggleSignal(added,dataset.label);
      await waitFor(()=>chartOf(added)?.data.datasets.length===0);
      await toggleSignal(added,'V(out) (V)');await toggleSignal(added,'I(VP1) (A)');
      await waitFor(()=>chartOf(added)?.data.datasets.length===2);
      assert(Object.keys(chartOf(added).scales).filter(k=>k.startsWith('y')).length===2,'Mixed signals must keep separate unit axes');
      added.querySelector('button[aria-label="Zoom"]').click();await delay(30);
      const menuItem=(doc,text)=>Array.from(doc.querySelectorAll('[role="menuitem"]')).find(e=>e.textContent===text);
      assert(menuItem(document,'Zoom in') && menuItem(document,'Zoom out') && menuItem(document,'Fit'),'Zoom commands are missing from the menu');
      menuItem(document,'Zoom in').click();await delay(30);
      added.querySelector('button[aria-label="Chart menu"]').click();await delay(30);
      assert(menuItem(document,'Download CSV') && menuItem(document,'Download image') && menuItem(document,'Chart options and cursors'),'Chart actions are missing');
      menuItem(document,'Chart options and cursors').click();
      await waitFor(()=>!!document.querySelector('[role="group"][aria-label="Chart options and cursors"]'));
      const optionsGroup=document.querySelector('[role="group"][aria-label="Chart options and cursors"]');
      const gridLabel=Array.from(optionsGroup.querySelectorAll('label')).find(l=>l.textContent==='Grid');
      optionsGroup.querySelector('#'+CSS.escape(gridLabel.htmlFor)).click();
      await waitFor(()=>chartOf(added)?.options.scales.x.grid.display===false);
      for(let i=0;i<2;i++){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await delay(30);}
      const beforePop=chartSections().length;
      const nativeOpenChart=window.open;let chartChild;
      window.open=(...args)=>(chartChild=nativeOpenChart.apply(window,args));
      added.querySelector('button[aria-label="Open chart in a new window"]').click();
      await waitFor(()=>!!chartChild?.document.querySelector('section[aria-label="Chart"] canvas'));
      assert(chartSections().length===beforePop-1,'Popped out charts must leave no panel card');
      const popupSection=chartChild.document.querySelector('section[aria-label="Chart"]');
      assert(popupSection.querySelector('button[aria-label="Zoom"]') && popupSection.querySelector('button[aria-label="Chart menu"]'),'Popup chart controls differ from the panel');
      assert(chartOf(popupSection).options.scales.x.grid.display===false,'Chart options were lost when popping out');
      const popupRoot=popupSection.parentElement.parentElement;
      popupRoot.style.height='820px';
      chartChild.dispatchEvent(new chartChild.Event('resize'));
      await waitFor(()=>chartOf(popupSection)?.height>600);
      const tallHeight=chartOf(popupSection).height;
      popupRoot.style.height='420px';
      chartChild.dispatchEvent(new chartChild.Event('resize'));
      await waitFor(()=>chartOf(popupSection)?.height<tallHeight-300);
      assert(chartOf(popupSection).height>120,'A shorter popup must retain a usable plot');
      popupRoot.style.height='100%';
      chartChild.dispatchEvent(new chartChild.Event('resize'));
      popupSection.querySelector('button[aria-label="Chart menu"]').click();await delay(30);
      assert(menuItem(chartChild.document,'Download CSV') && menuItem(chartChild.document,'Download image'),'Popup downloads are missing');
      chartChild.document.dispatchEvent(new chartChild.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await delay(30);
      popupSection.querySelector('button[aria-label="Signals"]').click();await delay(30);await toggleSignal(popupSection,'V(out) (V)');await toggleSignal(popupSection,'I(VP1) (A)');
      await waitFor(()=>chartOf(popupSection)?.data.datasets.length===0);
      chartChild.close();window.open=nativeOpenChart;await waitFor(()=>chartSections().length===beforePop);
      chartSections().at(-1).querySelector('button[aria-label="Remove chart"]').click();
      const successfulSetup=setup();
      const failedRun={...successfulSetup.runs[0],id:'failed-without-data',state:'failed',samples:0,dataState:'not-retained',buildId:'no-data-solver',error:'Fixture failure'};
      store.dispatch({type:'simulation/update',sheetId:fixtureDrawing.sheets[1].id,setup:{...successfulSetup,runs:[...successfulSetup.runs,failedRun]}});
      await waitFor(()=>sheetTabs().includes('diagnostics')&&!sheetTabs().includes('data'));
      assert(!sheetTabs().includes('measurements'),'A run without numerical data must hide result tabs');
      button('Diagnostics').click();await waitFor(()=>document.querySelector('[role="tabpanel"][aria-label="diagnostics"]')?.textContent.includes('no-data-solver'));
      store.dispatch({type:'simulation/update',sheetId:fixtureDrawing.sheets[1].id,setup:successfulSetup});
      button('Setup').click();await waitFor(()=>!!document.querySelector('[aria-label="Circuit Explorer"]'));
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
      root.render(<Provider key="restored-sweep" store={store}><FluentProvider theme={webLightTheme} style={{height:1000}}><SimulationSheet toolbarTarget={null}/><ChartWorkspace/></FluentProvider></Provider>);
      await waitFor(()=>document.querySelector('[aria-label="Circuit Explorer"]')?.textContent.includes('Captured results'));button('Tune / sweep').click();
      await waitFor(()=>Array.from(document.querySelectorAll('canvas')).some(canvas=>Chart.getChart(canvas)?.data.datasets.length===5));
      assert(document.querySelector('[aria-label="Circuit Explorer"]').querySelectorAll('tbody tr').length===5,'Reopened sweep table is incomplete');
      const dcDrawing=createTeachingDrawing('voltage-divider');
      const dcInitial={...base,drawing:dcDrawing,view:{...base.view,selected_sheet:1}};
      const dcStore=createStore((state={docStore:{present:dcInitial}},action)=>({docStore:{present:DocStoreReducer(state.docStore.present,action)}}));
      root.render(<Provider key="dc-check" store={dcStore}><FluentProvider theme={webLightTheme} style={{height:1000}}><SimulationSheet toolbarTarget={null}/><ChartWorkspace/><svg><OperatingPointOverlay sheetName={dcDrawing.sheets[0].name}/></svg></FluentProvider></Provider>);
      await waitFor(()=>document.querySelector('[aria-label="Circuit Explorer"]')?.textContent.includes('Output voltage'));button('Run').click();
      await waitFor(()=>dcStore.getState().docStore.present.drawing.sheets[1].simulation.runs.length===1);
      await openExplorerTool('DC overlay');
      await waitFor(()=>!!document.querySelector('select[aria-label="Schematic DC annotations"]'));
      const overlaySelect=document.querySelector('select[aria-label="Schematic DC annotations"]');overlaySelect.value='voltages';overlaySelect.dispatchEvent(new Event('change',{bubbles:true}));
      await waitFor(()=>Array.from(document.querySelectorAll('svg text')).some(t=>t.textContent.includes('2.5 V')));
      const acquisition=()=>Array.from(document.querySelectorAll('select')).find(s=>Array.from(s.options).some(o=>o.value===dcStore.getState().docStore.present.drawing.sheets[1].simulation.runs[0].id));
      acquisition().value=dcStore.getState().docStore.present.drawing.sheets[1].simulation.runs[0].id;acquisition().dispatchEvent(new Event('change',{bubbles:true}));
      dcStore.dispatch({type:'simulation/apply-tuning',sheetId:dcDrawing.sheets[1].id,overrides:{resistance:'2kOhm'}});
      await waitFor(()=>!document.querySelector('g[aria-label="DC operating point"]'));
      const changed=dcStore.getState().docStore.present.drawing,changedSheet=changed.sheets[1];
      await runSimulation(changed,changedSheet.id,changedSheet.simulation,run=>{
        const current=dcStore.getState().docStore.present.drawing.sheets[1];
        dcStore.dispatch({type:'simulation/update',sheetId:current.id,setup:{...current.simulation,runs:[...current.simulation.runs,run]}});
      });
      await waitFor(()=>dcStore.getState().docStore.present.drawing.sheets[1].simulation.runs.length===2 && acquisition().value==='latest' && !!document.querySelector('canvas'));
      await waitFor(()=>!!document.querySelector('g[aria-label="DC operating point"]'));
      const lab=createLaboratoryDrawing(),labSetup=lab.sheets[1].simulation;
      const time=Array.from({length:1001},(_,i)=>i*.000005);
      const labData={scale:'time',log:'',vectors:[{name:'time',unit:'s',real:time},{name:'in',unit:'V',real:time.map(t=>Math.sin(2*Math.PI*1000*t))},{name:'out',unit:'V',real:time.map(t=>.15*Math.sin(2*Math.PI*1000*t-1.4))},{name:'bench',unit:'V',real:time.map(()=>5)},{name:'v_psu1_sense#branch',unit:'A',real:time.map(()=>.005)}]};
      const hash=await digest(new TextEncoder().encode(buildDeck(new NetlistWorkerState().init({...lab,sheets:[lab.sheets[0]]}),labSetup)+JSON.stringify(labSetup.models)));
      const labRun={id:'lab-ui-acquisition',created:new Date().toISOString(),state:'complete',backend:'native',buildId:'ui-fixture',circuitHash:hash,setupHash:hash,analysis:{...labSetup.analysis},parameters:{},samples:time.length,pinned:false,dataState:'available'};
      activateResultDocument(lab.documentId);putResult(labRun.id,labData);labSetup.runs=[labRun];
      const labInitial={...base,drawing:lab,view:{...base.view,selected_sheet:1}};
      const labStore=createStore((state={docStore:{present:labInitial}},action)=>({docStore:{present:DocStoreReducer(state.docStore.present,action)}}));
      const labSymbols=lab.sheets[0].items.filter(i=>i.NodeName==='symbol'&&readControl(i)?.kind==='instrument');
      const scopeSymbol=labSymbols.find(i=>readControl(i).type==='scope'),meterSymbol=labSymbols.find(i=>readControl(i).type==='meter');
      const renderLab=symbol=>root.render(<Provider key="laboratory" store={labStore}><FluentProvider theme={webLightTheme} style={{height:1200}}><InstrumentPanel symbol={symbol} drawing={labStore.getState().docStore.present.drawing} dispatch={labStore.dispatch}/><InstrumentWindowHost/><SimulationSheet toolbarTarget={null}/><ChartWorkspace/></FluentProvider></Provider>);
      const children=[],nativeOpen=window.open;window.open=(...args)=>{const child=nativeOpen.apply(window,args);if(child)children.push(child);return child;};
      renderLab(scopeSymbol);await waitFor(()=>!!document.querySelector('[aria-label="scope instrument"] canvas'));
      const previousRuns=labStore.getState().docStore.present.drawing.sheets[1].simulation.runs.length;
      button('Acquire').click();
      await waitFor(()=>labStore.getState().docStore.present.drawing.sheets[1].simulation.runs.length===previousRuns+1);
      assert(labStore.getState().docStore.present.drawing.sheets[1].simulation.runs.at(-1).state==='complete','Scope Acquire did not complete');
      button('Pop out instrument').click();await waitFor(()=>children.length===1 && !!children[0].document.querySelector('canvas'));
      const scopeChart=()=>Chart.getChart(children[0].document.querySelector('canvas'));
      await waitFor(()=>!!scopeChart());
      assert(scopeChart().options.scales.y0.min===-4 && scopeChart().options.scales.y1.max===.4,'Independent scope volts/div settings were not applied');
      await window.chartSmoke.capture('OSC1','instrument-scope.png');
      renderLab(meterSymbol);await waitFor(()=>!!document.querySelector('[aria-label="meter instrument"]'));
      assert(!children[0].closed,'Changing selection closed the scope instrument');
      button('Pop out instrument').click();await waitFor(()=>children.length===2 && !!children[1].document.querySelector('[aria-label="Multimeter display"]'));
      await window.chartSmoke.capture('DMM1','instrument-meter.png');
      const timebaseLabel=Array.from(children[0].document.querySelectorAll('label')).find(l=>l.textContent==='Time / division (s)');
      const timebase=children[0].document.getElementById(timebaseLabel.htmlFor);
      Object.getOwnPropertyDescriptor(children[0].HTMLInputElement.prototype,'value').set.call(timebase,'2ms');timebase.dispatchEvent(new children[0].Event('input',{bubbles:true}));
      await waitFor(()=>readControl(labStore.getState().docStore.present.drawing.sheets[0].items.find(i=>i._id===scopeSymbol._id)).timebase==='2ms');
      assert(readControl(labStore.getState().docStore.present.drawing.sheets[0].items.find(i=>i._id===meterSymbol._id)).type==='meter','Scope popup edited the wrong symbol');
      const scopeAcquisition=()=>Array.from(children[0].document.querySelectorAll('select')).find(s=>Array.from(s.options).some(o=>o.value===labRun.id));
      scopeAcquisition().value=labRun.id;scopeAcquisition().dispatchEvent(new children[0].Event('change',{bubbles:true}));
      labStore.dispatch({type:'simulation/apply-tuning',sheetId:lab.sheets[1].id,overrides:{resistance:'2kOhm'}});
      await waitFor(()=>!children[0].document.querySelector('canvas'));
      const updatedLab=labStore.getState().docStore.present.drawing,updatedSetup=updatedLab.sheets[1];
      await runSimulation(updatedLab,updatedSetup.id,updatedSetup.simulation,run=>{
        const current=labStore.getState().docStore.present.drawing.sheets[1];
        labStore.dispatch({type:'simulation/update',sheetId:current.id,setup:{...current.simulation,runs:[...current.simulation.runs,run]}});
      });
      await waitFor(()=>!!children[0].document.querySelector('canvas') && scopeAcquisition()?.value===labStore.getState().docStore.present.drawing.sheets[1].simulation.runs.at(-1).id);
      children[0].close();await delay(100);assert(!children[1].closed,'Closing the scope closed the meter');children[1].close();window.open=nativeOpen;
      button('Analysis lab').click();await waitFor(()=>Array.from(document.querySelectorAll('label')).some(l=>l.textContent==='Workflow'));
      const workflowLabel=Array.from(document.querySelectorAll('label')).find(l=>l.textContent==='Workflow'),workflowSelect=document.getElementById(workflowLabel.htmlFor);
      assert(!Array.from(workflowSelect.options).some(o=>['fault','spectrum'].includes(o.value)),'P2 workflows leaked into P1');
      workflowSelect.value='variation';workflowSelect.dispatchEvent(new Event('change',{bubbles:true}));
      await waitFor(()=>!!button('Run study'));
      const samplesLabel=Array.from(document.querySelectorAll('label')).find(l=>l.textContent==='Samples (2–100)');const samples=document.getElementById(samplesLabel.htmlFor);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(samples,'2');samples.dispatchEvent(new Event('input',{bubbles:true}));
      await delay(30);button('Run study').click();await waitFor(()=>labStore.getState().docStore.present.drawing.sheets[1].simulation.studyRuns?.at(-1)?.state==='complete'&&labStore.getState().docStore.present.drawing.sheets[1].simulation.studyRuns.at(-1).points.length===2);
      assert(labStore.getState().docStore.present.drawing.sheets[1].simulation.studyRuns.at(-1).points.every(p=>p.state==='complete'),'UI tolerance study failed');
      assert(!updateDepthWarning,'Scope acquisition or controls caused a React update loop');
      window.chartSmoke.report({ok:true,windows:2,unitAxes:2,liveValue:7,returnedToPanel:docked,sourceWaveform:readControl(source).waveform,sourceAmplitude:readControl(source).amplitude,explorer:{temporaryTuning:true,cachedReset:true,apply:true,sweepCurves:5,metricPoints:5,restoredSweep:true,typedRequirement:checks[0].state,dcOverlay:true,staleOverlayHidden:true},laboratory:{acquireButton:true,instrumentWindows:2,independentClosure:true,selectionPreserved:true,targetedControls:true,dualScale:true,monteCarloPoints:2,p2Excluded:true}});
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
    'process.env.NODE_ENV': '"development"',
  },
  logLevel: 'error',
  plugins: [
    {
      name: 'isolate-application-startup',
      setup(builder) {
        builder.onLoad({ filter: /\.scss$/ }, async ({ path: filename }) => ({
          contents: compileString(await fs.readFile(filename, 'utf8')).css,
          loader: 'css',
        }));
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
  '<!doctype html><html><head><link rel="stylesheet" href="renderer.css"></head><body><div id="app"></div><script src="renderer.js"></script></body></html>',
);
await fs.writeFile(
  path.join(directory, 'preload.cjs'),
  `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('chartSmoke',{report:data=>ipcRenderer.send('chart-smoke',data),capture:(title,name)=>ipcRenderer.invoke('lab-capture',title,name)});`,
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
 ipcMain.handle('lab-capture',async(_event,title,name)=>{if(!['instrument-scope.png','instrument-meter.png'].includes(name))throw Error('Unexpected capture name');const instrument=BrowserWindow.getAllWindows().find(w=>w.getTitle()===title);if(!instrument)throw Error('No instrument window to capture');const png=await instrument.webContents.capturePage();require('node:fs').writeFileSync(path.join(__dirname,name),png.toPNG());});
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
if (!process.argv.includes('--build-only')) {
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
}
