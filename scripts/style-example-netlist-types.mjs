import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import sharp from 'sharp';
import { buildServerBundle } from './build-server-bundle.mjs';
import { layoutRuntime } from './lib/layout-runtime.mjs';

// One identifying socket per net. Links on either side of isolation equipment
// can share an appearance while remaining separate electrical nets.
const styles = {
  'network-layout': [
    ['ISP fibre', '#a04c00', 4, ['ONT1:2']],
    ['Internet hand-off', '#2563a6', 4, ['ONT1:1']],
    ['SFP+ uplink', '#783a9c', 5, ['RTR1:5']],
    ['Access point PoE', '#007964', 4, ['SW1:4']],
    ['Desk Ethernet', '#a2315d', 3, ['SW1:6']],
  ],
  'solar-battery-home': [
    ['Solar PV DC', '#a04c00', 4, ['PV1:PV_DC', 'PVISO1:PV_OUT']],
    ['Battery DC', '#783a9c', 4, ['BAT1:BATT_DC', 'BISO1:BATT_OUT']],
    ['Inverter AC', '#007964', 5, ['INV1:HOME_AC', 'ACISO1:AC_OUT']],
    ['Grid AC', '#2563a6', 5, ['GRID1:GRID_AC', 'METER1:HOME_AC']],
    ['Household AC', '#a2315d', 3, ['CU1:HOME']],
  ],
  'podcast-studio': [
    ['Microphone XLR', '#783a9c', 4, ['MIC1:1', 'MIC2:1']],
    ['Stereo headphones', '#007964', 3, ['HP1:1', 'HP2:1']],
    ['USB audio', '#2563a6', 5, ['PC1:1']],
  ],
};

const root = 'bundled-examples';
const provenancePath = `${root}/library-examples.provenance.json`;
const provenance = JSON.parse(await fs.readFile(provenancePath, 'utf8'));
const hash = (content) => createHash('sha256').update(content).digest('hex');
const ids = process.argv.slice(2);
for (const id of ids)
  assert.ok(Object.hasOwn(styles, id), `Unknown example ${id}`);

const api = await layoutRuntime();
const bundle = 'drawing-server.bundle.js';
await buildServerBundle({
  entry: 'drawing.tsx',
  output: bundle,
  drawing: true,
});
const context = vm.createContext({ console });
vm.runInContext(await fs.readFile(bundle, 'utf8'), context);
const renderer = context.TinyCADDrawingServerBundle;

for (const [id, types] of Object.entries(styles)) {
  if (ids.length && !ids.includes(id)) continue;
  const path = `${root}/drawings/${id}.dsn`;
  const source = await fs.readFile(path, 'utf8');
  const drawing = await api.decodeDrawing(Buffer.from(source));
  const netlist = new api.NetlistGenerator();
  api.makeNetForDrawing(drawing, netlist);
  const typeBySocket = new Map(
    types.flatMap(([name, , , sockets]) =>
      sockets.map((socket) => [socket, name]),
    ),
  );
  const unmatched = new Set(typeBySocket.keys());
  const typeByWire = new Map();
  for (const net of Object.values(netlist.nets)) {
    const sockets = new Set(
      net
        .map((node) => `${node.reference}:${node.pin}`)
        .filter((socket) => typeBySocket.has(socket)),
    );
    const wires = net.filter((node) => node.parent?.NodeName === 'wire');
    if (!wires.length) continue;
    assert.equal(
      sockets.size,
      1,
      `${id}: each cable net must have one identifying socket`,
    );
    const [socket] = sockets;
    unmatched.delete(socket);
    for (const { parent } of wires)
      typeByWire.set(parent._id, typeBySocket.get(socket));
  }
  assert.equal(
    unmatched.size,
    0,
    `${id}: missing sockets ${[...unmatched].join(', ')}`,
  );

  // Add styling to the reviewed drawing without reserializing its geometry,
  // resources or notes. Check each XML wire against the decoded model first.
  const wires = drawing.sheets.flatMap((sheet) =>
    sheet.items.filter((item) => item.NodeName === 'wire'),
  );
  let wireIndex = 0;
  const definition = source.replace(/<WIRE\b[^>]*\/>/g, (tag) => {
    const wire = wires[wireIndex++];
    const points = ['a', 'b'].map((attribute) =>
      tag
        .match(new RegExp(` ${attribute}="([^"]+)"`))[1]
        .split(',')
        .map((value) => Number(value) * 5),
    );
    assert.deepEqual(
      wire.d_points,
      points,
      `${id}: wire ordering must match the drawing`,
    );
    const type = typeByWire.get(wire._id);
    assert.ok(type, `${id}: missing type for wire at ${points}`);
    return tag
      .replace(/ net_type="[^"]*"/g, '')
      .replace(/\/>$/, ` net_type="${type}"/>`);
  });
  assert.equal(wireIndex, wires.length);
  const typeXml = types
    .map(
      ([name, colour, width]) =>
        `<TYPE name="${name}" wireColor="${colour}" wireThickness="${width}"/>`,
    )
    .join('');
  const typeNames = new Set(types.map(([name]) => name));
  const removeManagedTypes = (xml) =>
    xml.replace(/<TYPE name="([^"]+)"[^>]*\/>/g, (tag, name) =>
      typeNames.has(name) ? '' : tag,
    );
  const clearStyling = (xml) =>
    removeManagedTypes(xml).replace(/ net_type="[^"]*"/g, '');
  const styled = removeManagedTypes(definition).replace(
    '</NETLIST_TYPES>',
    `${typeXml}</NETLIST_TYPES>`,
  );
  assert.ok(styled.includes(typeXml), `${id}: missing netlist type table`);
  assert.equal(
    clearStyling(styled),
    clearStyling(source),
    `${id}: only wire styling may change`,
  );
  const proof = provenance.examples.find((example) => example.id === id);
  if (proof) {
    proof.layoutSha256 ??= proof.finalSha256;
    assert.equal(
      hash(clearStyling(styled)),
      proof.layoutSha256,
      `${id}: the reviewed layout must be preserved`,
    );
  }
  const validation = renderer.validateTinyCadDrawing(styled);
  assert.ok(
    validation.structurallyValid,
    `${id}: styled drawing must validate`,
  );
  const svg = renderer.renderTinyCadDrawingSvg(styled, 1, 'page');
  for (const [, colour, width] of types) {
    assert.ok(
      svg.includes(`stroke:${colour};stroke-width:${width}`),
      `${id}: missing rendered style ${colour}/${width}`,
    );
  }
  const png = await sharp(Buffer.from(svg))
    .resize({ width: 1024 })
    .png()
    .toBuffer();
  await fs.writeFile(path, styled);
  await fs.writeFile(`${root}/images/${id}.svg`, svg);
  await fs.writeFile(`${root}/images/${id}.png`, png);
  if (proof) {
    proof.finalSha256 = hash(styled);
    proof.previews = { png: hash(png), svg: hash(svg) };
  }
  console.log(
    `${id}: ${wires.length} wire segments styled with ${types.length} netlist types`,
  );
}
await fs.writeFile(provenancePath, JSON.stringify(provenance, null, 2) + '\n');
