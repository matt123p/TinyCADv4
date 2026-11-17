import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkArtwork } from './lib/network-artwork.mjs';
import { serializeLibrary } from './lib/library-from-sql.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function buildNetworkLibrary() {
  const recipe = JSON.parse(
    await readFile(
      path.join(root, 'library-recipes/network-layout.json'),
      'utf8',
    ),
  );
  const result = networkArtwork(recipe);
  const output = path.join(root, recipe.output);
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
    `Built ${result.records.length} network layout symbols: ${output}`,
  );
  return result;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await buildNetworkLibrary();
