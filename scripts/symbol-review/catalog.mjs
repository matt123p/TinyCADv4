import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { readComponentDump, componentInventory } from '../lib/mysql-dump.mjs';
import { librarySqlite } from '../lib/library-from-sql.mjs';
import { deriveSymbol } from '../lib/symbol-artwork.mjs';
import { digitalArtworkSnapshot } from '../lib/digital-artwork.mjs';
import { functionalArtworkSnapshot } from '../lib/functional-artwork.mjs';
import { sensorArtworkSnapshot } from '../lib/sensor-artwork.mjs';
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
export const normalize = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Explicit equivalences only. The review queue remains deduplicated by canonical ID.
export const REUSE = {
  resistor: ['resistor', ['1', '2']],
  capacitor: ['capacitor', ['1', '2']],
  capacitor_plates: ['capacitor', ['1', '2']],
  capacitor_polarised: ['electrolytic-capacitor', ['1', '2']],
  capacitor_variable: ['trimmer-capacitor', ['1', '2']],
  inductor: ['inductor', ['1', '2']],
  potentiometer: ['potentiometer', ['1', '3', '2']],
  diode: ['diode', ['1', '2']],
  diode_rectifier: ['diode', ['1', '2']],
  led: ['led-red', ['1', '2']],
  zener: ['zener', ['1', '2']],
  bjt_npn: ['npn', ['1', '3', '2']],
  bjt_pnp: ['pnp', ['1', '3', '2']],
  mosfet_n: ['nmos', ['2', '3', '4']],
  mosfet_p: ['pmos', ['2', '3', '4']],
  opamp: ['ua741', ['3', '2', '6', '7', '4']],
  comparator: ['ua741', ['3', '2', '6', '7', '4']],
  behavioural_voltage: ['voltage-source', ['1', '2']],
  behavioural_current: ['current-source', ['1', '2']],
};
const ARTWORK_ONLY = {
  comparator:
    'Reuse the triangle and five terminals only. Replace the 741 model with a comparator adapter and declare its output type.',
  behavioural_current:
    'Reuse the current-arrow artwork only. Replace the independent I-source template with the required expression-controlled source adapter.',
  behavioural_voltage:
    'Reuse the voltage-source artwork only. Replace the independent V-source template with the required expression-controlled source adapter.',
};
const NATIVE = {
  wire: 'wire',
  junction: 'junction',
  ground: 'ground',
  net_label: 'net-label',
  no_connect: 'no-connect',
  annotation: 'text-and-shapes',
};
const HINTS = {
  rheostat: [
    'variable resistor',
    'rheostat',
    'resistor trimmer',
    'resistor pot',
    'trimmer resistor',
    'potentiometer',
  ],
  resistance_wire: ['resistor', 'wire'],
  capacitor_plates: ['capacitor'],
  photodiode: ['photodiode', 'photo diode'],
  darlington_npn: ['darlington', 'npn darlington', 'tip120', 'uln2003'],
  darlington_pnp: ['darlington', 'pnp darlington', 'tip125'],
  jfet_n: ['njfet', 'jfet', 'n channel jfet'],
  jfet_p: ['pjfet', 'jfet', 'p channel jfet'],
  thyristor: ['scr', 'thyristor'],
  ntc: ['thermistor', 'ntc'],
  ldr: ['ldr', 'photoresistor', 'light dependent resistor'],
  switch_spst: ['spst', 'single pole switch'],
  switch_spdt: ['spdt', 'changeover switch'],
  push_make: ['pushbutton', 'push button', 'push to make', 'normally open'],
  push_break: ['push to break', 'normally closed'],
  relay_spdt: ['relay'],
  relay_coil: ['relay', 'coil'],
  reed_switch: ['reed'],
  timer_555: ['555', 'ne555', 'lm555'],
  lamp: ['lamp', 'bulb'],
  source_sine: ['sine', 'sinusoidal', 'ac voltage', 'voltage source'],
  source_pulse: ['pulse', 'square wave', 'voltage source'],
  source_fm: ['fm', 'voltage source'],
  source_pwl: ['pwl', 'piecewise', 'voltage source'],
  behavioural_current: ['current source', 'behavioral', 'behavioural'],
  behavioural_voltage: ['voltage source', 'behavioral', 'behavioural'],
  vcvs: ['vcvs', 'voltage controlled voltage'],
  controlled_switch: [
    'voltage controlled switch',
    'analog switch',
    'analogue switch',
  ],
  comparator: ['comparator', 'lm311', 'lm393', 'lm339'],
  seven_segment_anode: ['7 segment', 'seven segment', 'common anode'],
  seven_segment_cathode: ['7 segment', 'seven segment', 'common cathode'],
  connector2: ['connector', 'header', '2 pin', 'terminal'],
  connector3: ['connector', 'header', '3 pin', 'terminal'],
  bnc: ['bnc', 'coax'],
  test_point: ['test point', 'testpoint'],
  gate_and: ['and gate', 'and', '7408', '4081'],
  gate_or: ['or gate', 'or', '7432', '4071'],
  gate_nand: ['nand', '7400', '4011'],
  gate_nor: ['nor', '7402', '4001'],
  gate_xor: ['xor', '7486', '4030'],
  gate_xnor: ['xnor', '4077'],
  gate_not: ['inverter', 'not gate', '7404', '4069'],
  gate_buffer: ['buffer', 'non inverting'],
  flipflop_d: [
    'd flip flop',
    'd flipflop',
    'd type flip flop',
    'd type flipflop',
    'ffd',
    'ffde',
    'ffdpc',
    '7474',
    '4013',
  ],
  flipflop_jk: ['jk', 'j k', '7476', '4027'],
  latch_d: ['d latch', 'latch', '7475'],
  latch_rs: ['rs latch', 'sr latch', 'set reset'],
  mux2: ['multiplexer', 'mux', '74157', '4053'],
  full_adder: ['full adder', 'adder', '7483'],
  decoder2to4: ['decoder', '74139', '4555'],
  encoder4to2: ['encoder', '74148'],
  counter_bcd: ['bcd counter', 'counter', '7490', '4510'],
  counter_binary3_async: ['ripple counter', 'counter', '7493'],
  counter_binary3_sync: ['synchronous counter', 'counter', '74161'],
  counter_johnson: ['johnson', '4017'],
  shift_register3: ['shift register', '74164', '4015'],
  wheatstone_bridge: ['wheatstone', 'bridge'],
  solar_cell: ['solar', 'photovoltaic'],
  piezo_sensor: ['piezo'],
  strain_gauge: ['strain'],
  moisture_sensor: ['moisture'],
  ph_probe: ['ph probe', 'electrode'],
  hall_sensor: ['hall'],
  temperature_sensor: ['temperature', 'lm35', 'tmp36'],
  pressure_sensor: ['pressure'],
  light_sensor: ['light sensor', 'photo'],
  adc4: ['adc', 'analog digital', 'analogue digital'],
  dac4: ['dac', 'digital analog', 'digital analogue'],
  microcontroller: ['microcontroller', 'pic', 'atmega'],
  fpga: ['fpga', 'cpld'],
};

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

export function referenceId(requirement) {
  if (
    requirement.folder.startsWith('08 ') ||
    requirement.folder.startsWith('09 ')
  )
    return 'derived:gate_nand';
  if (REUSE[requirement.id]) return `spice:${REUSE[requirement.id][0]}`;
  if (/capacitor/.test(requirement.id)) return 'spice:capacitor';
  if (/diode|thyristor|solar/.test(requirement.id)) return 'spice:diode';
  if (/jfet/.test(requirement.id))
    return requirement.id.endsWith('_p') ? 'spice:pmos' : 'spice:nmos';
  if (/darlington/.test(requirement.id))
    return requirement.id.endsWith('_pnp') ? 'spice:pnp' : 'spice:npn';
  if (/source|voltage|current|cell|battery/.test(requirement.id))
    return 'spice:voltage-source';
  if (requirement.pins.length > 3) return 'spice:ua741';
  return 'spice:resistor';
}
export function styleFlags(requirement, candidate, reference) {
  const m = candidate.metrics,
    flags = [];
  if (!m.valid) return ['Invalid artwork: ' + m.error];
  if (m.pinCount !== requirement.pins.length)
    flags.push(
      `${m.pinCount} source pins / ${requirement.pins.length} required`,
    );
  if (m.duplicatePins) flags.push('Duplicate source pin identifiers');
  if (!m.relativeGrid) flags.push('Relative pin spacing needs grid repair');
  else if (!m.absoluteGrid) flags.push('Translate artwork onto the grid');
  if (m.pins.some((p) => p.hidden)) flags.push('Hidden terminals need review');
  if (m.parts > 1 || m.sheets > 1)
    flags.push('Multi-part symbol: review visible part and terminals');
  if (m.raster) flags.push('Contains a raster image');
  if (m.lineWidth > 2) flags.push('Heavier strokes than the SPICE reference');
  const r = reference?.metrics;
  if (r?.leadMm && (m.leadMm < r.leadMm * 0.5 || m.leadMm > r.leadMm * 1.75))
    flags.push('Lead length differs from reference');
  const size = Math.max(m.bodyWidthMm, m.bodyHeightMm),
    base = Math.max(r?.bodyWidthMm || 0, r?.bodyHeightMm || 0);
  if (
    requirement.pins.length <= 3 &&
    base &&
    (size < base * 0.5 || size > base * 2)
  )
    flags.push('Body size differs from reference');
  return flags;
}
function textScore(entry, terms) {
  const name = normalize(entry.name),
    description = normalize(entry.description),
    text = ` ${name} ${description} `;
  let score = 0;
  for (const term of terms.map(normalize).filter(Boolean)) {
    if (name === term) score = Math.max(score, 110);
    const bareLogic = ['and', 'or', 'not'].includes(term);
    const matchingText = bareLogic ? ` ${name} ` : text;
    if (
      matchingText.includes(` ${term} `) ||
      (bareLogic &&
        [`${term} gate`, `input ${term}`, `logic ${term}`].some((phrase) =>
          ` ${description} `.includes(` ${phrase} `),
        )) ||
      (/^\d{3,}$/.test(term) && text.includes(term))
    )
      score = Math.max(score, 60 + Math.min(term.length, 25));
  }
  return score;
}
export function rankCandidates(
  catalog,
  requirement,
  { query = '', all = false, includeRejected = [] } = {},
) {
  const reference = catalog.candidates.find(
    (c) => c.id === referenceId(requirement),
  );
  const terms = query
    ? [query, ...normalize(query).split(' ')]
    : [...requirement.search_terms, ...(HINTS[requirement.id] || [])];
  const rejected = new Set(includeRejected);
  return catalog.candidates
    .flatMap((candidate) => {
      const queryTokens = normalize(query).split(' ').filter(Boolean);
      const matchingNames = query
        ? candidate.names.filter((n) => {
            const text = normalize(
              `${n.name} ${n.description} ${n.author} ${n.nameId} ${
                candidate.sourceSymbolId || ''
              } ${candidate.id}`,
            );
            return queryTokens.every((token) =>
              /^[a-z]{1,2}$/.test(token)
                ? ` ${text} `.includes(` ${token} `)
                : text.includes(token),
            );
          })
        : candidate.names;
      if (!matchingNames.length) return [];
      const names = matchingNames
        .map((n) => ({ n, score: textScore(n, terms) }))
        .sort(
          (a, b) =>
            b.score - a.score ||
            Number(b.n.author === catalog.rules.preferredAuthor) -
              Number(a.n.author === catalog.rules.preferredAuthor) ||
            a.n.nameId - b.n.nameId,
        );
      const best = names[0];
      if (!all && !best?.score && !query) return [];
      const flags = styleFlags(requirement, candidate, reference);
      const criticalPenalty =
        (candidate.metrics.pinCount !== requirement.pins.length ? 400 : 0) +
        (candidate.metrics.duplicatePins ? 300 : 0) +
        (!candidate.metrics.relativeGrid ? 150 : 0);
      const score =
        (best?.score || 0) * 10 -
        criticalPenalty +
        (best?.n.author === catalog.rules.preferredAuthor ? 70 : 0) +
        (candidate.kind === 'spice' ? 30 : 0) -
        flags.length * 12;
      return [
        {
          ...candidate,
          names: undefined,
          name: best?.n.name || candidate.name,
          description: best?.n.description || '',
          author: best?.n.author || '',
          sourceNameId: best?.n.nameId,
          aliasCount: candidate.names.length,
          flags,
          score,
          rejected: rejected.has(candidate.id),
        },
      ];
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

// Hash artwork and entry identity, so repacking SQLite or changing folder
// metadata cannot invalidate otherwise identical symbol decisions.
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

export async function prepareCatalog({ root, sql, cache }) {
  const [raw, masterRaw, rulesRaw, provenanceRaw, spiceBytes, derivedRaw] =
    await Promise.all([
      readFile(sql, 'utf8'),
      readFile(
        path.join(root, 'docs/symbol-libraries/all-symbols.json'),
        'utf8',
      ),
      readFile(
        path.join(root, 'docs/symbol-libraries/selection-rules.json'),
        'utf8',
      ),
      readFile(
        path.join(root, 'bundled-libraries/spice/spice.provenance.json'),
        'utf8',
      ),
      readFile(path.join(root, 'bundled-libraries/spice/spice.tclib')),
      readFile(path.join(root, 'library-recipes/derived-symbols.json'), 'utf8'),
    ]);
  const master = JSON.parse(masterRaw),
    rules = JSON.parse(rulesRaw),
    provenance = JSON.parse(provenanceRaw);
  const data = readComponentDump(raw),
    groups = new Map();
  for (const entry of componentInventory(data)) {
    if (!groups.has(entry.symbolId)) groups.set(entry.symbolId, []);
    groups.get(entry.symbolId).push({
      nameId: entry.nameId,
      name: entry.name,
      description: entry.description || '',
      author: entry.author || 'Unknown',
    });
  }
  const artwork = path.join(cache, 'artwork');
  await mkdir(artwork, { recursive: true });
  const candidates = [];
  for (const [symbolId, names] of groups) {
    const source = data.symbols.get(symbolId),
      xml =
        source.Data instanceof Uint8Array
          ? new TextDecoder().decode(source.Data)
          : String(source.Data);
    const id = `sql:${symbolId}`;
    candidates.push({
      id,
      kind: 'sql',
      sourceSymbolId: symbolId,
      names,
      metrics: geometry(xml),
      xmlSha256: digest(xml),
    });
    await writeFile(path.join(artwork, id.replace(':', '-') + '.xml'), xml);
  }
  const spice = await spiceArtworkSnapshot(spiceBytes, provenance);
  for (const { candidate, xml } of spice.records) {
    candidates.push(candidate);
    await writeFile(
      path.join(artwork, candidate.id.replace(':', '-') + '.xml'),
      xml,
    );
  }
  const derived = derivedArtworkSnapshot(spice, JSON.parse(derivedRaw));
  for (const { candidate, xml } of derived.records) {
    candidates.push(candidate);
    await writeFile(
      path.join(artwork, candidate.id.replace(':', '-') + '.xml'),
      xml,
    );
  }
  const digital = await digitalArtworkSnapshot({
    root,
    spice,
    requirements: master.symbols,
  });
  const functional = await functionalArtworkSnapshot({
    root,
    digital,
    requirements: master.symbols,
  });
  const sensors = await sensorArtworkSnapshot({
    root,
    digital,
    spice,
    requirements: master.symbols,
  });
  for (const { candidate, xml } of [
    ...digital.records,
    ...sensors.records,
    ...functional.records,
  ]) {
    candidate.metrics = geometry(xml);
    if (
      !candidate.metrics.valid ||
      !candidate.metrics.absoluteGrid ||
      candidate.metrics.duplicatePins
    )
      throw new Error('Invalid digital artwork: ' + candidate.id);
    candidates.push(candidate);
    await writeFile(
      path.join(artwork, candidate.id.replace(':', '-') + '.xml'),
      xml,
    );
  }
  const ids = new Set();
  for (const requirement of master.symbols) {
    if (
      requirement.id !== requirement.canonical_symbol_id ||
      ids.has(requirement.id)
    )
      throw new Error('Master must have unique canonical IDs.');
    ids.add(requirement.id);
    if (
      requirement.asset_kind === 'editor_primitive' &&
      !NATIVE[requirement.id]
    )
      throw new Error('Unknown native operation ' + requirement.id);
  }
  const catalog = {
    version: 1,
    inventorySha256: digest(masterRaw),
    sourceSha256: digest(raw),
    spiceSha256: spice.fingerprint,
    derivedSha256: derived.fingerprint,
    digitalSha256: digital.fingerprint,
    functionalSha256: functional.fingerprint,
    sensorsSha256: sensors.fingerprint,
    rules,
    requirements: master.symbols.map((requirement) => {
      const choice = rules.symbolChoices?.[requirement.id];
      if (!choice) return requirement;
      if (
        choice.mode !== 'select-one-style' ||
        !Array.isArray(choice.candidateIds) ||
        choice.candidateIds.length !== 2 ||
        choice.candidateIds.some((id) => !candidates.some((c) => c.id === id))
      )
        throw new Error('Invalid style choice for ' + requirement.id);
      return {
        ...requirement,
        drawing_description: choice.description,
        artworkChoice: { mode: choice.mode, candidateIds: choice.candidateIds },
      };
    }),
    libraries: master.source_libraries,
    candidates,
  };
  await writeFile(path.join(cache, 'catalog.json'), JSON.stringify(catalog));
  return catalog;
}

export function initialState(catalog) {
  const decisions = {};
  for (const requirement of catalog.requirements) {
    if (NATIVE[requirement.id])
      decisions[requirement.id] = {
        status: 'native',
        operation: NATIVE[requirement.id],
      };
    else if (
      catalog.candidates.some(
        (c) => c.kind === 'derived' && c.canonicalId === requirement.id,
      )
    ) {
      const variants = catalog.candidates.filter(
        (c) => c.kind === 'derived' && c.canonicalId === requirement.id,
      );
      const candidate = variants[0],
        numbers = candidate.derivedDefinition.pins;
      if (numbers.length !== requirement.pins.length)
        throw new Error('Derived pin contract mismatch ' + requirement.id);
      const pinMap = Object.fromEntries(
        requirement.pins.map((logical, i) => {
          const p = candidate.metrics.pins.filter(
            (p) => p.number === numbers[i],
          );
          if (p.length !== 1)
            throw new Error('Ambiguous derived pin ' + requirement.id);
          return [logical.logical_number, p[0].key];
        }),
      );
      decisions[requirement.id] = {
        status: 'reuse',
        candidateId: candidate.id,
        xmlSha256: candidate.xmlSha256,
        pinMap,
        source: {
          kind: 'derived',
          recipe:
            candidate.recipePath || 'library-recipes/derived-symbols.json',
          ...(candidate.bundlePath
            ? { bundle: candidate.bundlePath, nameId: candidate.bundleNameId }
            : {}),
          id: requirement.id,
          baseCandidateId: candidate.baseCandidateId,
          baseXmlSha256: candidate.baseXmlSha256,
        },
        variants: variants.map((c) => c.id),
        modelReviewRequired: true,
        modelReuseAllowed: false,
        note:
          candidate.derivationNote ||
          'Derived from the corrected SPICE base. ' +
            (variants.length === 2 && candidate.resistorStyle
              ? 'EU and US resistor bodies share identical terminals; both variants apply to every bundle. '
              : '') +
            'Artwork only: supply a suitable model adapter separately.',
      };
    } else if (REUSE[requirement.id]) {
      const [recipeId, numbers] = REUSE[requirement.id],
        candidate = catalog.candidates.find(
          (c) => c.id === `spice:${recipeId}`,
        );
      if (!candidate || numbers.length !== requirement.pins.length)
        throw new Error('Invalid reuse mapping ' + requirement.id);
      const pinMap = Object.fromEntries(
        requirement.pins.map((pin, index) => {
          const source = candidate.metrics.pins.filter(
            (p) => p.number === numbers[index],
          );
          if (source.length !== 1)
            throw new Error('Ambiguous reused pin ' + requirement.id);
          return [pin.logical_number, source[0].key];
        }),
      );
      decisions[requirement.id] = {
        status: 'reuse',
        candidateId: candidate.id,
        xmlSha256: candidate.xmlSha256,
        pinMap,
        source: {
          bundle: 'bundled-libraries/spice/spice.tclib',
          recipeId,
          nameId: candidate.bundleNameId,
        },
        modelReviewRequired: true,
        ...(ARTWORK_ONLY[requirement.id] ? { modelReuseAllowed: false } : {}),
        ...(['resistor', 'potentiometer'].includes(requirement.id)
          ? { variants: [candidate.id, candidate.id + '-us'] }
          : {}),
        ...(requirement.id === 'led'
          ? {
              variants: [
                'spice:led-red',
                'spice:led-green',
                'spice:led-blue',
                'spice:led-yellow',
              ],
            }
          : {}),
        note:
          ARTWORK_ONLY[requirement.id] ||
          (requirement.id === 'opamp'
            ? 'Reuse the 741 artwork. The model must be checked against each experiment separately.'
            : 'Reuse corrected SPICE artwork; retain this logical-to-source terminal mapping.'),
      };
    } else decisions[requirement.id] = { status: 'pending' };
  }
  return {
    version: 1,
    revision: 0,
    inventorySha256: catalog.inventorySha256,
    sourceSha256: catalog.sourceSha256,
    spiceSha256: catalog.spiceSha256,
    derivedSha256: catalog.derivedSha256,
    digitalSha256: catalog.digitalSha256,
    functionalSha256: catalog.functionalSha256,
    sensorsSha256: catalog.sensorsSha256,
    decisions,
  };
}
