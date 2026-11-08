import { test } from 'node:test';
import { runRegression } from './run-regression.mjs';

test('source icons render the selected waveform without moving terminals', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import TSymbol from './src/components/svg/Symbol';
    import { blank } from './src/io/ioXml';
    import { createControl, updateControl } from './src/simulation/controlSymbols';
    import { defaultSource } from './src/simulation/controls';
    import { updateSymbol } from './src/manipulators/updateSymbol';
    const previous=globalThis.document;
    globalThis.document={createElement:()=>({getContext:()=>({font:'',measureText:text=>({width:String(text).length*8,actualBoundingBoxDescent:3})})})};
    try {
      const drawing=blank(), sheet=drawing.sheets[0];
      const original=createControl('source',sheet,drawing).symbol;
      const paths = symbol => {
        const svg=renderToStaticMarkup(React.createElement('svg',null,React.createElement(TSymbol,{
          dx:0,dy:0,dr:0,data:symbol,options:sheet.options,hover:false,selected:false,selected_handle:-1,
        })));
        return [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(match=>match[1]);
      };
      const terminals=new updateSymbol(original).active_points().map(p=>p.slice(0,2));
      const signatures=new Set(), definitions=new Set();
      let pulse;
      for(const waveform of ['dc','sine','pulse','triangle','pwl','exponential','fm']) {
        const symbol=updateControl(original,{...defaultSource(),waveform},drawing);
        signatures.add(JSON.stringify(paths(symbol)));
        definitions.add(symbol._symbol.uid);
        assert.deepEqual(new updateSymbol(symbol).active_points().map(p=>p.slice(0,2)),terminals);
        if(waveform==='pulse') pulse=symbol;
      }
      assert.equal(signatures.size,7,'each signal type must change the drawing paths, not just its label');
      assert.equal(definitions.size,7,'different waveforms must not share clipboard/library artwork identity');
      // A saved source with earlier generic artwork still displays its configured waveform.
      const oldArtwork={...pulse,_symbol:original._symbol};
      const priorDefinition=JSON.stringify(oldArtwork._symbol);
      assert.deepEqual(paths(oldArtwork),paths(pulse));
      assert.equal(JSON.stringify(oldArtwork._symbol),priorDefinition,'rendering does not edit the saved definition');
      const currentPulse=updateControl(original,{...defaultSource(),type:'current',waveform:'pulse'},drawing);
      assert.ok(paths(currentPulse).length>paths(pulse).length,'current sources retain a direction arrow alongside the waveform');
    } finally {globalThis.document=previous;}
  `);
});
