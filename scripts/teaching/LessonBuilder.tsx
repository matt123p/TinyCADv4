import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {blank,ioXML} from '../../src/io/ioXml';
import {XMLBuilder} from '../../src/util/xmlbuilder';
import {updateView} from '../../src/manipulators/updateView';
import {updateSymbol} from '../../src/manipulators/updateSymbol';
import {updateLabel} from '../../src/manipulators/updateLabel';
import {updateText} from '../../src/manipulators/updateText';
import {updateFactory} from '../../src/manipulators/updateFactory';
import {get_global_id} from '../../src/util/global_id';
import {createControl,updateControl} from '../../src/simulation/controlSymbols';
import {defaultSource} from '../../src/simulation/controls';
import {createSimulationSheet} from '../../src/simulation/document';
import {NetlistWorkerState} from '../../src/web-worker/netlistState';
import {buildDeck} from '../../src/simulation/deck';
import {checkSpiceComponents} from '../../src/simulation/diagnostics';
import {encodeDrawing,decodeDrawing} from '../../src/io/dsnCodec';
import {layoutMarkdown} from '../../src/util/markdown';
import ServerDrawing from '../../renderer/ServerDrawing';
import SvgDefs from '../../src/components/svg/SvgDefs';
import {layoutTeachingSheet} from './layout';
import {orientTeachingSymbol} from './orientation';
export {orientTeachingSymbol} from './orientation';
export {prepareTeachingWiring, validateTeachingRoundTrip, wireCoverage} from './layout';
const font={font_name:'Arial',font_size:9,font_colour:'#142d43',font_bold:false,font_italic:false};
const style={stroked:true,line_colour:'#32495f',line_width:.7,line_pattern:0,filled:false,fill_colour:'#ffffff',hatch:0,rounded_rect:false};
const groundNames=new Set(['GND','VSS','V-','COMMON','REF','K']);
export class LessonBuilder {
 drawing:any;sheet:any;components:any[]=[];wires:any[]=[];outputs:string[]=[];inputs:string[]=[];refs:any={};analysis:any={kind:'op'};parameters:any={};notes:string[]=[];
 constructor(public data:any,public library:any){this.drawing=blank();this.drawing.documentId=data.uuid;this.sheet=this.drawing.sheets[0];this.sheet.id=data.uuid.replace(/^./,'b');this.sheet.name=data.id+' · Circuit';this.sheet.details={...this.sheet.details,title:data.title,author:'TinyCAD teaching examples',date:'',page_size:[1200,800],grid:5,grid_snap:true};}
 ref(prefix:string){this.refs[prefix]=(this.refs[prefix]||0)+1;return prefix+this.refs[prefix];}
 sync(){this.drawing.sheets[0]=this.sheet;}
 wire(...points:any[]){const clean=points.filter((p,i)=>!i||p[0]!==points[i-1][0]||p[1]!==points[i-1][1]);for(let i=1;i<clean.length;i++){if(clean[i][0]!==clean[i-1][0]&&clean[i][1]!==clean[i-1][1])throw Error('Non-orthogonal wire '+this.data.id);const w={NodeName:'wire',_id:get_global_id(),d_points:[clean[i-1].slice(0,2),clean[i].slice(0,2)],_magnetic:null};this.sheet.items.push(w);this.wires.push(w);}}
 label(point:any,text:string){const l=new updateLabel({...font,NodeName:'label',_id:get_global_id(),point:[...point],rotation:0,which:0,text,textData:null}).post_construction();this.sheet.items.push(l);}
 ground(point:any){this.sheet.items.push({...font,NodeName:'power',_id:get_global_id(),point:[...point],which:4,rotation:0,text:'0',hints:[]});}
 ports(symbol:any,entry:any){return Object.fromEntries(entry.pins.map(p=>{const number=entry.mapping[p.logical_number];const ap=[...new updateSymbol(symbol).active_points(),...new updateSymbol(symbol).power_pins()].find(p=>p[2].number===number);if(!ap)throw Error('Missing '+entry.id+':'+p.name);return[p.name,[ap[0],ap[1]]];}));}
 component(id:string,anchor:any,options:any={}){
  const entry=this.library.find(e=>e.id===id&&(!options.style||e.style===options.style));if(!entry)throw Error('Unknown lesson symbol '+id);
  const xml=new XMLBuilder();xml.fromText(entry.xml);const parsed=new ioXML().from_dsn(xml);
  let placed=new updateView().handleSelectLibrarySymbol({},this.sheet,entry.name,parsed.sheets.map(s=>s.items),anchor);this.sheet=placed.sheet;
  let symbol=this.sheet.items.at(-1);symbol.text.find(t=>t.description==='Ref').value=this.ref(options.prefix||entry.name.Reference.replace(/[?0-9]/g,''));
  for(const [key,value]of Object.entries(options.fields||{})){const f=symbol.text.find(t=>t.description===key);if(!f)throw Error(id+' unknown field '+key);f.value=String(value);}
  const anchorName=options.anchor||entry.pins[0].name;
  if(!options.orientation)symbol=orientTeachingSymbol(symbol,entry,s=>this.ports(s,entry));
  if(options.orientation){for(let rotation=0;rotation<4;rotation++){const candidate={...symbol,rotation,_active_points:null},p=this.ports(candidate,entry),names=Object.keys(p);const a=p[names[0]],b=p[names[1]],dx=b[0]-a[0],dy=b[1]-a[1];if(options.orientation==='h'&&Math.abs(dy)<.01&&dx>0||options.orientation==='v'&&Math.abs(dx)<.01&&dy>0){symbol=candidate;break;}}}
  if(options.reverse)symbol={...symbol,rotation:(symbol.rotation+2)%4,_active_points:null};
  let p=this.ports(symbol,entry),a=p[anchorName];symbol={...symbol,point:[symbol.point[0]+anchor[0]-a[0],symbol.point[1]+anchor[1]-a[1]],_active_points:null};
  symbol.text=symbol.text.map(f=>({...f,show:false}));symbol=new updateSymbol(symbol).post_construction();
  const bounds=new updateSymbol(symbol).getBoundingRect();symbol.text=symbol.text.map(f=>({...f,show:f.description==='Ref'||f.description==='Value'&&f.value.length<=18,position:[bounds.x1-symbol.point[0]+(options.orientation==='v'?-45:3),bounds.y1-symbol.point[1]-(f.description==='Ref'?(options.orientation==='h'?34:22):(options.orientation==='h'?22:10))]}));symbol=new updateSymbol(symbol).post_construction();
  this.sheet.items[this.sheet.items.length-1]=symbol;this.sync();p=this.ports(symbol,entry);const result={id,symbol,p,bounds:new updateSymbol(symbol).getBoundingRect(),ref:symbol.text.find(t=>t.description==='Ref').value};this.components.push(result);return result;
 }
 source(anchor:any,net='IN',config:any={},negative='0'){
  this.sync();const added=createControl('source',this.sheet,this.drawing);this.sheet.symbols=added.sheet.symbols;let symbol=updateControl(added.symbol,{...defaultSource(),dc:'5',acMagnitude:'0',...config},this.drawing);
  symbol.text.find(t=>t.description==='Ref').value=this.ref('V');const p=new updateSymbol(symbol).active_points().find(p=>p[2].number==='1');symbol={...symbol,point:[symbol.point[0]+anchor[0]-p[0],symbol.point[1]+anchor[1]-p[1]],_active_points:null};symbol=new updateSymbol(symbol).post_construction();
  symbol.text=symbol.text.map(t=>({...t,show:t.description==='Ref',position:[-26,-20]}));symbol=new updateSymbol(symbol).post_construction();this.sheet.items.push(symbol);this.sync();
  const ports=new updateSymbol(symbol).active_points();const a=ports.find(p=>p[2].number==='1').slice(0,2),b=ports.find(p=>p[2].number==='2').slice(0,2);
  const result={symbol,p:{'+':a,'-':b},ref:symbol.text.find(t=>t.description==='Ref').value};this.components.push(result);
  if(net){this.wire(a,[a[0],a[1]-20]);this.label([a[0],a[1]-20],net);this.inputs.push(net);}
  if(negative==='0'){this.wire(b,[b[0],b[1]+20]);this.ground([b[0],b[1]+20]);}else if(negative){this.wire(b,[b[0],b[1]+20]);this.label([b[0],b[1]+20],negative);}
  return result;
 }
 sourceConfig(symbol:any){return JSON.parse(symbol.text.find(f=>f.description==='$$SPICE_CONTROL').value);}
 reconfigure(symbol:any,config:any){const changed=updateControl(symbol,config,this.drawing);this.sheet.items[this.sheet.items.indexOf(symbol)]=changed;this.sheet.symbols[changed._symbol.id]=changed._symbol;this.sync();return changed;}
 instrument(type:any,anchor:any,fields:any={}){this.sync();const added=createControl(type,this.sheet,this.drawing);this.sheet.symbols=added.sheet.symbols;let symbol=updateControl(added.symbol,{...JSON.parse(added.symbol.text.find(f=>f.description==='$$SPICE_CONTROL').value),...fields},this.drawing);symbol.text.find(t=>t.description==='Ref').value=this.ref('DMM');const p=new updateSymbol(symbol).active_points().find(p=>p[2].number==='1');symbol=new updateSymbol({...symbol,point:[symbol.point[0]+anchor[0]-p[0],symbol.point[1]+anchor[1]-p[1]],_active_points:null}).post_construction();this.sheet.items.push(symbol);this.sync();return symbol;}
 bindInstrument(symbol:any,number:string,net:string){const p=new updateSymbol(symbol).active_points().find(p=>p[2].number===number);const end=[p[0],p[1]+35];this.wire(p.slice(0,2),end);if(net==='0')this.ground(end);else this.label(end,net);}
 noConnectInstrument(symbol:any,number:string){const p=new updateSymbol(symbol).active_points().find(p=>p[2].number===number);this.sheet.items.push({NodeName:'noconnect',_id:get_global_id(),point:p.slice(0,2)});}
 bind(c:any,pin:string,net:string,out=false){const p=c.p[pin];if(!p)throw Error(c.id+' missing '+pin);const center=[(c.bounds.x1+c.bounds.x2)/2,(c.bounds.y1+c.bounds.y2)/2];let end;
  if(Math.abs(p[0]-center[0])>Math.abs(p[1]-center[1]))end=[p[0]+(p[0]<center[0]?-Math.max(net==='0'?60:25,net.length*5):25),p[1]];else end=[p[0],p[1]+(p[1]<center[1]?-25:25)];
  this.wire(p,end);if(net==='0')this.ground(end);else this.label(end,net);if(out&&net!=='0')this.outputs.push(net);
 }
 supply(){this.source([70,160],'VCC');this.label([70,212],'VSS');}
 digital(ids:string[],kind='gates'){
  this.supply();
  const usedInputs=new Set<string>();
  if(ids.some(id=>this.library.find(e=>e.id===id).pins.some(p=>['CLK','CLOCK'].includes(p.name))))this.source([70,540],'CLK',{waveform:'pulse',dc:'0',low:'0',high:'5',delay:'1us',rise:'10ns',fall:'10ns',width:'4us',period:'10us'});
  const placed:any[]=[];ids.forEach((id,i)=>{const c=this.component(id,[280+(i%2)*245,170+Math.floor(i/2)*145],{anchor:this.library.find(e=>e.id===id).pins.find(p=>p.side==='left')?.name||this.library.find(e=>e.id===id).pins[0].name});
   for(const pin of this.library.find(e=>e.id===id).pins){let net=pin.electrical_type==='power_input'?(pin.side==='top'?'VCC':'0'):['COMMON','GND'].includes(pin.name)?'0':['CLK','CLOCK'].includes(pin.name)?'CLK':pin.name.endsWith('_N')||['ENABLE','UP_DOWN','VREF'].includes(pin.name)?'VCC':['RESET','SET'].includes(pin.name)?'0':pin.electrical_type==='output'?c.ref+'_'+pin.name:['B','J','INPUT1','D1','A1','I1'].includes(pin.name)?'B':['CARRY_IN','I2'].includes(pin.name)?'C':pin.name==='I3'?'D':'A';
    if(ids.join(',')==='gate_buffer,gate_nand'&&i===1){if(pin.name==='A')net=placedOutput(0,'Y');if(pin.name==='B')net='VCC';}
    if(ids.join(',')==='counter_binary3_sync,gate_and'){
     if(i===0&&pin.name==='RESET')net='MOD_RESET';
     if(i===1&&pin.name==='A')net=placedOutput(0,'Q0');
     if(i===1&&pin.name==='B')net=placedOutput(0,'Q2');
     if(i===1&&pin.name==='Y')net='DECODE';
    }
    if(ids.join(',')==='gate_and,gate_not,gate_or'){
     if(i===1&&pin.electrical_type==='input')net=placedOutput(0,'Y');
     if(i===2&&pin.name==='A')net=placedOutput(1,'Y');
    }
    if(['A','B','C','D'].includes(net))usedInputs.add(net);
    this.bind(c,pin.name,net,pin.electrical_type==='output');}
   placed.push(c);
   function placedOutput(index:number,pin:string){return placed[index].ref+'_'+pin;}
  });
  const inputs=['A','B','C','D'].filter(net=>usedInputs.has(net));
  inputs.forEach((net,i)=>this.source([70+(i>1?95:0),280+(i%2)*130],net,{waveform:'pulse',dc:'0',low:'0',high:'5',delay:(2+i*10)+'us',rise:'10ns',fall:'10ns',width:(20*2**i)+'us',period:(40*2**i)+'us'}));
  this.analysis={kind:'tran',duration:inputs.length>2?'330us':'85us',maxStep:'20ns'};
  return placed;
 }
 finish(instructions:string,diagram=false){
  const title={...font,...style,NodeName:'text',_id:get_global_id(),point:[35,20],point_b:[1165,83],font_size:16,font_bold:true,text:this.data.id+' · '+this.data.title,rotation:0,textData:null};this.sheet.items.push(new updateText(title as any).post_construction());
  const note={...font,...style,NodeName:'text',_id:get_global_id(),point:[735,105],point_b:[1165,740],font_size:10,filled:true,fill_colour:'#f4f8fc',line_colour:'#b7c9dc',text:instructions,rotation:0,textData:null};this.sheet.items.push(new updateText(note as any).post_construction());
  const shapes=layoutMarkdown(instructions,note,430);const max=Math.max(0,...shapes.map(s=>s.kind==='text'?s.y+s.size:s.kind==='line'?Math.max(s.y1,s.y2):s.y+(s.kind==='rect'?s.height:s.radius)));if(max>625)throw Error('Student text overflows '+this.data.id+': '+max);
  const layout=layoutTeachingSheet(this.sheet);this.sheet=layout.sheet;this.sync();let deck='';
  if(diagram){for(const item of this.sheet.items)if(item.NodeName==='symbol'){item.text=item.text.filter(f=>!f.description.startsWith('$$SPICE'));item._symbol.uid='tinycad-teaching-diagram-'+item._symbol.uid;}for(const item of this.sheet.items)if(item.NodeName==='power'&&item.text==='0')item.text='GND';}
  else{const sim=createSimulationSheet(this.sheet,this.data.id+' · Simulation');sim.id=this.data.uuid.replace(/^./,'c');Object.assign(sim.simulation.analysis,this.analysis);sim.simulation.instructions=instructions;sim.simulation.parameters=this.parameters;sim.simulation.signals=[...new Set(this.outputs.length?this.outputs:['OUT','IN'])].slice(0,30).map(s=>s.toLowerCase());this.drawing.sheets.push(sim);
   const net=new NetlistWorkerState().init(this.drawing);const errors=checkSpiceComponents(net,sim.simulation);if(errors.length)throw Error(this.data.id+' SPICE preflight '+JSON.stringify(errors));deck=buildDeck(net,sim.simulation);
  }
  for(const item of this.sheet.items){const u=updateFactory(item);if(item.NodeName==='symbol')for(const[x,y]of [...new updateSymbol(item).active_points(),...new updateSymbol(item).power_pins()])if(Math.abs(x/5-Math.round(x/5))>1e-5||Math.abs(y/5-Math.round(y/5))>1e-5)throw Error('Off-grid '+this.data.id);}
  const svg=renderTeachingSheet(this.sheet);
  return{drawing:this.drawing,deck,svg,diagram,layout:layout.report};
 }
}
export function renderTeachingSheet(sheet:any){
  return renderToStaticMarkup(<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1200" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="white"/><SvgDefs images={sheet.images} hatches={sheet.hatches}/><ServerDrawing dx={0} dy={0} dr={0} scale_x={1} scale_y={1} part={0} show_power={false} heterogeneous={false} parent={null} items={sheet.items} options={sheet.options}/></svg>);
}
export {encodeDrawing,decodeDrawing};
export function initialiseGenerator(){
 globalThis.document={createElement:()=>({getContext:()=>({font:'10px Arial',measureText(text){const size=parseFloat(this.font)||10;return{width:String(text).length*size*.52,actualBoundingBoxDescent:size*.22};}})})} as any;
 const create=XMLBuilder.prototype.createDoc;XMLBuilder.prototype.createDoc=function(name){create.call(this,name);this.insert=this.xmlDoc.documentElement;};
 const serialise=XMLBuilder.prototype.tostring;XMLBuilder.prototype.tostring=function(){function strings(n){if(n.attributes)for(let i=0;i<n.attributes.length;i++)n.attributes[i].value=String(n.attributes[i].value);if(n.nodeType===3||n.nodeType===4)n.data=String(n.data);for(let c=n.firstChild;c;c=c.nextSibling)strings(c);}strings(this.xmlDoc);return serialise.call(this);};
}
export async function inspectLesson(bytes:any){const drawing=await decodeDrawing(bytes);const sim=drawing.sheets.find(s=>s.kind==='simulation');const texts=drawing.sheets.flatMap(s=>s.items).filter(i=>i.NodeName==='text');if(texts.length<2)throw Error('Missing student Markdown');if(!sim)return{simulation:false,deck:'',symbols:drawing.sheets[0].items.filter(i=>i.NodeName==='symbol').length};const net=new NetlistWorkerState().init(drawing),errors=checkSpiceComponents(net,sim.simulation);if(errors.length)throw Error(JSON.stringify(errors));return{simulation:true,deck:buildDeck(net,sim.simulation),symbols:net.symbols.length};}
