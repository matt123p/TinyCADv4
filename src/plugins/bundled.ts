import bundled from './bundledData.json';
import { verifyPackage } from './github';
import type { CatalogEntry, PluginVersion } from './types';

/** Trusted examples ship with this application; no code is run while previewing them. */
export async function loadBundledPlugins() {
  return Promise.all(bundled.map(async entry => {
    const files = Object.fromEntries(Object.entries(entry.files).map(([name, content]) => [name, new TextEncoder().encode(content)]));
    const source: PluginVersion = {
      repository: { id: 0, url: 'https://github.com/matt123p/TinyCADv4', slug: 'matt123p/tinycadv4', defaultBranch: 'main' },
      entry: { ...entry.metadata, package: { type: 'source', manifest: `examples/plugins/${entry.name}/tinycad-plugin.json` } } as CatalogEntry,
      commit: 'bundled', ref: 'bundled', catalogDigest: 'bundled',
    };
    return verifyPackage(files, source);
  }));
}
