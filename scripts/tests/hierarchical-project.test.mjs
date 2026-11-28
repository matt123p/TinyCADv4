import { test } from 'node:test';
import { runRegression } from './run-regression.mjs';

test('v3 hierarchical links round-trip and repeated nested instances connect only through their named ports', async () => {
  await runRegression(`
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { ioXML } from './src/io/ioXml';
    import { XMLBuilder } from './src/util/xmlbuilder';
    import { prepareHierarchicalPlacement, resolveProjectHierarchy } from './src/io/projectHierarchy';
    import { NetlistWorkerState } from './src/web-worker/netlistState';
    import { updateSymbol } from './src/manipulators/updateSymbol';
    import { updateDrawing } from './src/manipulators/updateDrawing';
    import { netlistContents } from './src/io/netlists/netlistFiles';
    import { DocItemTypes } from './src/model/dsnItem';

    module.exports = (async () => {
    globalThis.document = { createElement: () => ({ getContext: () => ({
      measureText: (text) => ({ width: String(text).length * 8, actualBoundingBoxDescent: 3 }),
    }) }) };
    const xml = new ioXML();
    function read(text) {
      const builder = new XMLBuilder();
      builder.fromText(text);
      return xml.from_dsn(builder);
    }
    function link(tag, ref, file, pos) {
      return '<' + tag + ' pos="' + pos + '" rotate="0" can_scale="0" scale_x="1" scale_y="1" file="' + file + '">'
        + '<FIELD description="Ref" value="' + ref + '" pos="1,1" type="0" show="1"/>'
        + '<FIELD description="Design" value="" pos="1,2" type="0" show="1"/>'
        + '</' + tag + '>';
    }
    const art = '<HierachicalSymbol><NAME>Artwork</NAME>'
      + '<PIN pos="2,4" direction="2" length="2" number="" which="0" elec="4" part="0" show="1">IN</PIN>'
      + '</HierachicalSymbol>';
    const parent = read('<TinyCADSheets><TinyCAD><NAME>Parent</NAME>'
      + link('HIERACHICAL_SYMBOL', 'H1', '.\\\\block.dsn', '20,20')
      + link('HIERARCHICAL_SYMBOL', 'H2', '.\\\\block.dsn', '70,50')
      + '</TinyCAD></TinyCADSheets>');
    const markup = xml.to_dsn(parent, true, true).tostring();
    assert.equal((markup.match(/<HIERARCHICAL_SYMBOL /g) || []).length, 2);
    assert.match(markup, /file="\.\\\\block\.dsn"/);
    assert.doesNotMatch(markup, /<SYMBOLDEF|HIERACHICAL_SYMBOL/);

    const component = read(readFileSync('scripts/tests/fixtures/simple-spice.dsn', 'utf8')).sheets[0].items
      .find((item) => item.NodeName === DocItemTypes.Symbol);
    const labels = read('<TinyCAD><NAME>Label fixture</NAME><LABEL pos="1,1" direction="0">IN</LABEL></TinyCAD>');
    const baseLabel = labels.sheets[0].items[0];
    function label(point, text) {
      return { ...baseLabel, point: point.slice(0, 2), text };
    }

    const leaf = read('<TinyCADSheets>' + art + '<TinyCAD><NAME>Leaf</NAME></TinyCAD></TinyCADSheets>');
    const pins = new updateSymbol(component).active_points();
    leaf.sheets[1].items = [component, label(pins[0], 'IN'), label(pins[1], 'PRIVATE')];
    const middle = read('<TinyCADSheets>' + art + '<TinyCAD><NAME>Block</NAME>'
      + link('HIERARCHICAL_SYMBOL', 'H7', 'leaf.dsn', '10,10')
      + '</TinyCAD></TinyCADSheets>');
    const files = new Map([['leaf.dsn', leaf], ['block.dsn', middle]]);
    globalThis.window = { electronAPI: { async projectFiles(request) {
      assert.equal(request.project, '/project');
      const name = request.filename.split(/[\\\\/]/).at(-1);
      const content = files.get(name);
      if (!content) throw Error('Missing file');
      return { id: '/project/' + name, relative: name, data: new TextEncoder().encode(xml.to_dsn(content, true, true).tostring()) };
    } } };
    const middleWithPins = await resolveProjectHierarchy(middle, '/project', '/project/block.dsn');
    const nested = middleWithPins.sheets[1].items[0];
    middle.sheets[1].items.push(label(new updateSymbol(nested).active_points()[0], 'IN'));

    const expanded = await resolveProjectHierarchy(parent, '/project', '/project/top.dsn');
    const draftLink = await prepareHierarchicalPlacement(parent, 0, '/project', undefined, '/project/block.dsn');
    assert.equal(draftLink.hierarchicalFile, 'block.dsn');
    assert.equal(draftLink._hierarchicalOwner, '/project');
    const legacyAbsolute = read('<TinyCADSheets><TinyCAD>'
      + link('HIERARCHICAL_SYMBOL', 'H1', '/project/block.dsn', '20,20')
      + '</TinyCAD></TinyCADSheets>');
    const normalized = await resolveProjectHierarchy(legacyAbsolute, '/project', '/project/top.dsn');
    assert.equal(normalized.sheets[0].items[0].hierarchicalFile, 'block.dsn');
    const links = expanded.sheets[0].items;
    assert.equal(links[0]._hierarchicalDrawing.sheets[0].hierarchicalSymbol, true);
    assert.equal(links[0].hierarchicalFile, '.\\\\block.dsn');
    assert.equal(links[0].text.find((field) => field.description === 'Design').value, 'block.dsn');
    expanded.sheets[0].items = [
      ...links,
      label(new updateSymbol(links[0]).active_points()[0], 'FIRST'),
      label(new updateSymbol(links[1]).active_points()[0], 'SECOND'),
    ];
    const worker = new NetlistWorkerState();
    const netlist = worker.init(expanded);
    assert.deepEqual(netlist.symbols.map(([, symbol]) => symbol.text.find((row) => row.description === 'Ref').value),
      ['H1_H7_R1', 'H2_H7_R1']);
    assert.equal(netlist.labels.FIRST, netlist.labels.H1_H7_IN);
    assert.equal(netlist.labels.SECOND, netlist.labels.H2_H7_IN);
    assert.notEqual(netlist.labels.FIRST, netlist.labels.SECOND);
    assert.notEqual(netlist.labels.H1_H7_PRIVATE, netlist.labels.H2_H7_PRIVATE);
    assert.equal(netlist.hierarchyErrors, undefined);
    assert.equal(netlist.nets[netlist.labels.FIRST].filter((node) => node.reference)[0].reference, 'H1_H7_R1');
    assert.deepEqual(new updateDrawing().makeBomForDrawing(expanded)[0].References,
      ['H1_H7_R1', 'H2_H7_R1']);
    const shared = { ...expanded.sheets[0], items: [...links,
      label(new updateSymbol(links[0]).active_points()[0], 'SHARED'),
      label(new updateSymbol(links[1]).active_points()[0], 'SHARED'),
    ] };
    const incrementallyLinked = worker.update([shared], []);
    assert.equal(incrementallyLinked.labels.H1_H7_IN, incrementallyLinked.labels.H2_H7_IN);
    assert.notEqual(incrementallyLinked.labels.H1_H7_PRIVATE, incrementallyLinked.labels.H2_H7_PRIVATE);
    const pads = netlistContents('Top.dsn', 'PADS-PCB', incrementallyLinked);
    assert.match(pads, /\\*SIGNAL\\* +SHARED/);
    assert.match(pads, /H1_H7_R1\\.1 H2_H7_R1\\.1/);
    const spice = netlistContents('Top.dsn', 'SPICE', incrementallyLinked);
    assert.match(spice, /^R1_H7_H1 SHARED H1_H7_PRIVATE /m);
    assert.match(spice, /^R1_H7_H2 SHARED H2_H7_PRIVATE /m);

    const drc = new updateDrawing();
    const outputs = structuredClone(leaf);
    const output = outputs.sheets[1].items[0];
    new updateSymbol(output).active_points()[0][2].elec = 1;
    const extra = structuredClone(output);
    extra._id += 100000;
    extra.text.find((field) => field.description === 'Ref').value = 'R?';
    outputs.sheets.push({ ...outputs.sheets[1], name: 'Second circuit sheet', items: [extra] });
    const editedTab = new Map([['/project/leaf.dsn', outputs]]);
    const linkedDrawing = await resolveProjectHierarchy({ ...parent, sheets: [shared] },
      '/project', '/project/top.dsn', editedTab);
    const drcNetlist = new NetlistWorkerState().init(linkedDrawing);
    const findings = drc.designRulesCheck(linkedDrawing, {
      Output: true, MultipleNetNames: true, UnAssignedRefDes: true, UnConnected: true,
    }, drcNetlist);
    const shorts = findings.filter((finding) => finding.text === 'Output connected to an output');
    assert.deepEqual(shorts.map(({ source }) => [source.fileId, source.sheet, source.instancePath]), [
      ['/project/leaf.dsn', 'Leaf', ['H1', 'H7']],
      ['/project/leaf.dsn', 'Leaf', ['H2', 'H7']],
    ]);
    assert.equal(findings.filter((finding) => finding.sheet === 'Second circuit sheet' &&
      finding.text.startsWith('Unassigned reference')).length, 2);
    assert.equal(findings.some((finding) => finding.text === 'Multiple names on same net'), false);

    outputs.sheets[1].items = outputs.sheets[1].items.filter((item) => item.text !== 'IN');
    const missingPort = await resolveProjectHierarchy(parent, '/project', '/project/top.dsn', editedTab);
    const portFindings = drc.designRulesCheck(missingPort, { UnConnected: true }, new NetlistWorkerState().init(missingPort));
    assert.deepEqual(portFindings.filter((finding) => finding.text.includes('matching label'))
      .map(({ source, pin }) => [source.fileId, source.sheet, source.instancePath, pin]), [
        ['/project/block.dsn', 'Block', ['H1'], 'IN'],
        ['/project/block.dsn', 'Block', ['H2'], 'IN'],
      ]);

    const cyclic = read('<TinyCADSheets>' + art + '<TinyCAD><NAME>Cycle</NAME>'
      + link('HIERARCHICAL_SYMBOL', 'H1', 'cycle.dsn', '10,10') + '</TinyCAD></TinyCADSheets>');
    files.set('cycle.dsn', cyclic);
    const rejected = await resolveProjectHierarchy(cyclic, '/project', '/project/cycle.dsn');
    const cycleNetlist = new NetlistWorkerState().init(rejected);
    assert.match(cycleNetlist.hierarchyErrors[0], /cycle/i);
    const [cycleFinding] = drc.designRulesCheck(rejected, {}, cycleNetlist);
    assert.equal(cycleFinding.sheet, 'Cycle');
    assert.match(cycleFinding.text, /cycle/i);
    const unresolved = new NetlistWorkerState().init(parent);
    assert.equal(unresolved.hierarchyErrors.length, 2);
    })();
  `);
});
