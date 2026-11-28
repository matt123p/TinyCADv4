import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile, utimes } from 'node:fs/promises';
import path from 'node:path';
import { BlobReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';
import { COMPRESSED_DRAWING_MIME } from '../../shared/drawingFiles.js';
import { createHierarchyIndex } from '../../electron/projectHierarchyIndex.js';
import { createProjectSettings } from '../../electron/projectSettings.js';
import { runRegression } from './run-regression.mjs';

test('project hierarchy scan indexes DSN and DZN, observes nested ignores and reuses its timestamp cache', async (t) => {
  await mkdir(path.resolve('.tmp'), { recursive: true });
  const root = await mkdtemp(path.resolve('.tmp', 'hierarchy-index-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const main = path.join(root, 'Main.dsn');
  const xml = (reference) => '<TinyCAD><HIERACHICAL_SYMBOL file="Parts/Child.dzn">' +
    '<FIELD description="Ref" value="' + reference + '"/></HIERACHICAL_SYMBOL></TinyCAD>';
  const linked = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  await linked.add('mimetype', new BlobReader(new Blob([COMPRESSED_DRAWING_MIME])));
  await linked.add('drawing.xml', new BlobReader(new Blob([
    '<TinyCADSheets><HierarchicalSymbol/><TinyCAD/></TinyCADSheets>',
  ])));
  await Promise.all([mkdir(path.join(root, 'Parts')), mkdir(path.join(root, 'Ignored'))]);
  await Promise.all([
    writeFile(main, xml('U3')),
    writeFile(path.join(root, '.gitignore'), 'Ignored/\n*.ignore.dsn\n'),
    writeFile(path.join(root, 'Parts', '.gitignore'), '*.dsn\n!Reincluded.dsn\n'),
    writeFile(path.join(root, 'Parts', 'Child.dzn'), await linked.close()),
    writeFile(path.join(root, 'Parts', 'Excluded.dsn'), xml('X1')),
    writeFile(path.join(root, 'Parts', 'Reincluded.dsn'), '<TinyCAD/>'),
    writeFile(path.join(root, 'Ignored', 'Excluded.dsn'), xml('X2')),
    writeFile(path.join(root, 'Ignore.ignore.dsn'), xml('X3')),
  ]);
  const read = [];
  const settings = createProjectSettings({
    readFile: (id) => readFile(id), pendingWrites: new Set(),
    linkNewFile: async (source, target) => writeFile(target, await readFile(source), { flag: 'wx' }),
  });
  const index = () => createHierarchyIndex({
    ...settings,
    readFile: (id) => { if (!id.endsWith('.gitignore')) read.push(path.basename(id)); return readFile(id); },
  });
  const first = await index()(root);
  assert.equal(first.limited, false);
  assert.equal(first.unreadable, 0);
  assert.deepEqual(first.drawings.map(({ path }) => path), ['Main.dsn', 'Parts/Child.dzn', 'Parts/Reincluded.dsn']);
  assert.deepEqual(first.drawings[0].links, [{ filename: 'Parts/Child.dzn', reference: 'U3' }]);
  assert.equal(first.drawings[1].hasSymbol, true);
  assert.match(await readFile(path.join(root, path.basename(root) + '.tcproject'), 'utf8'), /tinycad-hierarchy/);
  read.length = 0;
  assert.deepEqual((await index()(root)).drawings, first.drawings);
  assert.deepEqual(read, []);
  await writeFile(main, xml('U4'));
  await utimes(main, new Date(), new Date(Date.now() + 3000));
  const changed = await index()(root);
  assert.deepEqual(read, ['Main.dsn']);
  assert.equal(changed.drawings[0].links[0].reference, 'U4');
  await mkdir(path.join(root, ...Array(34).fill('d')), { recursive: true });
  const bounded = await index()(root);
  assert.equal(bounded.limited, true);
  assert.deepEqual(bounded.drawings, changed.drawings);
});

test('v3 hierarchical links round-trip and repeated nested instances connect only through their named ports', async () => {
  await runRegression(`
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { ioXML } from './src/io/ioXml';
    import { XMLBuilder } from './src/util/xmlbuilder';
    import { prepareHierarchicalPlacement, resolveProjectHierarchy } from './src/io/projectHierarchy';
    import { hierarchyBrowserModel, searchHierarchy } from './src/io/projectHierarchyBrowser';
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
    const topTab = JSON.stringify(['/project/top.dsn']);
    const blockTab = JSON.stringify(['/project/block.dsn']);
    const tab = (id, name, drawing) => ({ file: { id, name }, history: { present: { drawing } } });
    const blockSnapshot = tab('/project/block.dsn', 'block.dsn', middle);
    const browser = hierarchyBrowserModel('/project', { drawings: [
      { path: 'top.dsn', hasSymbol: false, links: [{ filename: 'block.dsn', reference: 'U0' }] },
      { path: 'leaf.dsn', hasSymbol: true, links: [] },
    ] }, {
      schematicTabs: { enabled: true, order: [topTab, blockTab], inactive: { [topTab]: tab('/project/top.dsn', 'top.dsn', parent) } },
      altStore: blockSnapshot, docStore: blockSnapshot.history,
    }, true);
    assert.equal(browser.tree[0].filename, 'top.dsn');
    assert.deepEqual(browser.tree[0].children.map((child) => child.reference), ['H1', 'H2']);
    assert.deepEqual(browser.tree[0].children.map((child) => child.children[0].reference), ['H7', 'H7']);
    assert.deepEqual(browser.candidates.map(({ filename }) => filename), ['block.dsn', 'leaf.dsn']);
    assert.deepEqual([...browser.placementCycles].sort(), ['block.dsn', 'top.dsn']);
    const unsavedArtwork = { ...middle, sheets: [middle.sheets[0], { ...middle.sheets[1], items: [] }] };
    const standalone = hierarchyBrowserModel('/project', undefined, {
      schematicTabs: { enabled: true, order: [blockTab], inactive: {} },
      altStore: blockSnapshot, docStore: { present: { drawing: unsavedArtwork } },
    }, true);
    assert.deepEqual(standalone.tree, []);
    assert.equal(standalone.candidates[0].drawing, unsavedArtwork);
    assert.equal(standalone.placementCycles.has('block.dsn'), true);
    const search = (query) => searchHierarchy(browser.tree, browser.candidates, query);
    const byRef = search('  h2 BLOCK  ');
    assert.equal(byRef.tree[0].filename, 'top.dsn');
    assert.deepEqual(byRef.tree[0].children.map((child) => child.reference), ['H2']);
    assert.equal(byRef.tree[0].children[0].children.length, 0);
    const byFilename = search('LEAF');
    assert.deepEqual(byFilename.tree[0].children.map((child) => child.reference), ['H1', 'H2']);
    assert.deepEqual(byFilename.candidates.map(({ filename }) => filename), ['leaf.dsn']);
    assert.deepEqual(search('unknown'), { tree: [], candidates: [] });
    assert.equal(search(' ').tree, browser.tree);
    const loop = hierarchyBrowserModel('/project', { drawings: [
      { path: 'block.dsn', hasSymbol: true, links: [
        { filename: 'top.dsn', reference: 'U9' },
        { filename: 'leaf.dsn', reference: 'U10' },
      ] },
      { path: 'leaf.dsn', hasSymbol: true, links: [] },
    ] }, {
      schematicTabs: { enabled: true, order: [topTab], inactive: {} },
      altStore: tab('/project/top.dsn', 'top.dsn', parent),
      docStore: { present: { drawing: parent } },
    }, true);
    const [backLink, otherLink] = loop.tree[0].children[0].children;
    assert.equal(backLink.filename, 'top.dsn');
    assert.equal(backLink.reference, 'U9');
    assert.equal(backLink.cycle, true);
    assert.deepEqual(backLink.children, []);
    assert.equal(otherLink.filename, 'leaf.dsn');
    assert.equal(otherLink.cycle, false);
    assert.equal(loop.limited, false);
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
    files.delete('block.dsn');
    const missing = await resolveProjectHierarchy(expanded, '/project', '/project/top.dsn');
    const marker = missing.sheets[0].items[0];
    assert.equal(marker._symbol.outlines[0].items[0].text, '?');
    assert.deepEqual(new updateSymbol(marker).active_points(), []);
    assert.equal(marker._hierarchicalDrawing, undefined);
    const missingNetlist = new NetlistWorkerState().init(missing);
    assert.equal(drc.designRulesCheck(missing, {}, missingNetlist).length, 2);
    assert.throws(() => netlistContents('Top.dsn', 'PADS-PCB', missingNetlist), /H1.*Missing file/);
    const brokenTree = hierarchyBrowserModel('/project', { drawings: [] }, {
      schematicTabs: { enabled: true, order: [topTab], inactive: {} },
      altStore: tab('/project/top.dsn', 'top.dsn', missing),
      docStore: { present: { drawing: missing } },
    }, true);
    assert.match(brokenTree.tree[0].children[0].error, /Missing file/);

    files.set('block.dsn', { ...middle, sheets: [middle.sheets[1]] });
    const noArtwork = await resolveProjectHierarchy(missing, '/project', '/project/top.dsn');
    assert.equal(noArtwork.sheets[0].items[0]._symbol.outlines[0].items[0].text, '?');
    const invalidNetlist = new NetlistWorkerState().init(noArtwork);
    assert.match(drc.designRulesCheck(noArtwork, {}, invalidNetlist)[0].text, /no hierarchical symbol sheet/);
    assert.throws(() => netlistContents('Top.dsn', 'VHDL', invalidNetlist), /no hierarchical symbol sheet/);

    const revised = structuredClone(middle);
    revised.sheets[0].items[0].name = 'REVISED';
    files.set('block.dsn', revised);
    const restored = await resolveProjectHierarchy(noArtwork, '/project', '/project/top.dsn');
    assert.equal(new updateSymbol(restored.sheets[0].items[0]).active_points()[0][2].name, 'REVISED');
    assert.equal(restored.sheets[0].items[0]._hierarchicalError, undefined);
    assert.equal(restored.sheets[0].items[0].text[0].value, 'H1');
    assert.equal(new NetlistWorkerState().init(restored).hierarchyErrors, undefined);
    const unresolved = new NetlistWorkerState().init(parent);
    assert.equal(unresolved.hierarchyErrors.length, 2);
    })();
  `);
});
