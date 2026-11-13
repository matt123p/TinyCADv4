import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { networkArtwork } from './lib/network-artwork.mjs';
import { layoutRuntime } from './lib/layout-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { DOMParser, XMLSerializer } = createRequire(import.meta.url)(
  'common-xml-features',
);
const output = path.join(root, 'build/network-layout');
const { records } = networkArtwork(
  JSON.parse(
    await readFile(
      path.join(root, 'library-recipes/network-layout.json'),
      'utf8',
    ),
  ),
);
const api = await layoutRuntime();
await mkdir(output, { recursive: true });
const thumbnails = [];
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
        `<SYMBOLDEF id="1"><NAME type="1">Network device</NAME><GUID>${record.device.id}</GUID><REF type="1">N?</REF><DESCRIPTION>Network layout preview</DESCRIPTION><PPP>1</PPP><REF_POINT pos="${record.width},${record.height}" power="0" part="1"/><TinyCAD>${artwork}</TinyCAD></SYMBOLDEF>` +
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
  await writeFile(path.join(output, record.device.id + '.xml'), record.xml);
  await writeFile(path.join(output, record.device.id + '.svg'), svg + '\n');
  const png = await sharp(Buffer.from(svg))
    .resize({ width: 1000 })
    .png()
    .toBuffer();
  await writeFile(path.join(output, record.device.id + '.png'), png);
  const label = Buffer.from(
    `<svg width="1040" height="28"><text x="12" y="20" font-family="Arial" font-size="15" fill="#293542">${record.device.name.replace(
      /&/g,
      '&amp;',
    )}</text></svg>`,
  );
  const thumb = await sharp(png)
    .resize({ width: 1000, height: 220, fit: 'inside' })
    .png()
    .toBuffer();
  const size = await sharp(thumb).metadata();
  thumbnails.push({
    input: label,
    left: 0,
    top: (thumbnails.length / 2) * 260,
  });
  thumbnails.push({
    input: thumb,
    left: 20,
    top:
      ((thumbnails.length - 1) / 2) * 260 +
      30 +
      Math.floor((220 - size.height) / 2),
  });
}
await sharp({
  create: {
    width: 1040,
    height: records.length * 260,
    channels: 3,
    background: 'white',
  },
})
  .composite(thumbnails)
  .png()
  .toFile(path.join(output, 'overview.png'));

// Compact documentation preview: real rack faces at identical scale, then
// consumer rear/underside panels. The full gallery above includes every entry.
const featured = [
  'rack-router-10-2sfp',
  'rack-switch-16-2sfp',
  'rack-switch-24-4sfp',
  'rack-switch-32-4sfp',
  'rack-switch-48-4sfp',
  'patch-panel-24',
  'patch-panel-48',
  'rack-blank',
  'desktop-switch-5',
  'desktop-switch-4-2sfp',
  'wifi-router-4',
  'ap-ceiling-2',
  'ap-wall-4',
  'mesh-node-2',
];
const parts = [];
let y = 38;
for (const id of featured) {
  const record = records.find((r) => r.device.id === id);
  parts.push({
    input: Buffer.from(
      `<svg width="1040" height="25"><text x="20" y="18" font-family="Arial" font-size="14" fill="#293542">${record.device.name}</text></svg>`,
    ),
    left: 0,
    top: y,
  });
  const image = await sharp(await readFile(path.join(output, id + '.svg')))
    .resize({
      width: record.device.rack ? 1000 : 460,
      height: record.device.rack ? 106 : 190,
      fit: 'inside',
    })
    .png()
    .toBuffer();
  parts.push({ input: image, left: 20, top: y + 25 });
  y += (await sharp(image).metadata()).height + 45;
}
parts.unshift({
  input: Buffer.from(
    '<svg width="1040" height="36"><text x="20" y="26" font-family="Arial" font-size="23" font-weight="bold" fill="#293542">Network layout — physical device symbols</text></svg>',
  ),
  left: 0,
  top: 0,
});
await sharp({
  create: { width: 1040, height: y, channels: 3, background: 'white' },
})
  .composite(parts)
  .png()
  .toFile(path.join(root, 'docs/network-layout.png'));
console.log(
  `Rendered ${records.length} native symbols in ${output}; updated docs/network-layout.png`,
);
