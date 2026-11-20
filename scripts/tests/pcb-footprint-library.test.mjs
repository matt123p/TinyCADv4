import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

const api = await layoutRuntime();
const kicadFootprint = `(footprint "Fixture"
  (version 20241229) (layer "F.Cu")
  (fp_line (start -2 1) (end 2 1) (stroke (width 0.15) (type solid)) (layer "F.SilkS"))
  (pad "01" smd roundrect (at -1 0 90) (size 1.2 2) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.25))
  (pad "A1" thru_hole oval (at 1 0) (size 2 1.6) (drill oval 1.2 0.8) (layers "*.Cu" "*.Mask"))
  (model "example.step" (offset (xyz 0.1 0.2 0.3)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 90)))
)`;

test('imports KiCad 9 closed graphics and through-hole pads with all copper layers retained', async () => {
  const source = `(footprint "KiCad9" (layer "F.Cu")
    (fp_poly (pts (xy 0 0) (xy 2 0) (xy 2 2) (xy 0 0)) (layer "F.SilkS"))
    (fp_circle (center 0 0) (end 2 0) (layer "Cmts.User"))
    (pad "1" thru_hole circle (at 0 0) (size 2 2) (drill 1)
      (layers "*.Cu" "*.Mask") (remove_unused_layers no))
  )`;
  const { footprint, issues } = await api.importFootprintLibrary(
    source,
    'kicad9.kicad_mod',
  );
  assert.equal(footprint.definition.graphics[0].points.length, 3);
  assert.ok(footprint.definition.pads[0].stack.copper.bottom);
  assert.deepEqual(
    issues.map(({ severity }) => severity),
    ['warning'],
  );
  const blocked = await api.importFootprintLibrary(
    source.replace('remove_unused_layers no', 'remove_unused_layers yes'),
    'conditional-copper.kicad_mod',
  );
  assert.equal(blocked.footprint, undefined);
  assert.ok(
    blocked.issues.some(
      ({ severity, message }) =>
        severity === 'blocker' && message.includes('unused copper layers'),
    ),
  );
});

test('imports KiCad geometry, preserves native draft and enforces resolved reviewed device dependencies', async () => {
  const { footprint, issues } = await api.importFootprintLibrary(
    kicadFootprint,
    'fixture.kicad_mod',
  );
  assert.equal(footprint.provenance.kind, 'imported-unreviewed');
  assert.equal(issues[0].severity, 'warning');
  assert.equal(footprint.definition.graphics[0].layer, 'F.SilkS');
  assert.equal(footprint.definition.models[0].source, 'example.step');
  assert.equal(footprint.definition.models[0].assetId, undefined);
  const [first, second] = footprint.definition.pads;
  assert.deepEqual([first.label, second.label], ['01', 'A1']);
  assert.equal(second.stack.drill.widthNm, 800_000);
  const shifted = api.translateFootprintOrigin(
    footprint.definition,
    first.positionNm,
  );
  assert.deepEqual(shifted.pads[0].positionNm, { x: 0, y: 0 });
  assert.equal(shifted.pads[1].positionNm.x, 2_000_000);
  assert.equal(
    shifted.models[0].offsetNm[0],
    footprint.definition.models[0].offsetNm[0] + 1_000_000,
  );
  assert.deepEqual(shifted.pads[1].stack, second.stack);
  assert.equal(second.stack.drill.plated, true);
  assert.equal(second.stack.drill.end.x - second.stack.drill.start.x, 400_000);
  assert.deepEqual(
    await api.decodeFootprintLibrary(
      await api.encodeFootprintLibrary(footprint),
    ),
    footprint,
  );

  const blocked = await api.importFootprintLibrary(
    kicadFootprint.replace('smd roundrect', 'smd trapezoid'),
    'unsupported.kicad_mod',
  );
  assert.equal(blocked.footprint, undefined);
  assert.equal(blocked.issues[0].severity, 'blocker');

  const config = {
    widthNm: 4_000_000,
    heightNm: 3_000_000,
    packageName: 'Fixture',
    license: 'CC0-1.0',
    reviewer: 'Fixture reviewer',
    evidence: 'Fixture drawing',
    mappings: new Map([
      [first.id, { kind: 'signal', terminal: 'A' }],
      [second.id, { kind: 'signal', terminal: 'A' }],
    ]),
  };
  await assert.rejects(
    api.publishFootprintDevice(footprint, config),
    /models must be embedded/,
  );
  const asset = await api.createBoardModelAsset(
    new TextEncoder().encode(
      'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;',
    ),
    'fixture.step',
    'CC0-1.0',
  );
  const { definitionDigest: oldDigest, ...definition } = footprint.definition;
  const datasheetUrl =
    'https://example.com/device.pdf?revision=1&lang=en#page=2';
  for (const url of [
    'javascript:alert(1)',
    'file:///tmp/device.pdf',
    '/device.pdf',
    'https://',
    'https://x@y.test/device.pdf',
  ]) {
    await assert.rejects(
      api.footprintDefinition({ ...definition, datasheetUrl: url }),
      /datasheet URL/,
    );
  }
  const resolved = {
    ...footprint,
    assets: [asset],
    definition: await api.footprintDefinition({
      ...definition,
      datasheetUrl,
      models: definition.models.map((model) => ({
        ...model,
        assetId: asset.id,
      })),
    }),
  };
  const reopened = await api.decodeFootprintLibrary(
    await api.encodeFootprintLibrary(resolved),
  );
  assert.equal(reopened.definition.datasheetUrl, datasheetUrl);
  const { definition: device } = await api.readLibraryDevice(
    await api.publishFootprintDevice(resolved, config),
  );
  assert.equal(device.mount, 'mixed');
  assert.equal(device.footprint.datasheetUrl, datasheetUrl);
  assert.equal(device.terminals.length, 1);
  assert.equal(device.assignments[0].signalId, device.assignments[1].signalId);
  assert.equal(device.footprint.models[0].assetId, asset.id);
  assert.deepEqual(device.models, [asset]);
});

test('authors plated slots and non-plated holes with independent dimensions', async () => {
  const parameters = {
    id: crypto.randomUUID(),
    label: 'EP',
    positionNm: { x: 0, y: 0 },
    profile: 'rectangle',
    widthNm: 2_400_000,
    heightNm: 2_200_000,
    drillWidthNm: 800_000,
    drillLengthNm: 1_400_000,
  };
  const plated = api.makeFootprintPad(parameters);
  assert.equal(plated.stack.copper.top.kind, 'polygon');
  assert.deepEqual(plated.stack.copper.top, plated.stack.copper.bottom);
  assert.equal(plated.stack.drill.plated, true);
  assert.equal(plated.stack.drill.end.x - plated.stack.drill.start.x, 600_000);
  const rounded = api.makeFootprintPad({
    ...parameters,
    profile: 'roundrect',
    cornerRadiusNm: 200_000,
  });
  assert(rounded.stack.copper.top.vertices.length > 4);
  const custom = api.makeFootprintPad({
    ...parameters,
    profile: 'polygon',
    polygon: [
      { x: 0, y: 0 },
      { x: 2_000_000, y: 0 },
      { x: 0, y: 2_000_000 },
    ],
  });
  assert.equal(custom.stack.copper.top.vertices.length, 3);
  const mechanical = api.makeFootprintPad({ ...parameters, profile: 'hole' });
  assert.deepEqual(mechanical.stack.copper, {});
  assert.equal(mechanical.stack.drill.plated, false);
  const mountingHole = {
    format: 'tinycad-footprint',
    version: 1,
    provenance: { kind: 'authored', source: 'Mounting hole fixture' },
    definition: await api.footprintDefinition({
      id: crypto.randomUUID(),
      name: 'Mounting hole',
      revision: '1',
      pads: [mechanical],
    }),
  };
  const publication = {
    widthNm: 2_400_000,
    heightNm: 2_200_000,
    license: 'CC0-1.0',
    reviewer: 'Fixture reviewer',
    evidence: 'Fixture hole drawing',
    packageName: 'Mounting hole',
  };
  const data = await api.publishFootprintDevice(mountingHole, {
    ...publication,
    mappings: new Map([[mechanical.id, { kind: 'mechanical' }]]),
  });
  const { definition: device } = await api.readLibraryDevice(data);
  assert.equal(device.mount, 'through-hole');
  assert.deepEqual(device.terminals, []);
  assert.deepEqual(device.assignments, [
    { kind: 'mechanical', padId: mechanical.id },
  ]);
  assert.deepEqual(
    device.footprint.pads[0].stack.drill,
    mechanical.stack.drill,
  );
  await assert.rejects(
    api.publishFootprintDevice(mountingHole, {
      ...publication,
      mappings: new Map([[mechanical.id, { kind: 'nc' }]]),
    }),
    /must assign every pad as mechanical/,
  );
  const binary = new Uint8Array(
    await readFile(
      new URL(
        '../../node_modules/clipper2-wasm/dist/umd/clipper2z.wasm',
        import.meta.url,
      ),
    ),
  ).buffer;
  const kernel = await api.loadPolygonKernel(binary);
  const findings = api.inspectFootprintDimensions(
    { pads: [plated, mechanical] },
    kernel,
    800_000,
  );
  assert.equal(
    findings.filter(({ message }) => message.includes('annular ring')).length,
    2,
  );
  assert(findings.some(({ message }) => message.includes('Repeated label')));
  assert(findings.some(({ location }) => location === 'Courtyard'));
  const overlapping = api.inspectFootprintDimensions(
    {
      pads: [
        plated,
        {
          ...plated,
          id: crypto.randomUUID(),
          label: '2',
          positionNm: { x: 2_300_000, y: 0 },
        },
        {
          ...plated,
          id: crypto.randomUUID(),
          label: '3',
          positionNm: { x: 4_700_000, y: 0 },
        },
      ],
    },
    kernel,
    150_000,
  );
  assert(
    overlapping.some(
      ({ location, message }) =>
        location === 'Pads EP (1) and 2 (2)' &&
        message.includes('copper lands touch'),
    ),
  );
  assert(
    overlapping.some(
      ({ location, message }) =>
        location === 'Pads EP (1) and 2 (2)' &&
        message.includes('solder mask openings overlap'),
    ),
  );
  assert(
    overlapping.some(
      ({ location, message }) =>
        location === 'Pads 2 (2) and 3 (3)' &&
        message.includes('copper lands touch'),
    ),
  );
  assert(
    !overlapping.some(
      ({ location, message }) =>
        location === 'Pads 2 (2) and 3 (3)' &&
        message.includes('solder mask openings overlap'),
    ),
  );
  const inadequate = api.inspectFootprintDimensions(
    {
      pads: [plated],
      graphics: [
        {
          kind: 'rect',
          layer: 'F.CrtYd',
          strokeNm: 100_000,
          filled: false,
          start: { x: -200_000, y: -200_000 },
          end: { x: 200_000, y: 200_000 },
        },
      ],
    },
    kernel,
    150_000,
  );
  assert(
    inadequate.some(
      ({ location, message }) =>
        location === 'F.CrtYd' && message.includes('falls outside'),
    ),
  );
});

test('retains the KiCad footprint locator and exposes its package as a search hint', async () => {
  const [symbol] = await api.kicadImporter.importSymbols(`(kicad_symbol_lib
    (version 20241209)
    (symbol "Fixture"
      (property "Reference" "U" (at 0 1 0) (effects (font (size 1 1))))
      (in_bom no) (on_board no)
      (property "Value" "Fixture" (at 0 -1 0) (effects (font (size 1 1))))
      (property "Footprint" "Package_Test:Fixture" (at 0 0 0) (effects (font (size 1 1)) (hide yes)))
      (symbol "Fixture_1_1"
        (text_box "not in the subset")
        (pin passive line (at 0 0 0) (length 1)
          (name "Signal" (effects (font (size 1 1))))
          (number "01" (effects (font (size 1 1))))
        )
      )
    )
  )`);
  assert.equal(
    symbol.name.Attributes.find(({ AttName }) => AttName === 'Footprint')
      .AttValue,
    'Package_Test:Fixture',
  );
  assert.equal(
    symbol.name.Attributes.find(({ AttName }) => AttName === 'Package')
      .AttValue,
    'Fixture',
  );
  assert.equal(
    symbol.symbolData[0].find(({ NodeName }) => NodeName === 'pin').number,
    '01',
  );
  assert.equal(
    symbol.name.Attributes.find(({ AttName }) => AttName === 'PCB Role')
      .AttValue,
    'virtual',
  );
  assert.equal(
    symbol.name.Attributes.find(({ AttName }) => AttName === 'KiCad In BOM')
      .AttValue,
    'no',
  );
  assert.deepEqual(symbol.issues, ['Unsupported symbol graphic: text_box.']);
});
