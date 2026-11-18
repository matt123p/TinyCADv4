import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spiceArtworkSnapshot } from './lib/library-artwork.mjs';
import { digitalArtworkSnapshot } from './lib/digital-artwork.mjs';
import { serializeLibrary } from './lib/library-from-sql.mjs';
import { sensorArtworkSnapshot } from './lib/sensor-artwork.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
export async function buildSensorLibrary() {
  const [bytes, provenance, master] = await Promise.all([
    readFile(path.join(root, 'bundled-libraries/spice/spice.tclib')),
    readFile(
      path.join(root, 'bundled-libraries/spice/spice.provenance.json'),
      'utf8',
    ),
    readFile(path.join(root, 'library-sources/inventory/all-symbols.json'), 'utf8'),
  ]);
  const spice = await spiceArtworkSnapshot(bytes, JSON.parse(provenance));
  const digital = await digitalArtworkSnapshot({
    root,
    spice,
    requirements: JSON.parse(master).symbols,
  });
  const result = await sensorArtworkSnapshot({
    root,
    digital,
    spice,
    requirements: JSON.parse(master).symbols,
  });
  const output = path.join(root, result.recipe.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(
    output,
    await serializeLibrary(result.library, result.provenance),
  );
  await writeFile(
    output.replace(/\.tclib$/, '.provenance.json'),
    JSON.stringify(result.provenance, null, 2) + '\n',
  );
  console.log(
    `Built ${result.records.length} sensor/interface symbols: ${output}`,
  );
  return result;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  buildSensorLibrary().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
