import { applyTeachingModels } from './teaching-models.mjs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { label, makePin, body } from './digital-artwork.mjs';
const { DOMParser, XMLSerializer } = createRequire(import.meta.url)(
  'common-xml-features',
);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const nodes = (doc, tag) => Array.from(doc.getElementsByTagName(tag));
const even = (n) => Math.ceil(n / 2) * 2;

export function drawFunctionalBlock(
  reference,
  requirement,
  recipe,
  title,
  edge,
) {
  const doc = new DOMParser().parseFromString(reference.xml, 'text/xml');
  // Share the actual fonts, stroke and yellow fill used by the digital blocks.
  for (const child of Array.from(doc.documentElement.childNodes))
    if (!['FONT', 'STYLE', 'FILL'].includes(child.nodeName))
      doc.documentElement.removeChild(child);
  const groups = Object.fromEntries(
    ['left', 'right', 'top', 'bottom'].map((side) => [
      side,
      requirement.pins.filter((p) => p.side === side),
    ]),
  );
  const extent = (side) =>
    Math.max(
      0,
      ...groups[side].map(
        (p) => p.name.length * 0.72 + (p.name === 'CLOCK' && edge ? 1.8 : 0.7),
      ),
    );
  const width = even(
    Math.max(
      16,
      2 * Math.max(extent('left'), extent('right')) + title.length * 0.72 + 4,
      ...['top', 'bottom'].map((side) =>
        groups[side].reduce((n, p) => n + p.name.length * 0.72 + 2, 2),
      ),
    ),
  );
  const height = even(
    Math.max(
      8,
      (Math.max(groups.left.length, groups.right.length) - 1) *
        recipe.style.pinPitchMm +
        6,
    ),
  );
  body(doc, 'block', width, height, 0);
  label(doc, [width / 2 - title.length * 0.36, height / 2 + 0.9], title);
  for (const [side, pins] of Object.entries(groups)) {
    const horizontal = side === 'left' || side === 'right';
    pins.forEach((pin, i) => {
      const axis =
        (horizontal ? height : width) / 2 +
        (i - (pins.length - 1) / 2) * recipe.style.pinPitchMm;
      const lead = recipe.style.leadLengthMm;
      const pos =
        side === 'left'
          ? [-lead, axis]
          : side === 'right'
          ? [width + lead, axis]
          : side === 'top'
          ? [axis, -lead]
          : [axis, height + lead];
      const which = pin.name.endsWith('_N')
        ? 1
        : pin.name === 'CLOCK' && edge
        ? edge === 'rising'
          ? 2
          : 3
        : 0;
      makePin(
        doc,
        pin,
        pos,
        { left: 3, right: 2, top: 1, bottom: 0 }[side],
        lead * 5,
        which,
      );
      const labelPos =
        side === 'left'
          ? [which === 2 || which === 3 ? 1.8 : 0.7, axis + 0.9]
          : side === 'right'
          ? [width - 0.7 - pin.name.length * 0.72, axis + 0.9]
          : [axis - pin.name.length * 0.36, side === 'top' ? 2 : height - 0.7];
      label(doc, labelPos, pin.name);
    });
  }
  if (nodes(doc, 'PIN').length !== requirement.pins.length)
    throw Error('Incomplete functional pin contract: ' + requirement.id);
  return { xml: new XMLSerializer().serializeToString(doc), width, height };
}

export async function functionalArtworkSnapshot({
  root,
  digital,
  requirements,
}) {
  const recipe = JSON.parse(
    await readFile(path.join(root, 'library-recipes/functional.json'), 'utf8'),
  );
  if (recipe.version !== 1) throw Error('Unsupported functional recipe.');
  const reference = digital.records.find(
    (r) => r.candidate.id === recipe.style.reference,
  );
  if (!reference) throw Error('Missing functional style reference.');
  const targets = requirements.filter((r) => r.folder.startsWith('09 '));
  if (
    targets.length !== Object.keys(recipe.blocks).length ||
    targets.some((r) => !recipe.blocks[r.id])
  )
    throw Error('Functional recipe does not cover the inventory.');
  const descriptors = targets.map((r) => ({
    r,
    edge: recipe.clockedSymbols.includes(r.id) ? 'rising' : null,
  }));
  descriptors.push(
    ...targets
      .filter((r) => recipe.clockedSymbols.includes(r.id))
      .map((r) => ({ r, edge: 'falling' })),
  );
  const records = descriptors.map(({ r, edge }, i) => {
    const built = drawFunctionalBlock(
      reference,
      r,
      recipe,
      recipe.blocks[r.id],
      edge,
    );
    const name = r.name + (edge ? ' (' + edge + ' edge)' : '');
    const candidate = {
      id: 'derived:' + r.id + (edge === 'falling' ? '-falling' : ''),
      kind: 'derived',
      family: 'functional',
      canonicalId: r.id,
      baseCandidateId: reference.candidate.id,
      baseXmlSha256: reference.candidate.xmlSha256,
      recipePath: 'library-recipes/functional.json',
      bundleNameId: i + 1,
      bundlePath: recipe.output,
      derivedDefinition: {
        id: r.id,
        pins: r.pins.map((p) => p.logical_number),
      },
      ...(edge ? { clockEdge: edge } : {}),
      names: [
        {
          nameId: i + 1,
          name,
          description: r.drawing_description,
          author: 'TinyCAD',
        },
      ],
      xmlSha256: hash(built.xml),
      bodyWidthMm: built.width,
      bodyHeightMm: built.height,
      derivationNote:
        'Built in the selected NAND-derived digital block style. Visible power/reference terminals retain their inventory names. Generic diagram-only interface; simulation and physical implementation are separate.',
    };
    return { candidate, xml: built.xml, requirement: r };
  });
  const provenance = {
    version: 1,
    id: recipe.id,
    name: recipe.name,
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
    provenance,
    library,
    fingerprint: hash(JSON.stringify(provenance)),
  };
}
