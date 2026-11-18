import { applyTeachingModels } from './teaching-models.mjs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const { DOMParser, XMLSerializer } = createRequire(import.meta.url)(
  'common-xml-features',
);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const nodes = (root, tag) => Array.from(root.getElementsByTagName(tag));
const xy = (node, attr = 'pos') =>
  node.getAttribute(attr).split(',').map(Number);
const coord = (values) => values.map((n) => Number(n.toFixed(7))).join(',');
export function element(doc, tag, attributes = {}, text) {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(attributes))
    node.setAttribute(key, Array.isArray(value) ? coord(value) : String(value));
  if (text !== undefined) node.appendChild(doc.createTextNode(String(text)));
  return node;
}
export function resource(doc, tag, id, values) {
  const node = element(doc, tag, { id });
  for (const [key, value] of Object.entries(values))
    node.appendChild(element(doc, key, {}, value));
  doc.documentElement.appendChild(node);
  return node;
}
function poly(doc, points, { fill = 0, extra = false } = {}) {
  const node = element(doc, 'POLYGON', {
    pos: [0, 0],
    style: 3,
    fill,
    polygon: fill ? 1 : 0,
  });
  for (const point of points) {
    const p = Array.isArray(point) ? { pos: point } : point;
    node.appendChild(element(doc, 'POINT', { arc: 0, ...p }));
  }
  doc.documentElement.appendChild(node);
  return node;
}
export function label(doc, position, text) {
  doc.documentElement.appendChild(
    element(
      doc,
      'TEXT',
      { pos: position, direction: 3, font: 2, color: '000000' },
      text,
    ),
  );
}
export function makePin(
  doc,
  logical,
  position,
  direction,
  length,
  which = 0,
  name = logical.name,
) {
  doc.documentElement.appendChild(
    element(
      doc,
      'PIN',
      {
        pos: position,
        direction,
        length,
        number: logical.logical_number,
        which,
        elec:
          logical.electrical_type === 'power_input'
            ? 10
            : logical.electrical_type === 'output'
            ? 1
            : logical.electrical_type === 'bidirectional'
            ? 5
            : logical.electrical_type === 'passive'
            ? 4
            : 0,
        part: 0,
        show: which === 4 ? 1 : 0,
        number_pos: 0,
        centre_name: 0,
      },
      name,
    ),
  );
}
export function body(doc, shape, width, height, neck) {
  if (shape === 'and') {
    poly(
      doc,
      [
        [0, 0],
        [neck, 0],
        { pos: [width, height / 2], arc: 1 },
        { pos: [neck, height], arc: 2 },
        [0, height],
        [0, 0],
      ],
      { fill: 1 },
    );
  } else if (shape === 'buffer')
    poly(
      doc,
      [
        [0, 0],
        [width, height / 2],
        [0, height],
        [0, 0],
      ],
      { fill: 1 },
    );
  else if (shape === 'or' || shape === 'xor') {
    poly(
      doc,
      [
        [0, 0],
        {
          pos: [width, height / 2],
          control: [width * 0.5, 0],
          control2: [width * 0.8, height * 0.15],
        },
        {
          pos: [0, height],
          control: [width * 0.8, height * 0.85],
          control2: [width * 0.5, height],
        },
        { pos: [0, 0], control: [height / 3, height / 2] },
      ],
      { fill: 1 },
    );
    if (shape === 'xor')
      poly(doc, [
        [-0.8, 0],
        { pos: [-0.8, height], control: [height / 3 - 0.8, height / 2] },
      ]);
  } else
    poly(
      doc,
      [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
        [0, 0],
      ],
      { fill: 1 },
    );
}
function buildSymbol(template, requirement, recipe, standard, edge) {
  const doc = new DOMParser().parseFromString(template, 'text/xml');
  for (const child of Array.from(doc.documentElement.childNodes))
    doc.documentElement.removeChild(child);
  resource(doc, 'FONT', 1, {
    HEIGHT: -10,
    WIDTH: 0,
    WEIGHT: 400,
    ITALIC: 0,
    UNDERLINE: 0,
    STRIKEOUT: 0,
    CHARSET: 0,
    FACENAME: 'Arial',
  });
  resource(doc, 'FONT', 2, {
    HEIGHT: -7,
    WIDTH: 0,
    WEIGHT: 400,
    ITALIC: 0,
    UNDERLINE: 0,
    STRIKEOUT: 0,
    CHARSET: 0,
    FACENAME: 'Arial',
  });
  resource(doc, 'STYLE', 3, {
    STYLE: 0,
    COLOR: '000000',
    THICKNESS: standard.lineWidth,
  });
  resource(doc, 'FILL', 0, { INDEX: -1, COLOR: '000000' });
  resource(doc, 'FILL', 1, { INDEX: 0, COLOR: standard.fill });
  const gate = recipe.gateFunctions[requirement.id];
  const left = requirement.pins.filter((p) => p.side === 'left'),
    right = requirement.pins.filter((p) => p.side === 'right');
  const pitch = recipe.style.blockPinPitchMm;
  const width = gate ? standard.width : standard.width * 2;
  const height = gate
    ? standard.height
    : Math.max(
        standard.height,
        (Math.max(left.length, right.length) - 1) * pitch + 4,
      );
  const neck = standard.width * standard.neckRatio;
  body(doc, gate?.shape || 'block', width, height, neck);
  if (!gate) {
    const title = recipe.blocks[requirement.id];
    label(doc, [width / 2 - title.length * 0.35, height / 2 + 0.9], title);
  }
  const lengths = recipe.style.leadLengthMm * 5;
  for (const side of ['left', 'right']) {
    const pins = side === 'left' ? left : right;
    const locations = gate
      ? pins.length === 1
        ? [height / 2]
        : [height / 4, (height * 3) / 4]
      : pins.map((p, i) => height / 2 + (i - (pins.length - 1) / 2) * pitch);
    pins.forEach((pin, i) => {
      const y = locations[i];
      let which = 0;
      if (pin.name === 'CLK' && edge) which = edge === 'falling' ? 3 : 2;
      else if (pin.name.endsWith('_N') || (side === 'right' && gate?.inverted))
        which = 1;
      makePin(
        doc,
        pin,
        [
          side === 'left'
            ? -recipe.style.leadLengthMm
            : width + recipe.style.leadLengthMm,
          y,
        ],
        side === 'left' ? 3 : 2,
        lengths,
        which,
      );
      if (side === 'left' && ['or', 'xor'].includes(gate?.shape))
        poly(doc, [
          [0, y],
          [height / 8, y],
        ]);
      const start =
        side === 'left'
          ? which === 2 || which === 3
            ? 1.8
            : gate && ['or', 'xor'].includes(gate.shape)
            ? 1.6
            : 0.7
          : width - 0.7 - pin.name.length * 0.72;
      label(doc, [start, y + 0.9], pin.name);
    });
  }
  const supplies = requirement.pins.filter(
    (p) => p.electrical_type === 'power_input',
  );
  if (supplies.length !== 2)
    throw Error('Digital symbol needs both power terminals: ' + requirement.id);
  for (const supply of supplies) {
    const positive = supply.side === 'top';
    makePin(
      doc,
      supply,
      [width / 2, positive ? -2 : height + 2],
      positive ? 1 : 0,
      10,
      4,
      positive ? recipe.style.positiveRail : recipe.style.negativeRail,
    );
  }
  return { xml: new XMLSerializer().serializeToString(doc), width, height };
}
export async function digitalArtworkSnapshot({ root, spice, requirements }) {
  const recipe = JSON.parse(
    await readFile(path.join(root, 'library-recipes/digital.json'), 'utf8'),
  );
  if (recipe.version !== 1) throw Error('Unsupported digital-artwork recipe.');
  const template = await readFile(
    path.join(root, recipe.reference.path),
    'utf8',
  );
  if (hash(template) !== recipe.reference.sha256)
    throw Error(
      'The selected NAND reference changed. Reconcile its source fingerprint first.',
    );
  const parsed = new DOMParser().parseFromString(template, 'text/xml');
  for (const number of Object.values(recipe.reference.sourcePinMap))
    if (
      nodes(parsed, 'PIN').filter((p) => p.getAttribute('number') === number)
        .length !== 1
    )
      throw Error('Ambiguous NAND reference pin ' + number);
  const reference = spice.records.find(
    (r) => r.candidate.id === recipe.style.reference,
  );
  if (!reference)
    throw Error('Missing digital style reference ' + recipe.style.reference);
  const referenceDoc = new DOMParser().parseFromString(
      reference.xml,
      'text/xml',
    ),
    triangle = nodes(referenceDoc, 'POLYGON').find(
      (p) => p.getAttribute('fill') !== '0',
    );
  const fill = nodes(referenceDoc, 'FILL')
    .find((f) => f.getAttribute('id') === triangle.getAttribute('fill'))
    .getElementsByTagName('COLOR')[0].textContent;
  const sourcePoints = nodes(parsed, 'POLYGON').flatMap((poly) =>
    nodes(poly, 'POINT').map((p) => xy(p).map((v, i) => v + xy(poly)[i])),
  );
  const minX = Math.min(...sourcePoints.map((p) => p[0])),
    maxX = Math.max(...sourcePoints.map((p) => p[0]));
  const top = nodes(parsed, 'POLYGON').find((p) => {
    const pts = nodes(p, 'POINT');
    return pts.length === 2 && xy(pts[0])[1] === 0 && xy(pts[1])[1] === 0;
  });
  const topPoints = nodes(top, 'POINT').map((p) => xy(p));
  const standard = {
    width: reference.candidate.metrics.bodyWidthMm,
    height: reference.candidate.metrics.bodyHeightMm,
    fill,
    lineWidth: 1,
    neckRatio: Math.abs(topPoints[0][0] - topPoints[1][0]) / (maxX - minX),
  };
  const targets = requirements.filter((r) => r.folder.startsWith('08 '));
  if (targets.some((r) => !recipe.gateFunctions[r.id] && !recipe.blocks[r.id]))
    throw Error('Missing digital symbol recipe.');
  const ordered = [...targets].sort(
    (a, b) => Number(b.id === 'gate_nand') - Number(a.id === 'gate_nand'),
  );
  const descriptors = ordered.map((r) => ({
    r,
    edge: recipe.clockedSymbols.includes(r.id) ? 'rising' : null,
  }));
  descriptors.push(
    ...ordered
      .filter((r) => recipe.clockedSymbols.includes(r.id))
      .map((r) => ({ r, edge: 'falling' })),
  );
  const records = [];
  for (const { r, edge } of descriptors) {
    const id = 'derived:' + r.id + (edge === 'falling' ? '-falling' : ''),
      name = r.name + (edge ? ' (' + edge + ' edge)' : '');
    const description = recipe.descriptions[r.id];
    if (!description) throw new Error(`Missing digital description for ${r.id}`);
    const built = buildSymbol(template, r, recipe, standard, edge);
    const candidate = {
      id,
      kind: 'derived',
      family: 'digital',
      canonicalId: r.id,
      baseCandidateId: 'sql:' + recipe.reference.source.symbolId,
      baseXmlSha256: recipe.reference.sha256,
      recipePath: 'library-recipes/digital.json',
      bundleNameId: records.length + 1,
      bundlePath: recipe.output,
      derivedDefinition: {
        id: r.id,
        pins: r.pins.map((p) => p.logical_number),
      },
      ...(edge ? { clockEdge: edge } : {}),
      names: [
        {
          nameId: records.length + 1,
          name,
          description: description.replaceAll('{edge}', edge || ''),
          author: recipe.reference.source.author,
        },
      ],
      xmlSha256: hash(built.xml),
      bodyWidthMm: built.width,
      bodyHeightMm: built.height,
      derivationNote:
        'Adapted from your selected NAND reference: one logical unit, 741-sized yellow gate bodies, native VCC/VSS power pins. ' +
        (edge
          ? 'Rising and falling edges use native Clock and DotClock pin shapes. '
          : '') +
        'Simulation adapters remain separate.',
    };
    records.push({ candidate, xml: built.xml, requirement: r });
  }
  const provenance = {
    version: 1,
    id: recipe.id,
    name: recipe.name,
    source: recipe.reference,
    styleReference: {
      id: reference.candidate.id,
      xmlSha256: reference.candidate.xmlSha256,
    },
    recipeSha256: hash(JSON.stringify(recipe)),
    notes: recipe.notes,
    entries: records.map(({ candidate: c }) => ({
      id: c.id.slice(8),
      canonicalId: c.canonicalId,
      name: c.names[0].name,
      nameId: c.bundleNameId,
      symbolId: c.bundleNameId,
      xmlSha256: c.xmlSha256,
      clockEdge: c.clockEdge || null,
    })),
  };
  const library = {
    name: recipe.name,
    names: records.map(({ candidate: c, requirement: r }) => ({
      NameID: c.bundleNameId,
      Name: c.names[0].name,
      SymbolID: c.bundleNameId,
      Type: 0,
      Reference: r.reference_prefix + '?',
      ppp: 1,
      Description: c.names[0].description,
      ShowName: 1,
      ShowRef: 0,
      DefRotate: 0,
      Attributes: [{ AttName: 'Package', AttValue: '', ShowAtt: 1 }],
    })),
    symbols: records.map(({ candidate: c, xml }) => ({
      SymbolId: c.bundleNameId,
      Data: xml,
    })),
  };
  applyTeachingModels(library, records);
  provenance.simulation = {
    backend: 'spice',
    modelSha256: hash(JSON.stringify(library.names.map((n) => n.Attributes))),
  };
  return {
    records,
    recipe,
    library,
    provenance,
    fingerprint: hash(
      JSON.stringify([provenance, records.map((r) => r.candidate.xmlSha256)]),
    ),
  };
}
