import { readFile, writeFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { embeddedArtwork } from './lib/embedded-artwork.mjs';
import { audioArtwork } from './lib/audio-artwork.mjs';
import { testMeasurementArtwork } from './lib/test-measurement-artwork.mjs';
import { motorsMotionArtwork } from './lib/motors-motion-artwork.mjs';
import {
  layoutProofPage,
  embeddedProofIds,
  audioProofIds,
  testMeasurementProofIds,
  motorsMotionProofIds,
} from './lib/layout-proof-page.mjs';
await mkdir('build/layout-pages', { recursive: true });
for (const [id, artwork, ids] of [
  ['embedded-smart-home', embeddedArtwork, embeddedProofIds],
  ['audio-music', audioArtwork, audioProofIds],
  ['test-measurement', testMeasurementArtwork, testMeasurementProofIds],
  ['motors-motion', motorsMotionArtwork, motorsMotionProofIds],
]) {
  const { records } = artwork(
    JSON.parse(await readFile(`library-recipes/${id}.json`, 'utf8')),
  );
  const result = await layoutProofPage(records, ids);
  await writeFile(`build/layout-pages/${id}-a4.dsn`, result.dsn);
  await writeFile(`build/layout-pages/${id}-a4.svg`, result.svg);
  await writeFile(
    `build/layout-pages/${id}-a4.json`,
    JSON.stringify(
      { page: result.page, placements: result.placements },
      null,
      2,
    ) + '\n',
  );
  await sharp(Buffer.from(result.svg))
    .resize({ width: 1782 })
    .png()
    .toFile(`docs/${id}-a4.png`);
  console.log(`${id}: ${ids.length} native-size components fit A4`);
}
