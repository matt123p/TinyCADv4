import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { createRequire } from 'node:module';
import { runRegression } from './run-regression.mjs';
import { loadComponent } from './load-component.mjs';

test('chart sampling preserves peaks and full-resolution complex CSV data', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import { chartPoints, displayUnit, displayValue } from './src/simulation/chartData';
    import { csv } from './src/simulation/export';
    const signal={name:'Out "measured"',unit:'V',real:Array(10000).fill(0),imaginary:Array(10000).fill(0)};
    signal.real[5033]=100;signal.real[5034]=-40;signal.imaginary[5033]=20;
    const data={scale:'time',log:'',vectors:[{name:'time',unit:'s',real:Array.from({length:10000},(_,i)=>i*.001)},signal]};
    const points=chartPoints(data,signal,'real',false);
    assert.ok(points.length<=4800);
    assert.ok(points.some(p=>p.y===100));assert.ok(points.some(p=>p.y===-40));
    assert.ok(points.every((p,i)=>!i || p.x>points[i-1].x));
    const detailed=chartPoints(data,signal,'real',false,{min:5.03,max:5.04});
    assert.ok(detailed.some(p=>p.x===5.035),'zoom resolves individual samples between overview buckets');
    const descending={...data,vectors:[{...data.vectors[0],real:[...data.vectors[0].real].reverse()},signal]};
    assert.ok(chartPoints(descending,signal,'real',false,{min:5.03,max:5.04}).length>=10);
    assert.ok(chartPoints(data,signal,'real',true).every(p=>p.x>0));
    assert.equal(displayValue(0,1,'phase'),90);assert.equal(displayUnit(signal,'db'),'dB');
    assert.equal(displayValue(3,4,'magnitude'),5);
    const exported=csv(data);
    assert.equal(exported.split('\r\n').length,10001);
    assert.ok(exported.includes('"Out ""measured"" [V]"'));
    assert.ok(exported.includes('imaginary [V]'));
  `);
});

test('Chart.js uses independent unit axes, labelled scale, baseline and full-data CSV download', () => {
  const effect = [],
    downloads = [];
  let reference = 0,
    configuration,
    destroyed = false;
  class FakeChart {
    static register() {}
    constructor(_canvas, config) {
      configuration = config;
    }
    destroy() {
      destroyed = true;
    }
  }
  const actualData = loadComponent('src/simulation/chartData.ts', {});
  const module = loadComponent('src/components/simulation/Waveform.tsx', {
    react: {
      ...React,
      useState: (initial) => [initial, () => {}],
      useMemo: (fn) => fn(),
      useRef: () => ({ current: reference++ === 0 ? {} : undefined }),
      useEffect: (fn) => effect.push(fn),
    },
    'chart.js': { Chart: FakeChart, registerables: [] },
    'chartjs-plugin-zoom': {},
    '../../simulation/chartData': actualData,
    '../../simulation/signals': loadComponent('src/simulation/signals.ts', {}),
    '../../simulation/export': {
      csv: (data) => JSON.stringify(data),
      download: (...args) => downloads.push(args),
    },
  });
  const data = {
    scale: 'time',
    log: '',
    vectors: [
      { name: 'time', unit: 's', real: [0, 0.1, 0.2] },
      { name: 'out', unit: 'V', real: [1, 2, 3] },
      { name: 'v1#branch', unit: 'A', real: [-0.1, -0.2, -0.3] },
    ],
  };
  const tree = module.Waveform({
    data,
    signals: ['out', 'v1#branch'],
    baseline: data,
  });
  const cleanup = effect[0]();
  assert.equal(configuration.options.scales.x.title.text, 'Time (s)');
  assert.equal(configuration.data.datasets[0].label, 'out (V)');
  assert.equal(configuration.options.scales.y0.position, 'left');
  assert.equal(configuration.options.scales.y1.position, 'right');
  assert.equal(configuration.options.scales.y0.title.text, 'Voltage (V)');
  assert.equal(configuration.options.scales.y1.title.text, 'Current (A)');
  assert.deepEqual(
    configuration.data.datasets.map((d) => d.yAxisID),
    ['y0', 'y0', 'y1', 'y1'],
  );
  assert.equal(configuration.options.plugins.zoom.zoom.wheel.enabled, true);
  assert.equal(configuration.options.plugins.zoom.pan.enabled, true);
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.props?.children === 'Download CSV') node.props.onClick();
    React.Children.forEach(node.props?.children, visit);
  }
  visit(tree);
  assert.equal(downloads.length, 1);
  assert.deepEqual(JSON.parse(downloads[0][1]).vectors, data.vectors);
  cleanup();
  assert.equal(destroyed, true);
});
