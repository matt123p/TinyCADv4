import { readFile } from 'node:fs/promises';

/** Test fixtures come from the external examples, never from application assets. */
export async function loadPluginExamples() {
  const root = new URL('../../examples/plugins/', import.meta.url);
  const catalog = JSON.parse(await readFile(new URL('tinycad-plugins.json', root), 'utf8'));
  return Promise.all(catalog.plugins.map(async entry => {
    const manifestURL = new URL(entry.package.manifest, root);
    const raw = await readFile(manifestURL, 'utf8'); const manifest = JSON.parse(raw);
    const files = { 'tinycad-plugin.json': raw };
    for (const file of manifest.files) files[file] = await readFile(new URL(file, manifestURL), 'utf8');
    const { package: descriptor, ...metadata } = entry;
    return { name: descriptor.manifest.split('/')[0], files, metadata };
  }));
}
