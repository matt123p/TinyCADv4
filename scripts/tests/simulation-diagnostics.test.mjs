import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRegression } from './run-regression.mjs';
import { loadComponent } from './load-component.mjs';

test('SPICE checks and solver diagnostics identify components and support DRC navigation', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import { checkSpiceComponents, locateSpiceErrors } from './src/simulation/diagnostics';
    import { defaultSetup } from './src/simulation/contracts';
    import { updateDrawing } from './src/manipulators/updateDrawing';
    import { DocStoreReducer } from './src/state/stores/docStoreReducer';
    import { FindActionTypes } from './src/state/actions/findActions';
    import { DocItemTypes } from './src/model/dsnItem';
    const spice = '$' + '$SPICE';
    const field = (description, value) => ({ description, value, position: [0,0], show: false, display: 2 });
    const symbol = (id, ref, model) => ({ _id:id, NodeName:DocItemTypes.Symbol, point:[id*20,id*10], part:0,
      rotation:0, scale_x:1, scale_y:1, _symbol:{parts:1,heterogeneous:false,outlines:[{items:[],active_points:[],ref_point:[0,0],size:[10,10]}]},
      text:[field('Ref',ref), ...(model === undefined ? [] : [field(spice,model)])] });
    const r1=symbol(1,'R1','R1 1 0 1k'), r2=symbol(2,'R2',undefined), r3=symbol(3,'R3','   ');
    const net = symbols => ({ symbols, nets:{}, nodes:{}, eprops:{}, labels:{} });
    const good = net([['Sheet 1',r1]]);
    assert.deepEqual(checkSpiceComponents(good,defaultSetup()),[]);
    const missing = net([['Sheet 1',r1],['Sheet 2',r2],['Sheet 2',r3]]);
    assert.deepEqual(checkSpiceComponents(missing,defaultSetup()).map(error=>error.id),[2,3]);
    const options = Object.fromEntries(Object.keys(DocStoreReducer(undefined,{type:'@@INIT'}).drawing.drc).map(key=>[key,false]));
    const updater = new updateDrawing();
    assert.equal(updater.designRulesCheck(null,options,missing).length,0);
    const drc=updater.designRulesCheck(null,{...options,MissingSpice:true},missing);
    assert.deepEqual(drc.map(error=>error.id),[2,3]);
    assert.equal(drc[0].sheet,'Sheet 2');
    const badAttr = symbol(4,'R4','R4 1 0 $(missing)');
    assert.match(checkSpiceComponents(net([['Sheet 1',badAttr]]),defaultSetup())[0].text,/attr.*missing/);
    const badMacro = symbol(5,'R5','R5 1 0 $(missing');
    assert.match(checkSpiceComponents(net([['Sheet 1',badMacro]]),defaultSetup())[0].text,/Unterminated/);
    const badCommand = {...r1,text:[...r1.text,field(spice+'_PROLOG','.op')]};
    assert.match(checkSpiceComponents(net([['Sheet 1',badCommand]]),defaultSetup())[0].text,/analysis commands/);
    const badInclude = {...r1,text:[...r1.text,field(spice+'_PROLOG','.include missing.lib')]};
    assert.match(checkSpiceComponents(net([['Sheet 1',badInclude]]),defaultSetup())[0].text,/Attach referenced/);
    const badPriority = {...r1,text:[...r1.text,field(spice+'_PROLOG_PRIORITY','12')]};
    assert.match(checkSpiceComponents(net([['Sheet 1',badPriority]]),defaultSetup())[0].text,/priority/);
    const r10=symbol(10,'R10','R10 1 0 2k');
    const circuit=net([['Sheet 1',r1],['Sheet 2',r10]]);
    assert.deepEqual(locateSpiceErrors(circuit,'','Unknown parameter on r1').map(error=>error.id),[1]);
    assert.deepEqual(locateSpiceErrors(circuit,'title\n.temp 27\nR10 1 0 2k\n.op','Error on line 3').map(error=>error.id),[10]);
    const custom=symbol(8,'U1','custom_device 1 0 bad');
    const mapped=locateSpiceErrors(net([['Sheet 2',custom]]),'','Solver failed','stderr Error on line: custom_device 1 0 bad');
    assert.equal(mapped[0].id,8);
    assert.match(mapped[0].text,/custom_device/);
    assert.equal(locateSpiceErrors(circuit,'','Invalid analysis settings')[0].id,-1);
    const fileError=locateSpiceErrors(circuit,'title\n.temp 27\nR1 1 0 1k','Error on line 3 from file bad.lib');
    assert.equal(fileError[0].id,-1,'line numbers in attached files must not target an unrelated deck line');
    let state=DocStoreReducer(undefined,{type:'@@INIT'});
    state={...state,drawing:{...state.drawing,sheets:[{...state.drawing.sheets[0],items:[r1]}]}};
    state=DocStoreReducer(state,{type:'simulation/add',name:'Simulation'});
    const error={id:1,sheet:state.drawing.sheets[0].name,a:r1.point,symbol:'R1',text:'SPICE: syntax error'};
    const action={type:'simulation/diagnostics',documentId:state.drawing.documentId,errors:[error]};
    const version=state.drawingVersion;
    state=DocStoreReducer(state,action);
    assert.equal(state.drawingVersion,version,'reporting errors must not dirty the document');
    assert.equal(DocStoreReducer(state,{...action,documentId:'other-document'}),state);
    state=DocStoreReducer(state,{type:FindActionTypes.SetFindSelection,mode:3,selection:error});
    assert.equal(state.view.selected_sheet,0);
    assert.deepEqual(state.view.hover_ids,[1]);
    assert.deepEqual(state.view._selected_array,[]);
  `);
});

function sessionFixture(componentErrors = []) {
  const reports = [],
    commits = [];
  let events,
    starts = 0;
  const located = [
    {
      id: 7,
      sheet: 'Main',
      symbol: 'R1',
      a: [10, 20],
      text: 'SPICE: syntax error',
    },
  ];
  const module = loadComponent('src/simulation/session.ts', {
    './diagnostics': {
      checkSpiceComponents: () => componentErrors,
      locateSpiceErrors: (_net, _deck, _message, log) => {
        assert.match(log || '', /Error/);
        return located;
      },
    },
    './engine': {
      startEngine: (_request, callback) => {
        starts++;
        events = callback;
        return { stop() {}, dispose() {} };
      },
    },
    './deck': { buildDeck: () => 'title\nR1 1 0 bad\n.op\n.end' },
    '../io/dsnContainer': { digest: async () => 'hash' },
    './contracts': { newIdentity: () => 'run-1' },
    './resultStore': { activateResultDocument() {}, MAX_RUN_BYTES: 1024 },
    '../web-worker/netlistState': {
      NetlistWorkerState: class {
        init() {
          return { symbols: [] };
        }
      },
    },
  });
  return {
    module,
    reports,
    commits,
    located,
    get starts() {
      return starts;
    },
    get events() {
      return events;
    },
  };
}

test('preflight failures publish component rows before starting the solver', async () => {
  const error = {
    id: 1,
    sheet: 'Main',
    symbol: 'R1',
    a: [0, 0],
    text: 'No SPICE information',
  };
  const f = sessionFixture([error]);
  await assert.rejects(
    f.module.runSimulation(
      { documentId: 'doc', sheets: [] },
      'sim',
      { models: {}, runs: [] },
      (run) => f.commits.push(run),
      (rows) => f.reports.push(rows),
    ),
    /Correct the SPICE errors/,
  );
  assert.equal(f.starts, 0);
  assert.deepEqual(f.reports, [[], [error]]);
  assert.equal(f.module.getSession(), undefined);
  assert.match(f.module.getSimulationFailure(), /Correct the SPICE errors/);
});

test('solver syntax errors publish mapped rows even when no numerical results exist', async () => {
  const f = sessionFixture();
  await f.module.runSimulation(
    { documentId: 'doc', sheets: [] },
    'sim',
    { models: {}, runs: [] },
    (run) => f.commits.push(run),
    (rows) => f.reports.push(rows),
  );
  f.events({ type: 'log', message: 'stderr Error on line: R1 1 0 bad' });
  f.events({
    type: 'finished',
    state: 'failed',
    error: 'Error: circuit rejected',
  });
  assert.deepEqual(f.reports.at(-1), f.located);
  assert.equal(f.commits[0].state, 'failed');
  assert.equal(f.commits[0].dataState, 'not-retained');
  assert.match(f.commits[0].diagnosticLog, /stderr Error on line: R1 1 0 bad/);
  assert.equal(f.module.getSession(), undefined);
  assert.equal(f.module.getSimulationFailure(), 'Error: circuit rejected');
});
