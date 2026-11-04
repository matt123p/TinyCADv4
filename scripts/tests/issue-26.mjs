import { runRegression } from './run-regression.mjs';

await runRegression(`
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocItemTypes } from './src/model/dsnItem';
import TImage from './src/components/svg/Image';
import TSymbol from './src/components/svg/Symbol';

const rectangle = { _id: 1, point: [13.5, 17.25], point_b: [33.5, 37.25], line_width: 1 };

const data = 'data:image/png;base64,dGVzdA==';
for (const dr of [0, 1, 2, 3, 4]) {
  const svg = renderToStaticMarkup(<svg><TImage dx={20} dy={30} dr={dr}
    scale_x={2} scale_y={3} data={{ ...rectangle, imageData: {id: 123, imageData: data} }}
    hover={false} selected={false} selected_handle={0} /></svg>);
  assert.ok(svg.includes('href="' + data + '"'), 'images must render without sheet-level definitions');
  assert.ok(!svg.includes('#img_'));
  assert.ok(!svg.includes('NaN'));
}

const symbolSvg = renderToStaticMarkup(<svg><TSymbol dx={0} dy={0} dr={0}
  data={{ _id: 3, point: [100, 100], rotation: 0, scale_x: 1, scale_y: 1,
    part: 0, textData: [], _symbol: {heterogeneous: false, outlines: [{
      items: [{ ...rectangle, NodeName: DocItemTypes.Image, imageData: {id: 123, imageData: data} }],
      size: [40, 40], ref_point: [0, 0], active_points: []
    }]} }} options={{}} hover={false} selected={false} selected_handle={0} /></svg>);
assert.ok(symbolSvg.includes('href="' + data + '"'), 'placed library symbol must include its bitmap');

console.log('Issue #26 regression checks passed.');
`);
