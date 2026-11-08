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
    '../../simulation/chartWorkspace': { drawingProbes: () => [] },
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

test('chart workspace defaults to probes, respects removal and supports custom charts without stale results', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import { createTeachingDrawing } from './src/simulation/examples';
    import { drawingProbes, reconcileCharts, workspaceChartData } from './src/simulation/chartWorkspace';
    import { NetlistWorkerState } from './src/web-worker/netlistState';
    const before=globalThis.document;
    globalThis.document={createElement:()=>({getContext:()=>({font:'',measureText:text=>({width:String(text).length*8,actualBoundingBoxDescent:3})})})};
    try {
      const drawing=createTeachingDrawing('voltage-divider');
      const probes=drawingProbes(drawing);
      assert.equal(probes.length,3);
      let charts=reconcileCharts([],probes,new Set(),true);
      assert.equal(charts.length,3);
      assert.equal(reconcileCharts(charts,probes,new Set(),true),charts,'unchanged reconciliation preserves chart state');
      const removed=charts[0];
      const hidden=new Set([removed.probeId]);
      charts=reconcileCharts(charts.slice(1),probes,hidden,true);
      assert.equal(charts.length,2,'a removed probe chart must stay removed');
      charts=reconcileCharts(charts,probes.slice(1),hidden,true);
      assert.ok(charts.every(c=>c.probeId!==removed.probeId));
      const outputs=reconcileCharts([],[],new Set(),true);
      assert.equal(outputs[0].id,'outputs');
      assert.deepEqual(reconcileCharts([],[],new Set(['outputs']),true),[]);
      const custom={id:'custom',title:'Custom',signals:['out']};
      assert.deepEqual(reconcileCharts([custom],[],new Set(),true),[custom]);
      const net=new NetlistWorkerState().init(drawing);
      const data={scale:'time',log:'',vectors:[{name:'time',unit:'s',real:[0,1]},
        {name:'in',unit:'V',real:[5,5]},{name:'out',unit:'V',real:[2.5,2.5]},
        {name:'vp1#branch',unit:'A',real:[.0025,.0025]}]};
      const outProbe=probes.find(p=>p.title.startsWith('PR2'));
      const probeChart={id:outProbe.id,title:outProbe.title,probeId:outProbe.id,signals:[]};
      const result=workspaceChartData(probeChart,probes,net,data,[],true);
      assert.deepEqual(result.vectors.at(-1).real,[2.5,2.5]);
      assert.equal(result.vectors.at(-1).real,data.vectors[2].real,'voltage charts share read-only numerical buffers');
      assert.equal(workspaceChartData(probeChart,probes,net,data,[],false),undefined);
      assert.equal(workspaceChartData(probeChart,[],net,data,[],true),undefined);
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
