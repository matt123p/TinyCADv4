import fs from 'node:fs/promises';
import path from 'node:path';

const entryStem = process.argv[2];

if (!entryStem) {
  throw new Error('Expected the Parcel entry stem, for example: index-fs or index-ga.');
}

const distDir = path.resolve(process.cwd(), 'dist');
const sourcePath = path.join(distDir, `${entryStem}.html`);
const targetPath = path.join(distDir, 'index.html');

const removeSourceMaps = async (dirPath) => {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      await removeSourceMaps(entryPath);
      return;
    }

    if (entry.name.endsWith('.map')) {
      await fs.rm(entryPath, { force: true });
    }
  }));
};

await fs.rm(targetPath, { force: true });
await fs.rename(sourcePath, targetPath);
await removeSourceMaps(distDir);