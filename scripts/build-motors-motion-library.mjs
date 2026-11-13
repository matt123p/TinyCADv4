import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { motorsMotionArtwork } from './lib/motors-motion-artwork.mjs';
import { serializeLibrary } from './lib/library-from-sql.mjs';
const root = new URL('../', import.meta.url);
const recipe = JSON.parse(
  await readFile(new URL('library-recipes/motors-motion.json', root), 'utf8'),
);
const result = motorsMotionArtwork(recipe),
  output = new URL(recipe.output, root);
await mkdir(new URL('./', output), { recursive: true });
await writeFile(
  output,
  await serializeLibrary(result.library, result.provenance),
);
await writeFile(
  new URL(recipe.output.replace(/\.tclib$/, '.provenance.json'), root),
  JSON.stringify(result.provenance, null, 2) + '\n',
);
console.log(
  `Built ${result.records.length} Motors & Motion symbols: ${output.pathname}`,
);
