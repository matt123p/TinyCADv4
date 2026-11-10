import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { librarySqlite } from './library-from-sql.mjs';
import { deriveSymbol } from './symbol-artwork.mjs';
const { DOMParser } = createRequire(import.meta.url)('common-xml-features');
export const digest = (value) =>
  createHash('sha256').update(value).digest('hex');
const nodes = (node, tag) => Array.from(node.getElementsByTagName(tag));
const xy = (value) =>
  String(value || '')
    .split(',')
    .map(Number);
const median = (values) =>
  values.length
    ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
    : 0;
export function geometry(xml) {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (!['TinyCAD', 'TinyCADSheets'].includes(doc.documentElement?.nodeName))
      throw new Error('Unsupported XML root');
    const sheets =
      doc.documentElement.nodeName === 'TinyCAD'
        ? [doc.documentElement]
        : nodes(doc, 'TinyCAD');
    const pins = sheets.flatMap((sheet, sheetIndex) =>
      nodes(sheet, 'PIN').map((pin) => ({
        key: `${sheetIndex}:${
          pin.getAttribute('part') || '0'
        }:${pin.getAttribute('number')}`,
        sheet: sheetIndex,
        part: Number(pin.getAttribute('part') || 0),
        number: pin.getAttribute('number') || '',
        name: pin.textContent || '',
        x: xy(pin.getAttribute('pos'))[0],
        y: xy(pin.getAttribute('pos'))[1],
        lengthMm: Number(pin.getAttribute('length')) / 5,
        hidden: [4, 5].includes(Number(pin.getAttribute('which'))),
        electrical: pin.getAttribute('elec'),
      })),
    );
    if (pins.some((p) => ![p.x, p.y, p.lengthMm].every(Number.isFinite)))
      throw new Error('Invalid pin coordinates');
    const points = [];
    const body = [];
    const add = (p, target) => {
      if (p.length === 2 && p.every(Number.isFinite)) target.push(p);
    };
    for (const tag of ['RECTANGLE', 'ELLIPSE'])
      for (const node of nodes(doc, tag)) {
        add(xy(node.getAttribute('a')), body);
        add(xy(node.getAttribute('b')), body);
      }
    for (const polygon of nodes(doc, 'POLYGON')) {
      const origin = xy(polygon.getAttribute('pos'));
      for (const point of nodes(polygon, 'POINT'))
        add(
          xy(point.getAttribute('pos')).map((v, i) => v + origin[i]),
          body,
        );
    }
    points.push(...body, ...pins.map((p) => [p.x, p.y]));
    const bounds = (values) =>
      values.length
        ? {
            x1: Math.min(...values.map((p) => p[0])),
            y1: Math.min(...values.map((p) => p[1])),
            x2: Math.max(...values.map((p) => p[0])),
            y2: Math.max(...values.map((p) => p[1])),
          }
        : { x1: 0, y1: 0, x2: 0, y2: 0 };
    const bb = bounds(body),
      all = bounds(points);
    const first = pins[0];
    return {
      valid: true,
      pins,
      pinCount: pins.length,
      duplicatePins: new Set(pins.map((p) => p.key)).size !== pins.length,
      relativeGrid: pins.every((p) =>
        [p.x - first.x, p.y - first.y].every(
          (v) => Math.abs(v - Math.round(v)) < 1e-6,
        ),
      ),
      absoluteGrid: pins.every((p) =>
        [p.x, p.y].every((v) => Math.abs(v - Math.round(v)) < 1e-6),
      ),
      leadMm: median(pins.map((p) => p.lengthMm)),
      bodyWidthMm: bb.x2 - bb.x1,
      bodyHeightMm: bb.y2 - bb.y1,
      bodyBounds: bb,
      bounds: all,
      lineWidth: median(
        nodes(doc, 'STYLE')
          .map((n) =>
            Number(n.getElementsByTagName('THICKNESS')[0]?.textContent),
          )
          .filter(Number.isFinite),
      ),
      raster: nodes(doc, 'IMAGE').length > 0,
      sheets: sheets.length,
      parts: new Set(pins.map((p) => `${p.sheet}:${p.part}`)).size,
    };
  } catch (error) {
    return { valid: false, error: error.message, pins: [], pinCount: 0 };
  }
}

export async function spiceArtworkSnapshot(spiceBytes, provenance) {
  const records = [];
  const SQL = await librarySqlite(),
    db = new SQL.Database(new Uint8Array(spiceBytes));
  try {
    for (const entry of provenance.entries) {
      const rows = db.exec(
        `SELECT Symbol.Data,Name.Name,Name.ppp,Name.DefRotate,Name.Reference FROM Name JOIN Symbol USING(SymbolID) WHERE Name.NameID=${Number(
          entry.nameId,
        )}`,
      )[0];
      if (!rows?.values.length)
        throw new Error('Missing SPICE artwork ' + entry.id);
      const xml = new TextDecoder().decode(rows.values[0][0]),
        id = `spice:${entry.id}`;
      const candidate = {
        id,
        kind: 'spice',
        recipeId: entry.id,
        bundleNameId: entry.nameId,
        ...(['resistor', 'potentiometer', 'trimmer-resistor'].includes(entry.id)
          ? { resistorStyle: 'eu' }
          : entry.id.endsWith('-us')
          ? { resistorStyle: 'us' }
          : {}),
        bundleIdentity: rows.values[0].slice(1),
        names: [
          {
            nameId: entry.nameId,
            name: rows.values[0][1],
            description: entry.notes || entry.source.description,
            author: entry.source.author,
          },
        ],
        metrics: geometry(xml),
        xmlSha256: digest(xml),
      };
      records.push({ candidate, xml });
    }
  } finally {
    db.close();
  }
  const fingerprint = digest(
    JSON.stringify(
      records
        .map(({ candidate: c }) => [
          c.id,
          c.bundleNameId,
          c.bundleIdentity,
          c.xmlSha256,
        ])
        .sort((a, b) => a[0].localeCompare(b[0])),
    ),
  );
  return { records, fingerprint };
}

export function derivedArtworkSnapshot(spice, recipe) {
  if (recipe.version !== 1 || !Array.isArray(recipe.symbols))
    throw new Error('Invalid derived-artwork recipe.');
  const records = [];
  for (const definition of recipe.symbols)
    for (const style of definition.styles || [null]) {
      const baseId = 'spice:' + definition.base + (style === 'us' ? '-us' : '');
      const base = spice.records.find((r) => r.candidate.id === baseId);
      if (!base) throw new Error('Missing corrected SPICE base ' + baseId);
      const xml = deriveSymbol(base.xml, definition.id),
        id = 'derived:' + definition.id + (style ? '-' + style : '');
      const candidate = {
        id,
        kind: 'derived',
        canonicalId: definition.id,
        baseCandidateId: baseId,
        baseXmlSha256: base.candidate.xmlSha256,
        derivedDefinition: definition,
        ...(style ? { resistorStyle: style } : {}),
        names: [
          {
            nameId: base.candidate.bundleNameId,
            name:
              definition.name + (style ? ' (' + style.toUpperCase() + ')' : ''),
            description:
              'Built from corrected SPICE ' +
              base.candidate.names[0].name +
              '; additions and model adapters are recorded separately.',
            author: 'TinyCAD / onetransistor base',
          },
        ],
        metrics: geometry(xml),
        xmlSha256: digest(xml),
      };
      if (
        !candidate.metrics.valid ||
        !candidate.metrics.absoluteGrid ||
        candidate.metrics.duplicatePins ||
        candidate.metrics.pinCount !== definition.pins.length
      )
        throw new Error('Invalid derived terminals: ' + id);
      records.push({ candidate, xml });
    }
  return {
    records,
    fingerprint: digest(
      JSON.stringify(
        records.map((r) => [
          r.candidate.id,
          r.candidate.xmlSha256,
          r.candidate.baseXmlSha256,
          r.candidate.derivedDefinition,
        ]),
      ),
    ),
  };
}
