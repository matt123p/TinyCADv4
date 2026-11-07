import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const packages = []; const entries = []; const releaseEntries = [];
for (const name of ['inspector', 'project']) {
  const folder = path.join(root, 'examples/plugins', name);
  const raw = await readFile(path.join(folder, 'tinycad-plugin.json'), 'utf8'); const manifest = JSON.parse(raw);
  const bytes = { 'tinycad-plugin.json': Buffer.from(raw) };
  for (const file of manifest.files) {
    if (file.split('/').some(segment => segment === '..') || path.isAbsolute(file)) throw new Error('Invalid package file.');
    const data = await readFile(path.join(folder, file)); bytes[file] = data;
  }
  const metadata = Object.fromEntries(['id', 'name', 'description', 'version', 'apiVersion', 'platforms', 'readme', 'changelog', 'documentation'].map(key => [key, manifest[key]]));
  entries.push({ ...metadata, package: { type: 'source', manifest: `${name}/tinycad-plugin.json` } });
  const zipped = zipSync(bytes, { mtime: new Date('2026-01-01T00:00:00Z') }); const asset = `${manifest.id}-${manifest.version}.zip`;
  releaseEntries.push({ ...metadata, package: { type: 'releaseAsset', asset, sha256: createHash('sha256').update(zipped).digest('hex') } });
  packages.push({ zipped, asset });
}
const catalog = JSON.stringify({ catalogVersion: 1, plugins: entries }, null, 2) + '\n';
const catalogFile = path.join(root, 'examples/plugins/tinycad-plugins.json');
if (process.argv.includes('--check')) {
  if (await readFile(catalogFile, 'utf8') !== catalog) throw new Error('Example catalog is stale. Run npm run plugins:catalog.');
  console.log('Example plugin sources and catalog are current.');
} else {
  await writeFile(catalogFile, catalog);
  if (process.argv.includes('--release')) {
    const output = path.join(root, 'plugin-release'); await mkdir(output, { recursive: true });
    for (const pkg of packages) await writeFile(path.join(output, pkg.asset), pkg.zipped);
    await writeFile(path.join(output, 'tinycad-plugins.json'), JSON.stringify({ catalogVersion: 1, plugins: releaseEntries }, null, 2) + '\n');
    console.log('Release catalog and ZIP packages written to plugin-release/.');
  } else console.log('Example source catalog generated in examples/plugins/.');
}
