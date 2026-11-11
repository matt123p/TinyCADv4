const pulse={waveform:'pulse',dc:'0',acMagnitude:'1',low:'0',high:'5',delay:'100us',rise:'1us',fall:'1us',width:'3ms',period:'6ms'};
const sine={waveform:'sine',dc:'0',acMagnitude:'1',offset:'0',amplitude:'2',frequency:'1kHz'};
export function circuit(b:any,plan:string){
 const r=(at:any,value='1k',orientation='h')=>b.component('resistor',at,{orientation,fields:{Value:value}});
 const join=(a:any,c:any,x?:number)=>{if(a[0]===c[0]||a[1]===c[1])b.wire(a,c);else b.wire(a,[x??c[0],a[1]],[x??c[0],c[1]],c);};
 const short=(c:any,p:string,n:string,out=false)=>b.bind(c,p,n,out);
 const labelled=(id:string,at:any,connections:any,options:any={})=>{const c=b.component(id,at,options);for(const [p,n]of Object.entries(connections))short(c,p,String(n),n==='OUT');return c;};
 const common=()=>{const s=b.source([85,180],null,{dc:'5'},null);b.wire(s.p['-'],[85,410]);b.ground([85,410]);return s;};
 const basic=(id='resistor',fields:any={Value:'1k'},opts:any={})=>{
  const s=common();if(opts.source){const item=s.symbol;const f=item.text.find(t=>t.description==='$$SPICE_CONTROL');const conf={...JSON.parse(f.value),...opts.source};b.sheet.items[b.sheet.items.indexOf(item)]=requireUpdate(item,conf,b);}
  const limit=r([220,180],opts.limit||'100');const load=b.component(id,[480,180],{orientation:'v',anchor:opts.anchor,reverse:opts.reverse,fields});const pp=(Object.values(load.p) as any[]).sort((a,b)=>a[1]-b[1]);
  join(s.p['+'],limit.p['1']);join(limit.p['2'],pp[0]);b.wire(pp[1],[480,410],[85,410]);b.label(pp[0],'OUT');b.label(s.p['+'],'IN');b.outputs=['OUT','IN'];
  return{s,limit,load};
 };
 // Configure a previously placed native source through its normal edit path.
 function requireUpdate(item:any,config:any,b:any){const symbol=b.reconfigure(item,config);return symbol;}
 if(plan==='rc-filter'||plan==='resonance'){
  circuit(b,plan==='rc-filter'?'rc':'rlc');b.analysis={kind:'ac',startFrequency:'10Hz',stopFrequency:'100kHz',pointsPerDecade:60};return;
 }
 if(plan==='cells'){
  b.source([85,180],'PACK',{dc:'1.5'},'MID');b.source([85,330],'MID',{dc:'1.5'});
  const internal=r([280,180],'200');short(internal,'1','PACK');short(internal,'2','OUT');const load=r([530,180],'100','v');short(load,'1','OUT');short(load,'2','0');
  b.outputs=['PACK','MID','OUT'];b.notes.push('Start with two 1.5 V cells in series. R1 = 200 ohms represents their combined internal resistance (100 ohms each). For the parallel comparison, give each cell its own 100-ohm series resistance before joining the terminals; never place different ideal source voltages directly in parallel.');return;
 }
 if(plan==='alarm'){
  b.supply();const top=r([240,160],'10k');short(top,'1','VCC');short(top,'2','SENSOR');labelled('ntc',[255,270],{'1':'SENSOR','2':'0'},{fields:{Temperature:'20'}});
  b.source([70,380],'THRESHOLD',{dc:'2.5'});labelled('comparator',[420,270],{'IN+':'THRESHOLD','IN-':'SENSOR',OUT:'DRIVE',VCC:'VCC',VEE:'0'},{anchor:'IN+'});
  const base=r([270,470],'4.7k');short(base,'1','DRIVE');short(base,'2','BASE');labelled('bjt_npn',[440,470],{B:'BASE',C:'COLLECTOR',E:'0'},{anchor:'B'});
  const limit=r([610,150],'330','v');short(limit,'1','VCC');short(limit,'2','LED_A');labelled('led',[610,300],{A:'LED_A',K:'COLLECTOR'});
  b.outputs=['SENSOR','DRIVE','COLLECTOR'];b.notes.push('Raise the NTC Temperature above 25 °C and rerun. The falling sensor voltage switches the comparator, then the transistor drives the LED. Adjust THRESHOLD to choose the switching temperature.');return;
 }
 if(['series','network','parallel','divider','power','meters','loading','fault','wire','cell','cells','thevenin','max-power','superposition'].includes(plan)){
  const s=common();
  if(['parallel'].includes(plan)){
   const a=r([275,180],'1k','v'),c=r([500,180],'2k','v');b.wire(s.p['+'],a.p['1'],c.p['1']);b.wire(a.p['2'],[275,410]);b.wire(c.p['2'],[500,410],[85,410],s.p['-']);b.label(c.p['1'],'OUT');b.outputs=['OUT'];
  } else if(plan==='series'){
   let last=s.p['+'];for(let i=0;i<3;i++){const a=r([190+i*155,180],i===2?'2k':'1k');join(last,a.p['1']);last=a.p['2'];if(i<2)b.label(last,'N'+i);}b.wire(last,[650,180],[650,410],[85,410]);b.outputs=['N0','N1'];
  }else{
   const a=r([245,180],plan==='wire'?'{rho*wire_length/(3.141592654*diameter*diameter/4)}':plan==='loading'?'100k':'1k');
   const c=r([500,180],plan==='loading'?'100k':plan==='max-power'?'1k':'2k','v');join(s.p['+'],a.p['1']);join(a.p['2'],c.p['1']);if(plan==='meters')short(c,'2','I_RET');else b.wire(c.p['2'],[500,410],[85,410]);b.label(c.p['1'],'OUT');b.label(s.p['+'],'IN');b.outputs=['IN','OUT'];
   if(plan==='network'){const d=r([360,290],'2k','v');b.wire([360,180],d.p['1']);b.wire(d.p['2'],[360,410]);}
   if(plan==='wire'){b.parameters={rho:'1.1u',wire_length:'.5',diameter:'.0003'};b.notes.push('Wire model: rho = 1.1e-6 ohm metre; diameter = 0.3 mm; length = 0.5 m. Change the Simulation-sheet parameters.');}
   if(['cell','cells','thevenin','max-power'].includes(plan)){a.symbol.text.find(t=>t.description==='Value').value='100';c.symbol.text.find(t=>t.description==='Value').value='100';b.notes.push('R1 represents the source resistance. V1 is the ideal emf.');}
   if(plan==='loading'||plan==='meters'){
    const meter=b.instrument('meter',[605,280],{mode:'dcV'});b.bindInstrument(meter,'1','OUT');b.bindInstrument(meter,'2','0');b.noConnectInstrument(meter,'3');
    if(plan==='meters'){const ammeter=b.instrument('meter',[300,570],{mode:'dcA'});b.bindInstrument(ammeter,'3','I_RET');b.bindInstrument(ammeter,'2','0');b.noConnectInstrument(ammeter,'1');b.notes.push('DMM1 measures OUT relative to the return. DMM2 is in the return path: its A jack connects to I_RET and its COM jack to ground.');}
   }
   if(plan==='superposition'){const s2=b.source([360,320],'VSECOND',{dc:'3'});const extra=r([360,260],'1k');short(extra,'1','VSECOND');short(extra,'2','OUT');b.notes.push('V1 = 5 V and V2 = 3 V. To suppress a source set its DC voltage to zero; retain both resistors.');}
   if(plan==='thevenin'){const shunt=r([350,310],'200','v');short(shunt,'1','OUT');short(shunt,'2','0');b.notes.push('R2 is the removable load. With R2 removed, derive the open-circuit voltage from R1 and R3; suppress V1 to find R1 in parallel with R3. Compare the original with its equivalent under several loads.');}
   if(plan==='fault'){const sw=labelled('switch_spst',[310,310],{'1':'OUT','2':'TEST'},{fields:{State:1}});labelled('test_point',[550,330],{TIP:'TEST'});b.notes.push('Set the switch State to zero to introduce an open-circuit fault at TEST.');}
  }
  return;
 }
 if(['rc','discharge','rl','rlc','impedance','lc','charge','capacitor-bank'].includes(plan)){
  const s=b.source([85,180],null,['impedance','lc'].includes(plan)?sine:pulse,null);b.wire(s.p['-'],[85,440]);b.ground([85,440]);const a=r([220,180],['rl','rlc','impedance','lc'].includes(plan)?'100':'1k');join(s.p['+'],a.p['1']);
  let last=a.p['2'];if(['rlc','impedance'].includes(plan)&&b.data.id!=='H07'){const l=b.component('inductor',[355,180],{orientation:'h',fields:{Value:'10m'}});join(last,l.p['1']);last=l.p['2'];}
  const load=b.component(plan==='rl'?'inductor':'capacitor',[530,180],{orientation:'v',fields:{Value:plan==='rl'?'100m':'1u'}});join(last,Object.values(load.p)[0]);const end=Object.values(load.p)[1];b.wire(end,[530,440],[85,440]);b.label(s.p['+'],'IN');b.label(Object.values(load.p)[0],'OUT');b.outputs=['IN','OUT'];
  if(plan==='lc'){const l=b.component('inductor',[390,300],{orientation:'v',fields:{Value:'10m'}});short(l,'1','OUT');short(l,'2','0');}
  if(plan==='capacitor-bank'){const c=b.component('capacitor',[360,310],{orientation:'v',fields:{Value:'2u'}});short(c,'1','OUT');short(c,'2','0');}
  if(b.data.id==='H07')b.notes.push('Start with this RC network. Replace C1 with an inductor in a separate copy for the RL comparison, keeping the same source and resistance.');
  b.analysis=['impedance','lc'].includes(plan)?{kind:'ac',startFrequency:'10Hz',stopFrequency:'100kHz',pointsPerDecade:50}:{kind:'tran',duration:plan==='discharge'?'6ms':'5ms',maxStep:plan==='rlc'?'1us':'5us'};return;
 }
 if(['iv-resistor','iv-lamp','iv-diode','iv-led','led','ntc','ldr','ntc-divider','ldr-divider','solar'].includes(plan)){
  let id=plan.includes('lamp')?'lamp':plan.includes('diode')?'diode':plan.includes('led')||plan==='led'?'led':plan.startsWith('ntc')?'ntc':plan.startsWith('ldr')?'ldr':plan==='solar'?'solar_cell':'resistor';
  let fields:any=id==='resistor'?{Value:'1k'}:id==='ntc'?{Temperature:25}:id==='ldr'?{Illuminance:100}:id==='solar_cell'?{Illuminance:50}:{};
  if(plan==='solar'){
   const source=labelled('solar_cell',[230,170],{'+':'OUT','-':'0'},{fields});const load=r([500,250],'100','v');short(load,'1','OUT');short(load,'2','0');b.outputs=['OUT'];return;
  }
  const {s,limit}=basic(id,fields);if(plan.includes('divider'))limit.symbol.text.find(t=>t.description==='Value').value='10k';
  if(plan.startsWith('iv-'))b.analysis={kind:'dc',source:s.ref,sweepStart:id==='led'?'0':'-5',sweepStop:'5',sweepStep:'.1'};return;
 }
 if(['sine','fm'].includes(plan)){
  const s=b.source([120,180],null,plan==='fm'?{...sine,waveform:'fm',frequency:'10kHz',modulationFrequency:'1kHz',modulationIndex:'2'}:sine,null);const load=r([500,180],'1k','v');join(s.p['+'],load.p['1']);b.wire(load.p['2'],[500,400],[120,400],s.p['-']);b.ground([120,400]);b.label(load.p['1'],'OUT');b.outputs=['OUT'];b.analysis={kind:'tran',duration:'5ms',maxStep:'2us'};return;
 }
 if(plan==='potentiometer'){
  b.supply();const p=labelled('potentiometer',[350,200],{END_A:'VCC',END_B:'0',WIPER:'OUT'},{fields:{Wiper:.5}});const load=r([570,300],'10k','v');short(load,'1','OUT');short(load,'2','0');b.outputs=['OUT'];return;
 }
 if(['rectifier','smoothing','bridge','zener'].includes(plan)){
  if(plan==='zener'){const {s,limit,load}=basic('zener',{},{reverse:true,anchor:'K',limit:'330'});limit.symbol.text.find(t=>t.description==='Value').value='330';b.reconfigure(s.symbol,{...b.sourceConfig(s.symbol),dc:'9'});b.notes.push('The zener is reverse-biased: its cathode faces the positive supply.');return;}
  b.source([70,240],'AC1',{...sine,amplitude:'6',frequency:'50Hz'},plan==='bridge'?'AC2':'0');
  if(plan==='bridge'){
   const a=labelled('diode_rectifier',[225,170],{A:'AC1',K:'OUT'},{orientation:'h'});const c=labelled('diode_rectifier',[470,170],{A:'AC2',K:'OUT'},{orientation:'h'});const d=labelled('diode_rectifier',[225,330],{A:'0',K:'AC1'},{orientation:'h'});const e=labelled('diode_rectifier',[470,330],{A:'0',K:'AC2'},{orientation:'h'});
  }else labelled('diode_rectifier',[300,200],{A:'AC1',K:'OUT'},{orientation:'h'});
  const load=r([610,240],'1k','v');short(load,'1','OUT');short(load,'2','0');
  if(plan==='smoothing'||plan==='bridge'){const c=labelled('capacitor_polarised',[440,400],{'+':'OUT','-':'0'},{orientation:'v',fields:{Value:'100u'}});}
  b.outputs=['AC1','OUT'];b.analysis={kind:'tran',duration:'80ms',maxStep:'50us'};return;
 }
 if(['bjt-switch','darlington','fet-switch','fet-sweep','bjt-bias','bjt-amplifier','relay','reed','thyristor'].includes(plan)){
  b.supply();const fet=plan.startsWith('fet'),scr=plan==='thyristor',transistor=b.component(scr?'thyristor':fet?'mosfet_n':plan==='darlington'?'darlington_npn':'bjt_npn',[380,300],{anchor:scr?'G':fet?'G':'B'});
  const input=b.source([70,350],'DRIVE',plan==='bjt-amplifier'?{...sine,offset:'.65',amplitude:'.005'}:plan==='bjt-bias'?{dc:'.7'}:{...pulse,delay:'100us',width:'400us',period:'1ms'});
  const rin=r([210,300],fet?'100':'4.7k');short(rin,'1','DRIVE');short(rin,'2','CONTROL');short(transistor,scr?'G':fet?'G':'B','CONTROL');short(transistor,scr?'K':fet?'S':'E','0');short(transistor,scr?'A':fet?'D':'C','OUT',true);
  if(plan==='relay'){labelled('relay_coil',[540,170],{'1':'VCC','2':'OUT'});labelled('diode_rectifier',[600,270],{A:'OUT',K:'VCC'});}
  else{const load=r([560,180],plan==='bjt-amplifier'?'2.2k':'330','v');short(load,'1','VCC');short(load,'2','OUT');}
  if(fet){const pull=r([270,410],'100k','v');short(pull,'1','CONTROL');short(pull,'2','0');}
  if(plan==='reed'){const sw=labelled('reed_switch',[210,490],{'1':'VCC','2':'CONTROL'},{fields:{State:1}});}
  b.outputs=['DRIVE','OUT'];b.analysis=plan==='fet-sweep'?{kind:'dc',source:input.ref,sweepStart:'0',sweepStop:'5',sweepStep:'.1'}:plan==='bjt-bias'?{kind:'op'}:{kind:'tran',duration:'3ms',maxStep:'1us'};return;
 }
 if(plan==='strain'){
  b.source([70,160],'EXC',{dc:'5'});
  labelled('wheatstone_bridge',[300,210],{'EXC+':'EXC','EXC-':'0','SIG+':'PLUS','SIG-':'MINUS'},{fields:{Arm1:'1001',Arm2:'1000',Arm3:'1000',Arm4:'1000'}});
  b.source([70,390],'VCC',{dc:'15'});b.source([70,520],'VEE',{dc:'-15'});
  labelled('opamp',[520,390],{'IN+':'PLUS_DIV','IN-':'SUM','OUT':'OUT','V+':'VCC','V-':'VEE'},{anchor:'IN+'});
  const rin=r([290,360],'10k');short(rin,'1','MINUS');short(rin,'2','SUM');
  const rf=r([470,130],'100k');short(rf,'1','SUM');short(rf,'2','OUT');
  const rp=r([290,470],'10k');short(rp,'1','PLUS');short(rp,'2','PLUS_DIV');const rg=r([535,530],'100k','v');short(rg,'1','PLUS_DIV');short(rg,'2','0');
  b.outputs=['PLUS','MINUS','OUT'];b.notes.push('Arm1 = 1001 ohms; the other bridge arms = 1000 ohms. Both sense terminals are free to move. The matched resistor ratios give OUT = 10 × (PLUS − MINUS).');return;
 }
 if(plan==='sampling'){
  b.source([70,170],'VREF',{dc:'5'});b.source([70,310],'VIN',{...sine,offset:'2.5',amplitude:'2',frequency:'100Hz'});b.source([70,460],'CLK',{...pulse,delay:'0',rise:'10ns',fall:'10ns',width:'10us',period:'100us'});
  labelled('adc4',[230,190],{ANALOG_IN:'VIN',CLOCK:'CLK',VREF:'VREF',COMMON:'0',D0:'BIT0',D1:'BIT1',D2:'BIT2',D3:'BIT3'},{anchor:'ANALOG_IN'});
  labelled('dac4',[485,190],{D0:'BIT0',D1:'BIT1',D2:'BIT2',D3:'BIT3',VREF:'VREF',COMMON:'0',ANALOG_OUT:'OUT'},{anchor:'D0'});
  labelled('pcm_encoder',[410,450],{D0:'BIT0',D1:'BIT1',D2:'BIT2',D3:'BIT3',CLOCK:'CLK',SERIAL_OUT:'SERIAL'},{anchor:'D0'});
  b.outputs=['VIN','OUT','CLK','SERIAL'];b.analysis={kind:'tran',duration:'20ms',maxStep:'2us'};b.notes.push('ADC data bits BIT0–BIT3 feed both the DAC and the educational PCM encoder. Compare VIN with the reconstructed staircase OUT.');return;
 }
 if(['comparator','alarm','inverting','noninverting','summing','difference','active-filter','photodiode','thermocouple','piezo','strain'].includes(plan)){
  const compare=plan==='comparator'||plan==='alarm',sensor=['photodiode','thermocouple','piezo','strain'].includes(plan);
  b.source([70,160],'VCC',{dc:compare?'5':'15'});if(!compare)b.source([70,280],'VEE',{dc:'-15'});
  const op=labelled(compare?'comparator':'opamp',[410,260],{'IN+':compare?'VIN':['inverting','active-filter','summing','photodiode'].includes(plan)?'0':plan==='difference'?'PLUS':'SIGNAL','IN-':'SUM','OUT':'OUT',[compare?'VCC':'V+']:'VCC',[compare?'VEE':'V-']:compare?'0':'VEE'},{anchor:'IN+'});
  if(compare){b.source([70,390],'VIN',{...sine,offset:'2.5',amplitude:'2'});b.source([230,420],'SUM',{dc:'2.5'});}
  else{
   if(sensor){const map={photodiode:['photodiode',{A:'0',K:'SUM'}],thermocouple:['thermocouple',{'+':'SIGNAL','-':'0'}],piezo:['piezo_sensor',{'+':'SIGNAL','-':'0'}],strain:['wheatstone_bridge',{'EXC+':'VCC','EXC-':'0','SIG+':'SIGNAL','SIG-':'0'}]}[plan];labelled(map[0] as string,[200,400],map[1],{fields:plan==='piezo'?{Force:'sin(2*pi*100*time)'}:{}});}
   else b.source([70,420],'SIGNAL',{...sine,amplitude:'.2'});
   if(plan==='inverting'||plan==='active-filter'||plan==='summing'||plan==='difference'){
    const rin=r([220,270],'10k');short(rin,'1','SIGNAL');short(rin,'2','SUM');
   }
   const rf=r([440,150],['active-filter','difference'].includes(plan)?'10k':'100k');short(rf,'1','SUM');short(rf,'2','OUT');
   if(!['inverting','active-filter','summing','difference','photodiode'].includes(plan)){const rg=r([285,340],'10k','v');short(rg,'1','SUM');short(rg,'2','0');}
   if(plan==='active-filter'){const c=labelled('capacitor',[490,430],{'1':'SUM','2':'OUT'},{orientation:'h',fields:{Value:'10n'}});}
   if(plan==='summing'||plan==='difference'){b.source([70,550],'SECOND',{dc:'.1'});const ri=r([230,500],'10k');short(ri,'1','SECOND');short(ri,'2',plan==='summing'?'SUM':'PLUS');}
  }
  if(plan==='difference'){const rg=r([300,570],'10k','v');short(rg,'1','PLUS');short(rg,'2','0');}
  const load=r([625,360],'10k','v');short(load,'1','OUT');short(load,'2','0');b.outputs=plan==='photodiode'?['OUT']:['SIGNAL','OUT'];if(compare)b.outputs=['VIN','OUT'];b.analysis=plan==='active-filter'?{kind:'ac',startFrequency:'10Hz',stopFrequency:'100kHz',pointsPerDecade:40}:{kind:'tran',duration:'5ms',maxStep:'2us'};return;
 }
 const digitalMap={gates:['gate_and','gate_or','gate_nand','gate_nor','gate_xor','gate_not'],logic:['gate_and','gate_not','gate_or'], 'logic-loading':['gate_buffer','gate_nand'],storage:['latch_d','flipflop_d','flipflop_jk'],counters:['counter_binary3_sync','counter_bcd','counter_johnson','shift_register3'],modulo:['counter_binary3_sync','gate_and'],decoder:['mux2','decoder2to4','encoder4to2'],adder:['full_adder'],sampling:['adc4','dac4','pcm_encoder']};
 if(digitalMap[plan]){const blocks=b.digital(digitalMap[plan],['gates','logic','logic-loading'].includes(plan)?'gates':'clock');if(plan==='modulo'){const delay=r([260,350],'100');short(delay,'1','DECODE');short(delay,'2','DELAY');labelled('capacitor',[500,370],{'1':'DELAY','2':'0'},{orientation:'v',fields:{Value:'1n'}});labelled('controlled_switch',[330,550],{A:'VCC',B:'MOD_RESET','CTRL+':'DELAY','CTRL-':'0'},{anchor:'A',fields:{Threshold:'2.5',Hysteresis:'.5',OnResistance:'10',OffResistance:'1e12'}});const pull=r([610,540],'1k','v');short(pull,'1','MOD_RESET');short(pull,'2','0');b.outputs.push('MOD_RESET');b.notes.push('R1/C1 and the hysteretic voltage-controlled switch hold the decoded reset long enough to clear all counter bits. The reset pulse is short compared with the clock period.');}if(plan==='logic-loading')labelled('capacitor',[470,400],{'1':blocks[0].ref+'_Y','2':'0'},{orientation:'v',fields:{Value:'100p'}});return;}
 if(['timer-astable','timer-monostable'].includes(plan)){const mono=plan==='timer-monostable';
  b.supply();const timer=labelled('timer_555',[350,420],{GND:'0',VCC:'VCC',RESET_N:'VCC',TRIG:mono?'TRIGGER':'CAP',THRESH:'CAP',CTRL:'CTRL',DISCH:mono?'CAP':'DIS',OUT:'OUT'},{anchor:'GND'});
  const r1=r([230,150],'10k');short(r1,'1','VCC');short(r1,'2',mono?'CAP':'DIS');if(!mono){const r2=r([480,150],'10k');short(r2,'1','DIS');short(r2,'2','CAP');}else b.source([70,350],'TRIGGER',{...pulse,dc:'5',low:'5',high:'0',delay:'100us',width:'20us',period:'20ms'});labelled('capacitor',[535,380],{'1':'CAP','2':'0'},{orientation:'v',fields:{Value:'100n'}});labelled('capacitor',[240,490],{'1':'CTRL','2':'0'},{orientation:'v',fields:{Value:'10n'}});
  b.outputs=['OUT','CAP'];b.analysis={kind:'tran',duration:'8ms',maxStep:'2us',initialConditions:!mono};return;
 }
 if(['hall','channel','tdm','am'].includes(plan)){
  if(plan==='hall'){b.supply();labelled('hall_sensor',[350,200],{VCC:'VCC',GND:'0',OUT:'OUT'},{fields:{MagneticFlux:'.1*sin(2*pi*500*time)'}});}
  if(plan==='channel'){b.source([70,220],'VIN',sine);labelled('channel',[350,220],{IN:'VIN',OUT:'OUT'},{fields:{Bandwidth:'2k'}});}
  if(plan==='tdm'){b.source([70,160],'A',{...sine,frequency:'100Hz'});b.source([70,300],'B',{...sine,frequency:'250Hz'});b.source([70,440],'CLK',{...pulse,delay:'0',width:'100us',period:'200us'});labelled('tdm_switch',[370,240],{CHANNEL0:'A',CHANNEL1:'B',CLOCK:'CLK',MULTIPLEXED_OUT:'OUT'});}
  if(plan==='am'){b.source([70,160],'CARRIER',{...sine,frequency:'10kHz',amplitude:'1'});b.source([70,340],'MESSAGE',{...sine,frequency:'1kHz',amplitude:'1'});labelled('am_modulator',[350,240],{'CARRIER+':'CARRIER','CARRIER-':'0','MESSAGE+':'MESSAGE','MESSAGE-':'0','OUT+':'OUT','OUT-':'0'});}
  const load=r([600,350],'10k','v');short(load,'1','OUT');short(load,'2','0');b.outputs=['OUT'];b.analysis={kind:'tran',duration:'5ms',maxStep:'1us'};return;
 }
 if(plan==='pushbutton'){
  b.supply();labelled('push_make',[260,200],{'1':'VCC','2':'OUT'},{fields:{State:0}});const pull=r([530,230],'10k','v');short(pull,'1','OUT');short(pull,'2','0');b.outputs=['OUT'];return;
 }
 // Physical construction / I/O plans intentionally remain ordinary DSN files.
 if(plan.endsWith('-plan')){
  if(plan==='capacitor-plan'){labelled('capacitor_plates',[330,200],{'1':'MEASURE','2':'REFERENCE'});b.notes.push('Change real plate area, separation and dielectric on the bench. Enter measured capacitance only after taking readings.');}
  else if(plan==='solar-plan'){labelled('solar_cell',[300,200],{'+':'MEASURE','-':'RETURN'});const load=r([550,300],'100','v');short(load,'1','MEASURE');short(load,'2','RETURN');}
  else if(plan==='build-plan'){const sw=labelled('switch_spst',[240,180],{'1':'SUPPLY','2':'SWITCHED'});const lim=r([400,150],'1k');short(lim,'1','SWITCHED');short(lim,'2','LED_A');const led=labelled('led',[480,250],{A:'LED_A',K:'RETURN'});labelled('connector3',[250,420],{'1':'SUPPLY','2':'RETURN','3':'TEST'});}
  else if(plan==='controller-plan'||plan==='state-plan'){labelled(plan==='state-plan'?'state_machine':'microcontroller',[300,200],plan==='state-plan'?{CLOCK:'CLOCK',RESET:'RESET',INPUT0:'INPUT0',INPUT1:'INPUT1',OUTPUT0:'OUT0',OUTPUT1:'OUT1'}:{VDD:'SUPPLY',VSS:'RETURN',RESET_N:'RESET_N',CLOCK:'CLOCK',GPIO0:'INPUT0',GPIO1:b.data.id==='F15'?'OUT6':'INPUT1',GPIO2:'OUT0',GPIO3:'OUT1',GPIO4:'OUT2',GPIO5:'OUT3',GPIO6:'OUT4',GPIO7:'OUT5',AIN0:'SENSOR0',AIN1:'SENSOR1'},{anchor:plan==='state-plan'?'CLOCK':'GPIO0'});}
  else if(plan==='communication-plan'&&b.data.id==='A39'){
   labelled('temperature_sensor',[180,180],{VCC:'SUPPLY',GND:'RETURN',OUT:'SENSOR'});
   labelled('gate_buffer',[470,180],{A:'SENSOR',Y:'CONDITIONED',VDD:'SUPPLY',VSS:'RETURN'},{anchor:'A'});
   labelled('transmitter',[180,350],{SIGNAL_IN:'CONDITIONED',CHANNEL_OUT:'TX'});
   labelled('channel',[470,350],{IN:'TX',OUT:'RX'});
   labelled('receiver',[180,520],{CHANNEL_IN:'RX',SIGNAL_OUT:'RECEIVED'});
   labelled('output_transducer',[470,520],{ELECTRICAL_IN:'RECEIVED',PHYSICAL_OUT:'OUTPUT'});
   b.notes.push('The buffer represents a processing stage; choose suitable analogue conditioning for a real sensor. Follow SENSOR → CONDITIONED → TX → RX → RECEIVED. The final physical output is a system label.');
  }else{
   labelled('temperature_sensor',[180,180],{VCC:'SUPPLY',GND:'RETURN',OUT:'SENSOR'});
   labelled('opamp',[400,240],{'IN+':'SENSOR','IN-':'CONDITIONED',OUT:'CONDITIONED','V+':'SUPPLY','V-':'RETURN'},{anchor:'IN+'});
   labelled('data_logger',[430,450],{'AIN+':'CONDITIONED','AIN-':'RETURN',VCC:'SUPPLY',GND:'RETURN'},{anchor:'AIN+'});
   labelled('test_point',[200,420],{TIP:'SENSOR'});labelled('test_point',[200,520],{TIP:'CONDITIONED'});
   if(b.data.id==='GY18'){
    const rb=r([270,640],'4.7k');short(rb,'1','CONDITIONED');short(rb,'2','BASE');labelled('bjt_npn',[520,650],{B:'BASE',E:'RETURN',C:'LOAD'},{anchor:'B'});
    const load=r([620,530],'330','v');short(load,'1','SUPPLY');short(load,'2','LOAD');b.notes.push('The transistor is an example output driver. Choose a load and base resistor using the actual sensor voltage and load current.');
   }
  }
  if(plan==='controller-plan'){
   labelled('push_make',[140,420],{'1':'SUPPLY','2':'INPUT0'});const pull=r([140,530],'10k','v');short(pull,'1','INPUT0');short(pull,'2','RETURN');
   if(b.data.id==='F15'){
    const display=b.component('seven_segment_cathode',[530,430],{anchor:'A'});
    const displayNets={A:'SEG_A',B:'SEG_B',C:'SEG_C',D:'SEG_D',E:'SEG_E',F:'SEG_F',G:'SEG_G',DP:'RETURN',COM:'RETURN'};
    Object.entries(display.p).sort((a:any,c:any)=>a[1][0]-c[1][0]).forEach(([pin,p]:any,i)=>{const end=[p[0],p[1]+40+(8-i)*20];b.wire(p,end);b.label(end,displayNets[pin]);});
    ['A','B','C','D','E','F','G'].forEach((segment,i)=>{const limit=r([250,410+i*50],'330');short(limit,'1','OUT'+(i===0?6:i-1));short(limit,'2','SEG_'+segment);});
    b.notes.push('Each display segment A–G has its own 330-ohm current-limiting resistor. COM and the unused decimal point return to the reference. OUT6 uses GPIO1; OUT0–OUT5 use GPIO2–GPIO7. Write and test the segment lookup table in the separate programming environment.');
   }else labelled('connector3',[550,440],{'1':'SUPPLY','2':'RETURN','3':'OUT0'});
   const reset=r([570,680],'10k');short(reset,'1','SUPPLY');short(reset,'2','RESET_N');
   b.notes.push('INPUT0 has a pull-down resistor. Connect the clock/reset labels to the development board. Check output current and add a suitable driver for a real load.');
  }
  return;
 }
 throw Error('No circuit template '+plan);
}
