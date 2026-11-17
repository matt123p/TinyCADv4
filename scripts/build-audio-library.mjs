import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { audioArtwork } from './lib/audio-artwork.mjs';
import { serializeLibrary } from './lib/library-from-sql.mjs';
const root = new URL('../', import.meta.url);
const recipe = JSON.parse(
  await readFile(new URL('library-recipes/audio-music.json', root), 'utf8'),
);
const result = audioArtwork(recipe),
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
  `Built ${result.records.length} Audio & Music symbols: ${output.pathname}`,
);
