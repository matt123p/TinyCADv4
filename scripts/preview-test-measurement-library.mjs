import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { testMeasurementArtwork } from './lib/test-measurement-artwork.mjs';
import { layoutRuntime } from './lib/layout-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { DOMParser, XMLSerializer } = createRequire(import.meta.url)(
  'common-xml-features',
);
const output = path.join(root, 'build/test-measurement');
const { records } = testMeasurementArtwork(
  JSON.parse(
    await readFile(
      path.join(root, 'library-recipes/test-measurement.json'),
      'utf8',
    ),
  ),
);
const api = await layoutRuntime();
await mkdir(output, { recursive: true });
for (const record of records) {
  const component = new DOMParser().parseFromString(record.xml, 'text/xml');
  const children = Array.from(component.documentElement.childNodes).filter(
    (n) => n.nodeType === 1,
  );
  const isResource = (n) => ['FONT', 'STYLE', 'FILL'].includes(n.nodeName);
  const serialise = (n) => new XMLSerializer().serializeToString(n);
  const resources = children.filter(isResource).map(serialise).join('\n');
  const artwork = children
    .filter((n) => !isResource(n))
    .map(serialise)
    .join('\n');
  const drawing = await api.decodeDrawing(
    new TextEncoder().encode(
      `<TinyCADSheets><TinyCAD><NAME>Preview</NAME>${resources}` +
        `<SYMBOLDEF id="1"><NAME type="1">Lab equipment</NAME><GUID>${record.device.id}</GUID><REF type="1">N?</REF><DESCRIPTION>Conductor, cable and hose connection preview</DESCRIPTION><PPP>1</PPP><REF_POINT pos="${record.width},${record.height}" power="0" part="1"/><TinyCAD>${artwork}</TinyCAD></SYMBOLDEF>` +
        `<SYMBOL id="1" pos="${record.width},${record.height}" part="0" rotate="0" show_power="0" can_scale="0" scale_x="1" scale_y="1"><FIELD pos="0,0" value="N1" description="Ref" type="1" show="0"/></SYMBOL></TinyCAD></TinyCADSheets>`,
    ),
  );
  if (
    drawing.sheets[0].items.length !== 1 ||
    !drawing.sheets[0].items[0]._symbol.outlines[0].items.length
  )
    throw new Error(
      'Preview did not load the complete symbol: ' + record.device.id,
    );
  const svg = api.renderCircuit(drawing.sheets[0]);
  const preview = new DOMParser().parseFromString(svg, 'text/xml');
  for (const block of Array.from(preview.getElementsByTagName('svg'))) {
    if (
      block.getAttribute('data-markdown') === 'true' &&
      block.getElementsByTagName('text').length !== 1
    )
      throw new Error(
        `Wrapped or missing equipment label in ${record.device.id}: ${block.textContent}`,
      );
  }
  await writeFile(path.join(output, record.device.id + '.xml'), record.xml);
  await writeFile(path.join(output, record.device.id + '.svg'), svg + '\n');
  const png = await sharp(Buffer.from(svg))
    .resize({ width: 1000 })
    .png()
    .toBuffer();
  await writeFile(path.join(output, record.device.id + '.png'), png);
}
async function gallery(ids, columns, cellWidth, cellHeight, filename, title) {
  const composite = [
    {
      input: Buffer.from(
        `<svg width="${
          columns * cellWidth
        }" height="50"><text x="20" y="32" font-family="Arial" font-size="26" fill="#23343e">${title}</text></svg>`,
      ),
      left: 0,
      top: 0,
    },
  ];
  for (const [i, id] of ids.entries()) {
    const r = records.find((r) => r.device.id === id),
      left = (i % columns) * cellWidth,
      top = 55 + Math.floor(i / columns) * cellHeight;
    const label = r.device.name.replace(
      /[&<>]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]),
    );
    composite.push({
      input: Buffer.from(
        `<svg width="${cellWidth}" height="44"><text x="8" y="18" font-family="Arial" font-size="12" fill="#23343e">${
          label.length > 53 ? label.slice(0, 52) + '…' : label
        }</text></svg>`,
      ),
      left,
      top,
    });
    const png = await sharp(await readFile(path.join(output, id + '.svg')))
      .resize({ width: cellWidth - 40, height: cellHeight - 70, fit: 'inside' })
      .png()
      .toBuffer();
    const size = await sharp(png).metadata();
    composite.push({
      input: png,
      left: left + Math.floor((cellWidth - size.width) / 2),
      top: top + 40 + Math.floor((cellHeight - 70 - size.height) / 2),
    });
  }
  await sharp({
    create: {
      width: columns * cellWidth,
      height: 55 + Math.ceil(ids.length / columns) * cellHeight,
      channels: 3,
      background: 'white',
    },
  })
    .composite(composite)
    .png()
    .toFile(filename);
}

for (const [category, filename] of [
  ['Power and loads', 'lab-power.png'],
  ['Bench instruments', 'lab-instruments.png'],
  ['Acquisition and calibration', 'lab-acquisition.png'],
  ['Probes and sensors', 'lab-probes.png'],
  ['Thermal equipment', 'lab-thermal.png'],
  ['Switching and control', 'lab-control.png'],
  ['Bench apparatus and connections', 'lab-apparatus.png'],
]) {
  const ids = records
    .filter((r) => r.device.category === category)
    .map((r) => r.device.id);
  await gallery(
    ids,
    3,
    460,
    350,
    path.join(root, 'docs', filename),
    'Test &amp; Measurement — ' + category,
  );
}
console.log(`Rendered ${records.length} native lab resources in ${output}`);
