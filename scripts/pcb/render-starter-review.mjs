import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

const [output, draftPath, reviewedPath] = process.argv.slice(2);
if (!output)
  throw new Error(
    'Provide an HTML output path and optionally the draft and reviewed bundle paths.',
  );

const [drafts, reviewed, api] = await Promise.all([
  readFile(
    draftPath ??
      new URL('../../bundled-footprints/starter-v1.json.gz', import.meta.url),
  ).then((data) => JSON.parse(gunzipSync(data))),
  readFile(
    reviewedPath ??
      new URL('../../bundled-footprints/reviewed-v1.json', import.meta.url),
    'utf8',
  ).then(JSON.parse),
  layoutRuntime(),
]);
if (drafts.version !== 1 || !Array.isArray(drafts.variants))
  throw new Error('Unsupported starter catalogue.');
const reviewedDevices = await api.readLibraryDeviceCatalogue(reviewed);

const encoder = new TextEncoder();
const mm = (nm) => nm / 1_000_000;
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (letter) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[letter]),
  );
const link = (url, text) => {
  const target = new URL(url);
  if (target.protocol !== 'https:')
    throw new Error('Expected an HTTPS source for ' + text);
  return `<a href="${escape(target.href)}">${escape(text)}</a>`;
};

const devices = new Map();
const revisions = new Set(
  drafts.variants.map(({ footprint }) => footprint.definition.definitionDigest),
);
for (const { definition } of reviewedDevices) {
  const digest = definition.footprint.definitionDigest;
  if (!revisions.has(digest))
    throw new Error(
      `Reviewed device ${definition.name} does not match a bundled footprint revision.`,
    );
  const existing = devices.get(digest) ?? [];
  devices.set(digest, [...existing, definition]);
}

const cards = [];
for (const entry of drafts.variants) {
  const { definition, provenance } = await api.decodeFootprintLibrary(
    encoder.encode(JSON.stringify(entry.footprint)),
  );
  const approved = devices.get(definition.definitionDigest) ?? [];
  const { documentation } = entry;
  const sources = documentation
    ? `<p>${escape(documentation.sourceRevision)} · ${link(
        documentation.package,
        'Package drawing',
      )}${
        documentation.pinout !== documentation.package
          ? ' · ' + link(documentation.pinout, 'Pinout')
          : ''
      }</p>`
    : '<p>Use the named geometry assumptions to choose representative parts for the fit and pin-mapping review.</p>';
  const pins = documentation
    ? `<table><caption>Source-based pad assignments</caption>
      <thead><tr><th scope="col">Pad</th><th scope="col">Terminal</th><th scope="col">X, Y (mm)</th></tr></thead>
      <tbody>${definition.pads
        .map(
          ({ label, positionNm }) => `
        <tr><td>${escape(label)}</td><td>${escape(
            documentation.pinoutByPad[label],
          )}</td>
        <td>${mm(positionNm.x)}, ${mm(positionNm.y)}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '';
  cards.push(`<article id="${escape(entry.id)}">
    <h2>${escape(definition.name)}</h2>
    <p class="status">${
      approved.length
        ? approved
            .map(
              ({ name, review }) =>
                `Reviewed device ${escape(name)} · ${escape(review.by)}`,
            )
            .join('<br>')
        : 'Human review pending'
    }</p>
    <p>${escape(provenance.source)} · footprint revision ${escape(
    definition.revision,
  )}</p>
    <p>${[
      entry.bodyNm.map(mm).join(' × ') + ' mm body',
      definition.pads.length + ' pads',
      ...(entry.pitchNm ? [mm(entry.pitchNm) + ' mm pitch'] : []),
      ...(entry.rowSpacingNm
        ? [mm(entry.rowSpacingNm) + ' mm row spacing']
        : []),
    ].join(' · ')}</p>
    <p>${escape(entry.assemblyProcess)}</p>
    ${sources}
    <div class="review-layout">
      <figure class="drawing">${api.renderFootprintAtActualSize(
        definition,
      )}<figcaption>1:1 pad view · 10 mm calibration bar</figcaption></figure>
      ${pins}
    </div>
    <p class="digest">Geometry digest <code>${escape(
      definition.definitionDigest,
    )}</code></p>
  </article>`);
}

await writeFile(
  output,
  `<!doctype html><html lang="en"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TinyCAD starter footprint review</title>
  <style>
    body { font: 15px/1.45 system-ui, sans-serif; max-width: 55rem; margin: 2rem auto; padding: 0 1rem; color: #19242d; }
    h1, h2 { line-height: 1.2; }
    nav ul { columns: auto 15rem; padding-left: 1.25rem; }
    article { border-top: 1px solid #bcc8d3; margin-top: 1.5rem; padding-top: .6rem; break-inside: avoid; }
    .status { font-weight: 600; }
    .review-layout { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 1.5rem; }
    .drawing { margin: 0; max-width: 100%; overflow-x: auto; }
    figcaption { font-size: .85em; }
    table { border-collapse: collapse; font-variant-numeric: tabular-nums; }
    caption { text-align: left; font-weight: 600; }
    th, td { border-bottom: 1px solid #d3dae1; text-align: left; padding: .2rem .7rem; }
    .digest { font-size: .8em; overflow-wrap: anywhere; }
    @media print { body { margin: 0; max-width: none; } nav { display: none; } }
  </style></head><body>
  <h1>TinyCAD starter footprint review</h1>
  <p>${cards.length} footprint revisions · ${
    reviewedDevices.length
  } reviewed device records</p>
  <p>Print at 100% and measure the 10 mm ruler before checking component fit. Compare the dimensions, datum, polarity and pin mapping against the named part and package drawing, then record the review in TinyCAD's footprint editor.</p>
  <nav aria-label="Footprints"><ul>${drafts.variants
    .map(
      ({ id, footprint }) =>
        `<li><a href="#${escape(id)}">${escape(
          footprint.definition.name,
        )}</a></li>`,
    )
    .join('')}</ul></nav>
  ${cards.join('\n')}
</body></html>\n`,
  'utf8',
);
console.log(`Wrote ${cards.length} footprint review sheets to ${output}.`);
