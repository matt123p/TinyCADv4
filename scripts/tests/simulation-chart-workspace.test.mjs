import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  chartWindowOptions,
  configureChartWindow,
} from '../../electron/chartWindows.js';
import { runRegression } from './run-regression.mjs';
import React from 'react';
import { loadComponent } from './load-component.mjs';

test('chart panel renders startup drawings without an active simulation session', () => {
  let drawing, active;
  const emptyNet = { symbols: [], nets: {}, nodes: {}, labels: {}, eprops: {} };
  const module = loadComponent('src/components/simulation/ChartWorkspace.tsx', {
    react: {
      ...React,
      useState: value => [typeof value === 'function' ? value() : value, () => {}],
      useRef: value => ({ current: value }),
      useMemo: callback => callback(),
      useCallback: callback => callback,
      useEffect: () => {},
    },
    'react-redux': {
      useSelector: selector => selector({ docStore: { present: { drawing } } }),
      useDispatch: () => () => {}, useStore: () => ({}),
    },
    '../../simulation/session': { getSession: () => active },
    '../../simulation/chartWorkspace': { drawingProbes: () => [], workspaceChartData: () => undefined, suggestedCharts: () => [] },
    '../../simulation/resultStore': { getResult: () => undefined },
    '../../io/drawingSaveFormat': { hasSimulation: doc => doc.simulationContent },
    '../../web-worker/netlistState': { NetlistWorkerState: class { init() { return emptyNet; } } },
  });
  const render = () => {
    const workspace = module.ChartWorkspace();
    return workspace.type(workspace.props);
  };
  drawing = { documentId: 'blank', sheets: [{ id: 'circuit', items: [] }] };
  assert.equal(render(), null, 'an ordinary startup drawing needs no chart panel');
  drawing = { ...drawing, simulationContent: true };
  assert.equal(render().type, 'aside', 'source/probe-only drawings render before a setup exists');
  const setup = { id: 'experiment', kind: 'simulation', simulation: { runs: [] } };
  drawing = { ...drawing, sheets: [...drawing.sheets, setup] };
  assert.equal(render().type, 'aside', 'an idle simulation sheet has no live session data');
  active = { sheetId: 'other-experiment', data: { vectors: [], log: '', scale: '' } };
  assert.equal(render().type, 'aside', 'another experiment must not be treated as the selected live run');
});

test('charts stay independent of probes and offer raw, probe and derived signals without stale results', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import { createTeachingDrawing } from './src/simulation/examples';
    import { drawingProbes, reconcileCharts, workspaceChartData, suggestedCharts, chartSignalLabel } from './src/simulation/chartWorkspace';
    import { NetlistWorkerState } from './src/web-worker/netlistState';
    const before=globalThis.document;
    globalThis.document={createElement:()=>({getContext:()=>({font:'',measureText:text=>({width:String(text).length*8,actualBoundingBoxDescent:3})})})};
    try {
      const drawing=createTeachingDrawing('voltage-divider');
      const probes=drawingProbes(drawing);
      assert.equal(probes.length,3);
      let charts=reconcileCharts([],probes,new Set(),true);
      assert.equal(charts.length,3);
      assert.ok(charts.every(c=>c.signals.length===1),'each placed probe gets a useful default chart');
      assert.equal(reconcileCharts(charts,probes,new Set(),true),charts,'unchanged reconciliation preserves chart state');
      const hidden=new Set(['outputs']);
      assert.deepEqual(reconcileCharts([],probes,hidden,true),[],'a removed chart must stay removed');
      assert.equal(reconcileCharts(charts,probes.slice(1),hidden,true),charts,'removing a probe must preserve user charts');
      const outputs=reconcileCharts([],[],new Set(),true);
      assert.deepEqual(outputs,[],'wait for data instead of creating an empty default');
      assert.deepEqual(reconcileCharts([],[],new Set(['outputs']),true),[]);
      const custom={id:'custom',signals:['out']};
      assert.deepEqual(reconcileCharts([custom],[],new Set(),true),[custom]);
      const net=new NetlistWorkerState().init(drawing);
      assert.match(chartSignalLabel('pr2','V',probes,net),/^PR2: V\(OUT\)$/i,'probe legends identify both probe and measured node');
      assert.equal(chartSignalLabel('out','V',probes,net),'V(out)');
      assert.equal(chartSignalLabel('v1#branch','A',probes,net),'I(V1)');
      const data={scale:'time',log:'',vectors:[{name:'time',unit:'s',real:[0,1]},
        {name:'in',unit:'V',real:[5,5]},{name:'out',unit:'V',real:[2.5,2.5]},
        {name:'vp1#branch',unit:'A',real:[.0025,.0025]}]};
      const defaults=suggestedCharts([],data);
      assert.deepEqual(defaults.map(c=>c.signals),[['out','in'],['vp1#branch']],'without probes, group voltage and current separately and prefer output nodes');
      assert.deepEqual(suggestedCharts([],data,['out']).map(c=>c.signals),[['out']],'saved output selections express user intent');
      const crowded={...data,vectors:[data.vectors[0],{name:'0',unit:'V',real:[0,0]},
        ...Array.from({length:20},(_,i)=>({name:'node'+i,unit:'V',real:[1,1]})),
        {name:'@r1[i]',unit:'A',real:[1,1]}]};
      assert.deepEqual(suggestedCharts([],crowded).map(c=>c.signals.length),[4],'limit clutter and skip internal device vectors when ordinary outputs exist');
      const waiting=[{id:'manual-before-run',signals:[],awaitingSignals:true}];
      assert.equal(reconcileCharts(waiting,[],new Set(),true),waiting);
      const filled=reconcileCharts(waiting,[],new Set(),true,data);
      assert.deepEqual(filled[0].signals,['out','in'],'charts opened before the first run get useful signals when data arrives');
      const cleared=[{id:'manually-cleared',signals:[]}];
      assert.equal(reconcileCharts(cleared,[],new Set(),true,data),cleared,'never refill a chart the user cleared');
      assert.deepEqual(reconcileCharts([],[],hidden,true,data),[],'deleted charts stay deleted when more data arrives');
      const probeChart={id:'chart',signals:['pr2','in']};
      const result=workspaceChartData(probeChart,probes,net,data,[],true);
      assert.deepEqual(result.vectors.find(v=>v.name==='pr2').real,[2.5,2.5]);
      assert.equal(result.vectors.find(v=>v.name==='pr2').real,data.vectors[2].real,'voltage charts share read-only numerical buffers');
      assert.ok(result.vectors.some(v=>v.name==='in'),'probe charts can also select raw outputs');
      assert.equal(workspaceChartData(probeChart,probes,net,data,[],false),undefined);
      assert.ok(workspaceChartData(probeChart,[],net,data,[],true).vectors.some(v=>v.name==='out'),'a chart can use other signals if a probe is removed');
      const derived=workspaceChartData(custom,probes,net,data,[{name:'Gain',left:'out',right:'in',operation:'divide'}],true);
      assert.deepEqual(derived.vectors.at(-1).real,[.5,.5]);
    } finally {globalThis.document=before;}
  `);
});

test('Electron permits only named chart blank windows and closes them with their owner', () => {
  const owner = new EventEmitter(),
    child = new EventEmitter();
  const details = {
    url: 'about:blank',
    frameName: 'tinycad-chart-12345678-1234-1234-1234-123456789abc',
  };
  const result = chartWindowOptions(details, owner, 'icon');
  assert.equal(result.action, 'allow');
  assert.equal(result.overrideBrowserWindowOptions.parent, owner);
  assert.equal(
    result.overrideBrowserWindowOptions.webPreferences,
    undefined,
    'retain the secure inherited application preferences',
  );
  assert.equal(
    chartWindowOptions({ ...details, url: 'https://example.com' }, owner),
    undefined,
  );
  assert.equal(
    chartWindowOptions({ ...details, frameName: 'anything' }, owner),
    undefined,
  );
  let removedMenu = false,
    handler,
    prevented = false,
    destroyed = false;
  child.removeMenu = () => {
    removedMenu = true;
  };
  child.isDestroyed = () => destroyed;
  child.destroy = () => {
    destroyed = true;
    child.emit('closed');
  };
  child.webContents = new EventEmitter();
  child.webContents.setWindowOpenHandler = (fn) => {
    handler = fn;
  };
  configureChartWindow(child, details, owner);
  assert.equal(removedMenu, true);
  assert.deepEqual(handler({ url: 'about:blank' }), { action: 'deny' });
  child.webContents.emit('will-navigate', {
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  owner.emit('closed');
  assert.equal(destroyed, true);
  assert.equal(owner.listenerCount('closed'), 0);
});
