import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { librarySqlite, serializeLibrary } from './lib/library-from-sql.mjs';
import {
  spiceArtworkSnapshot,
  derivedArtworkSnapshot,
  digest,
} from './lib/library-artwork.mjs';
import { digitalArtworkSnapshot } from './lib/digital-artwork.mjs';
import { functionalArtworkSnapshot } from './lib/functional-artwork.mjs';
import { sensorArtworkSnapshot } from './lib/sensor-artwork.mjs';
import { selectedSqlArtwork } from './lib/selected-artwork.mjs';
import { teachingModel } from './lib/teaching-models.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const json = async (file) =>
  JSON.parse(await readFile(path.join(root, file), 'utf8'));
export async function buildTeachingLibraries() {
  const master = await json('library-sources/inventory/all-symbols.json'),
    manifest = await json('library-sources/inventory/library-manifest.json');
  const catalog = await json('bundled-libraries/config.json');
  const bundledIds = new Set(catalog.libraries.map((library) => library.id));
  const courses = manifest.libraries.filter((course) =>
    bundledIds.has(course.library_id),
  );
  const selections = await json('library-sources/teaching/selections.json');
  const spiceBytes = await readFile(
    path.join(root, 'bundled-libraries/spice/spice.tclib'),
  );
  const spice = await spiceArtworkSnapshot(
    spiceBytes,
    await json('bundled-libraries/spice/spice.provenance.json'),
  );
  const derived = derivedArtworkSnapshot(
    spice,
    await json('library-recipes/derived-symbols.json'),
  );
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
  const records = [
    ...spice.records,
    ...derived.records,
    ...digital.records,
    ...functional.records,
    ...sensors.records,
  ];
  const SQL = await librarySqlite(),
    db = new SQL.Database(new Uint8Array(spiceBytes));
  const sourceAttributes = (id) =>
    db
      .exec(
        `SELECT AttName,AttValue,ShowAtt FROM Attribute WHERE NameID=${Number(
          id,
        )}`,
      )[0]
      ?.values.map(([AttName, AttValue, ShowAtt]) => ({
        AttName,
        AttValue,
        ShowAtt,
      })) || [];
  const preserve = new Set([
    'resistor',
    'resistance_wire',
    'capacitor',
    'capacitor_plates',
    'capacitor_polarised',
    'capacitor_variable',
    'inductor',
    'potentiometer',
    'diode',
    'diode_rectifier',
    'led',
    'zener',
    'bjt_npn',
    'bjt_pnp',
    'mosfet_n',
    'mosfet_p',
    'opamp',
  ]);
  const entries = [];
  try {
    for (const r of master.symbols.filter(
      (r) => r.asset_kind !== 'editor_primitive',
    )) {
      const decision = selections.decisions[r.id];
      if (!decision || !['chosen', 'reuse'].includes(decision.status))
        throw Error('Unselected symbol ' + r.id);
      const ids = decision.variants?.length
        ? decision.variants
        : [decision.candidateId];
      for (const id of ids) {
        const record = records.find((s) => s.candidate.id === id);
        const selected = record
          ? {
              xml: record.xml,
              xmlSha256: record.candidate.xmlSha256,
              source: { candidateId: id },
              changes: [],
            }
          : await selectedSqlArtwork(root, r, decision);
        const candidate = record?.candidate;
        const numbers = r.pins.map((p, i) =>
          candidate?.kind === 'derived'
            ? candidate.derivedDefinition.pins[i]
            : candidate?.kind === 'spice'
            ? decision.pinMap[p.logical_number].split(':').at(-1)
            : p.logical_number,
        );
        const mapped = r.pins.map((p, i) => ({ ...p, number: numbers[i] }));
        let attributes;
        if (candidate?.kind === 'spice' && preserve.has(r.id))
          attributes = sourceAttributes(candidate.bundleNameId);
        else
          attributes = teachingModel(r.id, mapped, {
            edge: candidate?.clockEdge,
          }).attributes;
        if (
          !attributes.some((a) => a.AttName === '$$SPICE' && a.AttValue.trim())
        )
          throw Error('No simulation model ' + id);
        entries.push({
          canonicalId: r.id,
          candidateId: id,
          xml: selected.xml,
          attributes,
          name:
            ids.length === 1
              ? r.name
              : r.name +
                ' · ' +
                (candidate?.resistorStyle?.toUpperCase() ||
                  candidate?.clockEdge ||
                  candidate?.names[0].name),
          reference: r.reference_prefix + '?',
          description: r.drawing_description,
          provenance: {
            ...selected,
            xml: undefined,
            logicalToSymbolPins: Object.fromEntries(
              r.pins.map((p, i) => [p.logical_number, numbers[i]]),
            ),
            modelSha256: digest(JSON.stringify(attributes)),
            simulation: 'spice',
          },
        });
      }
    }
  } finally {
    db.close();
  }
  const write = async (id, name, selected) => {
    const library = {
      name,
      names: selected.map((e, i) => ({
        NameID: i + 1,
        Name: e.name,
        SymbolID: i + 1,
        Type: 0,
        Reference: e.reference,
        ppp: 1,
        Description: e.description,
        ShowName: 1,
        ShowRef: 0,
        DefRotate: 0,
        Attributes: e.attributes,
      })),
      symbols: selected.map((e, i) => ({ SymbolId: i + 1, Data: e.xml })),
    };
    const provenance = {
      version: 1,
      id,
      name,
      modelFamily: 'TinyCAD configurable educational equivalents',
      entries: selected.map((e, i) => ({
        id: e.canonicalId,
        candidateId: e.candidateId,
        nameId: i + 1,
        symbolId: i + 1,
        ...e.provenance,
      })),
    };
    const result = { library, provenance, entries: selected };
    if (!bundledIds.has(id)) return result;
    const dir = path.join(root, 'bundled-libraries', id);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, id + '.tclib'),
      await serializeLibrary(library, provenance),
    );
    await writeFile(
      path.join(dir, id + '.provenance.json'),
      JSON.stringify(provenance, null, 2) + '\n',
    );
    return result;
  };
  const shared = await write('teaching', 'Teaching components', entries);
  for (const course of courses) {
    const ids = new Set(course.symbols.map((s) => s.id));
    await write(
      course.library_id,
      course.title,
      entries.filter((e) => ids.has(e.canonicalId)),
    );
  }
  console.log(
    `Built ${entries.length} modelled entries for 96 canonical types and ${courses.length} course bundles.`,
  );
  return shared;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  buildTeachingLibraries().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
