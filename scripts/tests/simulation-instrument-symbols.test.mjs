import { test } from 'node:test';
import { runRegression } from './run-regression.mjs';

test('separate meter sockets survive mode changes, upgrades and save/reopen; unused lab terminals are exempt from DRC', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import {blank} from './src/io/ioXml';import {createControl,updateControl,resizeStudentInstrument} from './src/simulation/controlSymbols';
    import {readControl,CONTROL_ATTRIBUTE} from './src/simulation/controls';import {instrumentInputPin} from './src/simulation/instruments';
    import {updateSymbol} from './src/manipulators/updateSymbol';import {updateDrawing} from './src/manipulators/updateDrawing';
    import {NetlistWorkerState} from './src/web-worker/netlistState';import {encodeDrawing,decodeDrawing} from './src/io/dsnCodec';
    globalThis.document={createElement:()=>({getContext:()=>({font:'',measureText:text=>({width:String(text).length*5,actualBoundingBoxDescent:1})})})};
    const pins=s=>new updateSymbol(s).active_points().map(p=>[p[0],p[1],p[2].number]);
    async function verify(){
      let drawing=blank(),sheet=drawing.sheets[0],meter;
      for(const [i,type] of ['meter','scope','supply','generator','source'].entries()){
        const added=createControl(type,sheet,drawing);
        const symbol=new updateSymbol({...added.symbol,point:[400*i,500],_active_points:null}).post_construction();
        sheet={...added.sheet,items:[...sheet.items,symbol]};drawing={...drawing,sheets:[sheet]};if(type==='meter')meter=symbol;
      }
      const before=pins(meter),labels=meter._symbol.outlines[0].items.filter(i=>i.NodeName==='pin').map(p=>p.name);
      assert.deepEqual(labels,['V Ω','COM','A']);
      for(const mode of ['dcV','acV','ohm','dcA','acA']){
        const configured=updateControl(meter,{...readControl(meter),mode,range:'auto'},drawing);
        assert.deepEqual(pins(configured),before,'Switching mode must not move any of the three sockets');
        const template=configured.text.find(f=>f.description==='$$SPICE').value;
        assert.ok(template.includes('%('+instrumentInputPin(readControl(configured))+')'));
        assert.ok(!template.includes(mode.endsWith('A')?'%(1)':'%(3)'),'Unused input must not affect the measurement or circuit loading');
      }
      const options=Object.fromEntries(Object.keys(drawing.drc).map(k=>[k,false]));
      const net=new NetlistWorkerState().init(drawing),errors=new updateDrawing().designRulesCheck(drawing,{...options,UnConnected:true},net);
      const ordinary=sheet.items.at(-1);assert.equal(errors.length,2,'Ordinary component terminals must still receive unconnected-net diagnostics');assert.ok(errors.every(e=>e.id===ordinary._id));
      const duplicate={...meter,_id:ordinary._id+100,point:[2200,500],_active_points:null};
      const duplicateDrawing={...drawing,sheets:[{...sheet,items:[...sheet.items,duplicate]}]};
      assert.ok(new updateDrawing().designRulesCheck(duplicateDrawing,{...options,DupRef:true},new NetlistWorkerState().init(duplicateDrawing)).some(e=>e.text.includes('Duplicated')),'Instrument exemption must not suppress unrelated DRC errors');
      const reopened=await decodeDrawing(await encodeDrawing(drawing));assert.deepEqual(pins(reopened.sheets[0].items[0]),before);
      // Simulate an older two-socket meter that used pin 1 for both tasks.
      for(const mode of ['dcV','dcA'])for(let rotation=0;rotation<8;rotation++){
        const outline=meter._symbol.outlines[0],config={...readControl(meter),mode};
        const legacy=new updateSymbol({...meter,rotation,_active_points:null,
          text:meter.text.map(f=>f.description===CONTROL_ATTRIBUTE?{...f,value:JSON.stringify(config)}:f),
          _symbol:{...meter._symbol,outlines:[{...outline,items:outline.items.filter(i=>i.NodeName!=='pin'||i.number!=='3'),active_points:outline.active_points.filter(p=>p.pin.number!=='3')}]},
        }).post_construction();
        const old=pins(legacy),upgraded=resizeStudentInstrument(legacy),next=pins(upgraded);
        assert.equal(next.length,3);
        assert.equal(new Set(next.map(p=>p.slice(0,2).join(','))).size,3,'Upgrading a current meter must not put the new voltage jack on the retained A input');
        const input=next.find(p=>p[2]===(mode==='dcA'?'3':'1')),original=old.find(p=>p[2]==='1');
        assert.deepEqual(input.slice(0,2),original.slice(0,2),'Existing leads must remain connected to the input used by the saved mode');
        assert.deepEqual(next.find(p=>p[2]==='2').slice(0,2),old.find(p=>p[2]==='2').slice(0,2));
        assert.ok(upgraded.text.find(f=>f.description==='$$SPICE').value.includes('%('+instrumentInputPin(config)+')'));
      }
    }
    module.exports=verify();
  `);
});

test('generated laboratory file contains full-size instruments without relying on load-time upgrades', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';import fs from 'node:fs';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import sharp from 'sharp';
    import {TDrawing} from './src/components/svg/Drawing';
    import {ioXML} from './src/io/ioXml';import {XMLBuilder} from './src/util/xmlbuilder';import {unpackDsn} from './src/io/dsnContainer';
    import {updateSymbol} from './src/manipulators/updateSymbol';import {readControl} from './src/simulation/controls';import {resizeStudentInstrument} from './src/simulation/controlSymbols';
    globalThis.document={createElement:()=>({getContext:()=>({font:'',measureText:text=>({width:String(text).length*5,actualBoundingBoxDescent:1})})})};
    async function verify(){
      const {xml}=await unpackDsn(fs.readFileSync('examples/simulation/virtual-laboratory.dzn')),builder=new XMLBuilder();builder.fromText(xml);
      const drawing=new ioXML().from_dsn(builder),sheet=drawing.sheets[0];let count=0;
      for(const item of sheet.items){
        if(item.NodeName!=='symbol'||readControl(item)?.kind!=='instrument')continue;count++;
        assert.equal(item.scale_x,1.5);assert.equal(item.scale_y,1.5);assert.equal(resizeStudentInstrument(item),item,'Generated files must already contain corrected footprints');
        const b=new updateSymbol(item).getBoundingRect();
        assert.ok(b.x1>=0&&b.y1>=0&&b.x2<=sheet.details.page_size[0]&&b.y2<=sheet.details.page_size[1],'Full-size instrument must fit on the generated page');
      }
      assert.equal(count,4);
      const markup=renderToStaticMarkup(React.createElement(TDrawing,{dx:0,dy:0,dr:0,scale_x:1,scale_y:1,items:sheet.items,options:sheet.options,editLibrary:false,heterogeneous:false,part:0,show_power:false,hover:false,selected:false,selected_handle:0,selection:[],add:null,hover_obj:null}));
      const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1500"><rect width="1600" height="1500" fill="white"/>'+markup+'</svg>';
      fs.mkdirSync('build/qualification/instrument-symbols',{recursive:true});fs.writeFileSync('build/qualification/instrument-symbols/generated-laboratory.svg',svg);
      await sharp(Buffer.from(svg)).png().toFile('build/qualification/instrument-symbols/generated-laboratory.png');
    }
    module.exports=verify();
  `);
});

test('saved laboratory instruments actually grow on load while their nets stay unchanged', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';import fs from 'node:fs';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import sharp from 'sharp';
    import TSymbol from './src/components/svg/Symbol';
    import {ioXML} from './src/io/ioXml';import {XMLBuilder} from './src/util/xmlbuilder';
    import {unpackDsn} from './src/io/dsnContainer';import {decodeDrawing,encodeDrawing} from './src/io/dsnCodec';
    import {updateSymbol} from './src/manipulators/updateSymbol';import {readControl} from './src/simulation/controls';
    import {resizeStudentInstrument,resizeStudentInstruments,updateControl} from './src/simulation/controlSymbols';
    import {instrumentLayouts} from './src/simulation/instrumentSymbols';
    import {NetlistWorkerState} from './src/web-worker/netlistState';import {buildDeck} from './src/simulation/deck';
    globalThis.document={createElement:()=>({getContext:()=>({font:'',measureText:text=>({width:String(text).length*5,actualBoundingBoxDescent:1})})})};
    const pins=s=>new updateSymbol(s).active_points().map(p=>[p[0],p[1],p[2].number]);
    function samePins(a,b){a.forEach(p=>{const next=b.find(q=>q[2]===p[2]);assert.ok(next);assert.ok(Math.hypot(p[0]-next[0],p[1]-next[1])<1e-8,'Resizing must retain every wire connection');});}
    async function verify(){
      const bytes=fs.readFileSync('scripts/tests/fixtures/virtual-laboratory-compact.dzn');
      const {xml}=await unpackDsn(bytes),builder=new XMLBuilder();builder.fromText(xml);
      const before=new ioXML().from_dsn(builder),after=await decodeDrawing(bytes);
      let count=0;const panels=[];
      for(let i=0;i<before.sheets.length;i++)for(let j=0;j<before.sheets[i].items.length;j++){
        const old=before.sheets[i].items[j];if(old.NodeName!=='symbol'||readControl(old)?.kind!=='instrument')continue;
        const next=after.sheets[i].items[j],config=readControl(next),layout=instrumentLayouts[config.type];count++;
        samePins(pins(old),pins(next));assert.equal(next.scale_x,1.5);assert.equal(next.scale_y,1.5);
        const bounds=new updateSymbol(next).getBoundingRect(),previous=new updateSymbol(old).getBoundingRect();
        assert.equal(bounds.x2-bounds.x1,layout.size[0]*1.5);assert.ok(bounds.x2-bounds.x1>(previous.x2-previous.x1)*3,'Loaded symbols must visibly grow, not just new placements');
        for(const [column,symbol] of [old,next].entries()){
          const b=new updateSymbol(symbol).getBoundingRect();
          const placed=new updateSymbol({...symbol,point:[symbol.point[0]-b.x1+column*500+30,symbol.point[1]-b.y1+(count-1)*380+30],_active_points:null}).post_construction();
          panels.push(renderToStaticMarkup(React.createElement(TSymbol,{dx:0,dy:0,dr:0,data:placed,options:after.sheets[i].options,hover:false,selected:false,selected_handle:-1})));
        }
        samePins(pins(next),pins(updateControl(next,config,after)));
        for(let rotation=0;rotation<8;rotation++){
          const rotated=new updateSymbol({...old,rotation,_active_points:null}).post_construction();samePins(pins(rotated),pins(resizeStudentInstrument(rotated)));
        }
      }
      assert.equal(count,4,'Exercise all four devices in the actual saved example');
      fs.mkdirSync('build/qualification/instrument-symbols',{recursive:true});
      const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1520"><rect width="1000" height="1520" fill="#f8fafc"/>'+panels.join('')+'</svg>';
      fs.writeFileSync('build/qualification/instrument-symbols/saved-before-after.svg',svg);
      await sharp(Buffer.from(svg)).png().toFile('build/qualification/instrument-symbols/saved-before-after.png');
      const deck=d=>buildDeck(new NetlistWorkerState().init({...d,sheets:d.sheets.filter(s=>s.kind!=='simulation')}),d.sheets.find(s=>s.kind==='simulation').simulation);
      assert.equal(deck(after),deck(before),'Growing cases must not alter the generated electrical circuit');
      const reopened=await decodeDrawing(await encodeDrawing(after));
      for(let i=0;i<after.sheets.length;i++)for(let j=0;j<after.sheets[i].items.length;j++){
        const item=after.sheets[i].items[j];if(item.NodeName==='symbol'&&readControl(item)?.kind==='instrument')samePins(pins(item),pins(reopened.sheets[i].items[j]));
      }
      assert.equal(deck(reopened),deck(after));
      assert.deepEqual(resizeStudentInstruments(after),after,'Loading again must not grow or rewrite devices again');
    }
    module.exports=verify();
  `);
});

test('friendly instruments use coloured native artwork and grid-aligned front-panel sockets', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
    import fs from 'node:fs';import sharp from 'sharp';
    import TSymbol from './src/components/svg/Symbol';
    import {blank} from './src/io/ioXml';
    import {createControl,updateControl,controlDrawingItems,resizeStudentInstrument} from './src/simulation/controlSymbols';
    import {defaultInstrument} from './src/simulation/instruments';
    import {readControl} from './src/simulation/controls';
    import {updateSymbol} from './src/manipulators/updateSymbol';
    import {instrumentLayouts} from './src/simulation/instrumentSymbols';
    import {encodeDrawing,decodeDrawing} from './src/io/dsnCodec';
    globalThis.document={createElement:()=>({getContext:()=>({font:'',measureText(text){return {width:String(text).length*(parseFloat(this.font)||8)*.55,actualBoundingBoxDescent:1};}})})};
    async function verify(){
      let drawing=blank(),sheet=drawing.sheets[0];
      const panels=[];
      for(const [index,type] of ['scope','meter','generator','supply'].entries()){
        const added=createControl(type,sheet,drawing),symbol=added.symbol;
        sheet={...added.sheet,items:[...sheet.items,symbol]};drawing={...drawing,sheets:[sheet]};
        const outline=symbol._symbol.outlines[0],layout=instrumentLayouts[type];
        assert.ok(symbol._symbol.uid.endsWith('-v3'));assert.deepEqual(outline.size,layout.size);
        assert.equal(symbol.scale_x,1.5);assert.equal(symbol.scale_y,1.5,'Student devices use a 1.5x placement scale');
        const bounds=new updateSymbol(symbol).getBoundingRect();
        assert.equal(bounds.x2-bounds.x1,layout.size[0]*1.5);assert.equal(bounds.y2-bounds.y1,layout.size[1]*1.5);
        for(const scale of [2,3,6])for(let rotation=0;rotation<8;rotation++){
          const stored=new updateSymbol({...symbol,scale_x:scale,scale_y:scale,rotation,_active_points:null}).post_construction();
          const resized=resizeStudentInstrument(stored),b=new updateSymbol(resized).getBoundingRect();
          assert.equal(resized.scale_x,1.5);assert.equal(resized.scale_y,1.5);
          const expected=rotation%2?[layout.size[1]*1.5,layout.size[0]*1.5]:layout.size.map(n=>n*1.5);
          assert.deepEqual([b.x2-b.x1,b.y2-b.y1],expected,'Existing native symbols also use the corrected size');
          assert.deepEqual(new updateSymbol(resized).active_points().map(p=>p.slice(0,2)),new updateSymbol(stored).active_points().map(p=>p.slice(0,2)));
        }
        assert.ok(outline.items.filter(i=>i.NodeName==='label').every(i=>i.font_size>=6),'Face labels must grow along with the case');
        const pins=outline.items.filter(i=>i.NodeName==='pin');
        assert.equal(pins.length,type==='scope'?4:type==='meter'?3:2);
        for(const pin of pins){
          assert.equal(pin.length,0,'The connection is directly in the socket centre');
          assert.ok(pin.point.every(n=>n%5===0),'Sockets snap to the schematic grid');
          assert.ok(pin.point[1]>=layout.size[1]*.75,'Inputs belong on the lower front panel');
          assert.ok(outline.items.some(i=>i.NodeName==='ellipse'&&(i.point[0]+i.point_b[0])/2===pin.point[0]&&(i.point[1]+i.point_b[1])/2===pin.point[1]),'Every electrical anchor has a visible socket');
        }
        assert.ok(new Set(outline.items.filter(i=>i.filled).map(i=>i.fill_colour)).size>=5,'Device should use friendly screen, case and socket colours');
        const before=new updateSymbol(symbol).active_points().map(p=>[p[0],p[1],p[2].number]);
        const configured=updateControl(symbol,{...readControl(symbol),mode:'acV',voltage:'12V',source:{...readControl(symbol).source,waveform:'pulse'}},drawing);
        assert.deepEqual(new updateSymbol(configured).active_points().map(p=>[p[0],p[1],p[2].number]),before,'Changing settings must not move sockets');
        assert.equal(new updateSymbol(symbol).is_inside({dx:0,dy:0,dr:0},[-layout.size[0]/2,-layout.size[1]/2],false).item,symbol,'The case remains selectable');
        const render=s=>renderToStaticMarkup(React.createElement(TSymbol,{dx:0,dy:0,dr:0,data:s,options:sheet.options,hover:false,selected:false,selected_handle:-1}));
        const snapshot=JSON.stringify(symbol._symbol),markup=render(symbol);assert.ok(markup.includes('fill'));assert.ok(!markup.includes('stroke:red'),'Face lettering must not display net-label connection markers');assert.equal(JSON.stringify(symbol._symbol),snapshot,'Rendering must not edit saved definitions');
        if(type!=='scope')assert.notEqual(configured._symbol.uid,symbol._symbol.uid,'Different face settings must not share clipboard artwork identity');
        for(const rotation of [0,1,2,3,4,5,6,7]){
          const rotated=new updateSymbol({...symbol,rotation,_active_points:null}).post_construction();
          const changed=updateControl(rotated,{...readControl(symbol),mode:'acV',voltage:'12V'},drawing);
          assert.deepEqual(new updateSymbol(changed).active_points().map(p=>p.slice(0,2)),new updateSymbol(rotated).active_points().map(p=>p.slice(0,2)),'Rotated and mirrored devices keep their sockets');
          assert.ok(!render(rotated).includes('NaN'));
        }
        const anchor=[index%2?1080:525,index<2?465:885];
        const placed=new updateSymbol({...symbol,point:anchor,_active_points:null}).post_construction();
        panels.push('<g>'+render(placed)+'</g>');
      }
      assert.ok(instrumentLayouts.scope.size[0]>instrumentLayouts.scope.size[1]);
      assert.ok(instrumentLayouts.meter.size[1]>instrumentLayouts.meter.size[0]);
      assert.ok(instrumentLayouts.meter.ports.find(p=>p.number==='2').point[0]<instrumentLayouts.meter.ports.find(p=>p.number==='1').point[0],'COM is left of the red measurement jack');
      const reopened=await decodeDrawing(await encodeDrawing(drawing));
      for(let i=0;i<sheet.items.length;i++){
        assert.deepEqual(new updateSymbol(reopened.sheets[0].items[i]).active_points().map(p=>p.slice(0,2)),new updateSymbol(sheet.items[i]).active_points().map(p=>p.slice(0,2)),'Save/reopen preserves every socket');
        assert.deepEqual(reopened.sheets[0].items[i]._symbol.outlines[0].items.filter(i=>i.NodeName==='label').map(i=>i.text),sheet.items[i]._symbol.outlines[0].items.filter(i=>i.NodeName==='label').map(i=>i.text),'Face text survives round trip');
      }
      fs.mkdirSync('build/qualification/instrument-symbols',{recursive:true});
      const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="930" viewBox="0 0 1200 930"><rect width="1200" height="930" fill="#f8fafc"/>'+panels.join('')+'</svg>';
      fs.writeFileSync('build/qualification/instrument-symbols/devices.svg',svg);
      await sharp(Buffer.from(svg)).png().toFile('build/qualification/instrument-symbols/devices.png');
    }
    module.exports=verify();
  `);
});

test('older wired instruments gain coloured faces without moving terminals or mutating saved artwork', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import {blank} from './src/io/ioXml';
    import {createControl,updateControl,controlDrawingItems} from './src/simulation/controlSymbols';
    import {defaultInstrument} from './src/simulation/instruments';
    import {defaultSource} from './src/simulation/controls';
    import {updateSymbol} from './src/manipulators/updateSymbol';
    import {get_global_id} from './src/util/global_id';
    globalThis.document={createElement:()=>({getContext:()=>({font:'',measureText:text=>({width:String(text).length*5,actualBoundingBoxDescent:1})})})};
    const drawing=blank(),sheet=drawing.sheets[0];
    for(const version of ['v1','v2'])for(const type of ['scope','meter','generator','supply']){
      let source=createControl('source',sheet,drawing).symbol;
      source={...source,_symbol:{...source._symbol,uid:'tinycad-spice-source-voltage-dc-'+version}};
      source=updateControl(source,defaultSource(),drawing);
      const original=new updateSymbol(source).active_points();
      const device=updateControl(source,defaultInstrument(type),drawing);
      for(const pin of original){const moved=new updateSymbol(device).active_points().find(p=>p[2].number===pin[2].number);assert.ok(Math.hypot(moved[0]-pin[0],moved[1]-pin[1])<1e-9,'Existing source-to-device conversions preserve attached wires');}
      const pins=new updateSymbol(device).active_points().map(p=>p.slice(0,2));
      const changed=updateControl(device,{...defaultInstrument(type),mode:'acA',voltage:'12V'},drawing);
      assert.deepEqual(new updateSymbol(changed).active_points().map(p=>p.slice(0,2)),pins);
      const snapshot=JSON.stringify(device._symbol),id=get_global_id();
      const art=controlDrawingItems(device);controlDrawingItems(device);
      assert.equal(get_global_id(),id+1,'Drawing faces must not consume global IDs');
      assert.equal(JSON.stringify(device._symbol),snapshot,'Render-time upgrades leave the document untouched');
      assert.ok(new Set(art.filter(i=>i.filled).map(i=>i.fill_colour)).size>=5);
      assert.deepEqual(art.filter(i=>i.NodeName==='pin').map(i=>i.point),device._symbol.outlines[0].items.filter(i=>i.NodeName==='pin').map(i=>i.point));
    }
  `);
});
