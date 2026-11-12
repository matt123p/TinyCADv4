import fs from 'node:fs/promises';
import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } from '@zip.js/zip.js';
const files = {};
async function collect(dir, relative = '') {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name.endsWith('.zip')) continue;
    const p = dir + '/' + e.name,
      r = relative + e.name;
    if (e.isDirectory()) await collect(p, r + '/');
    else files[r] = new Uint8Array(await fs.readFile(p));
  }
}
await collect('tutorials');
const archive = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
for (const [name, bytes] of Object.entries(files)) {
  await archive.add(name, new Uint8ArrayReader(bytes), { level: 6 });
}
await fs.writeFile(
  'tutorials/tinycad-simulation-tutorials.zip',
  await archive.close(),
);
console.log('Packaged ' + Object.keys(files).length + ' tutorial files');
