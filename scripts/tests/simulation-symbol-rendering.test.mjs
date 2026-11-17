import { test } from 'node:test';
import { runRegression } from './run-regression.mjs';

test('new SPICE symbols render their pin labels before placement and after configuration', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import TSymbol from './src/components/svg/Symbol';
    import { blank } from './src/io/ioXml';
    import { createControl, updateControl } from './src/simulation/controlSymbols';
    import { defaultSource } from './src/simulation/controls';
    import { updateSymbol } from './src/manipulators/updateSymbol';
    const before = globalThis.document;
    globalThis.document={createElement:()=>({getContext:()=>({font:'',measureText:text=>({width:String(text).length*8,actualBoundingBoxDescent:3})})})};
    try {
      const drawing=blank(), sheet=drawing.sheets[0];
      const render = symbol => {
        for(const pin of symbol._symbol.outlines[0].items.filter(item=>item.NodeName==='pin')) {
          assert.ok(pin.textData?.name,'visible pin names require initialized text layout');
          assert.ok(pin.textData?.number,'pin-number layout must also be initialized');
        }
        const markup=renderToStaticMarkup(React.createElement('svg',null,React.createElement(TSymbol,{
          dx:0,dy:0,dr:0,data:symbol,options:sheet.options,hover:false,selected:false,selected_handle:-1,
        })));
        assert.match(markup,/<text/);
        for (const pin of symbol._symbol.outlines[0].items.filter(item=>item.NodeName==='pin' && item.show_name))
          assert.ok(markup.includes(pin.name),'visible pin labels must render');
      };
      for(const tool of ['source','probe','differential-probe','current-probe','controlled']) {
        const {symbol}=createControl(tool,sheet,drawing);
        render(symbol);
        render(new updateSymbol(symbol).rotate(3));
        if(tool==='source') render(updateControl(symbol,{...defaultSource(),type:'current',waveform:'sine'},drawing));
        if(tool==='probe') render(updateControl(symbol,{kind:'probe',mode:'differential',invert:false},drawing));
        if(tool==='controlled') render(updateControl(symbol,{kind:'controlled',type:'current',gain:'1m'},drawing));
      }
    } finally {globalThis.document=before;}
  `);
});
