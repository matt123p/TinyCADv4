import type { DevelopmentSource, PluginVersion, StarterRepository } from './types';
import { pluginStorage } from './storage';
import { canonicalRepository, check } from './validation';
import { developmentURL } from './development';
import starters from './repositories.json';

export interface PluginSource {
  id: string;
  name: string;
  kind: 'github' | 'server' | 'directory';
  url?: string;
  ref?: string;
  directory?: Extract<DevelopmentSource, { kind: 'directory' }>;
}
export interface PluginSourceSettings { sources: PluginSource[]; catalogs: Record<string, PluginVersion[]>; }
const KEY = 'manager-sources-v1';
export function githubSource(input: string, ref?: string): PluginSource {
  const repo = canonicalRepository(input.trim());
  return { id: 'github:' + repo.url, name: repo.slug, kind: 'github', url: repo.url, ...(ref ? { ref } : {}) };
}
export function versionSource(version: PluginVersion): PluginSource {
  const dev = version.development;
  if (dev?.kind === 'directory') return { id: 'directory:' + dev.id, name: dev.name, kind: 'directory', directory: dev };
  if (dev?.kind === 'server') return { id: 'server:' + dev.url, name: dev.url, kind: 'server', url: dev.url };
  return githubSource(version.repository.url);
}
export async function loadSourceSettings(installed: PluginVersion[]): Promise<PluginSourceSettings> {
  type LegacySource = PluginSource | { id: string; name: string; kind: 'bundled' };
  const saved = await pluginStorage.get<{ sources: LegacySource[]; catalogs: Record<string, PluginVersion[]> }>(KEY);
  if (!saved) {
    const sources = [...(starters as StarterRepository[]).map(repo => ({ ...githubSource(repo.url), name: repo.name })),
      ...installed.filter(version => version.commit !== 'bundled').map(versionSource)];
    return { sources: sources.filter((source, i) => sources.findIndex(other => other.id === source.id) === i), catalogs: {} };
  }
  check(Array.isArray(saved.sources) && saved.sources.length <= 100 && saved.catalogs && typeof saved.catalogs === 'object', 'Invalid saved plugin sources.');
  // Forget the former built-in catalog and automatically seeded example repository.
  // Explicitly installed packages remain in the independent installation store/cache.
  const sources = saved.sources.filter((source): source is PluginSource => source.kind !== 'bundled' && source.id !== 'bundled'
    && !(source.kind === 'github' && source.name === 'TinyCAD example plugins' && source.url === 'https://github.com/matt123p/tinycadv4'));
  for (const source of sources) {
    check(typeof source.name === 'string' && source.name.length <= 500, 'Invalid plugin source name.');
    if (source.kind === 'github') check(source.id === githubSource(source.url).id, 'Invalid repository source.');
    else if (source.kind === 'server') check(source.id === 'server:' + developmentURL(source.url).href, 'Invalid local server source.');
    else if (source.kind === 'directory') check(source.directory?.kind === 'directory' && source.id === 'directory:' + source.directory.id, 'Invalid directory source.');
    else check(false, 'Invalid plugin source.');
  }
  const catalogs = Object.fromEntries(Object.entries(saved.catalogs).filter(([id]) => sources.some(source => source.id === id)));
  const migrated = { sources, catalogs };
  if (sources.length !== saved.sources.length || Object.keys(catalogs).length !== Object.keys(saved.catalogs).length) await saveSourceSettings(migrated);
  return migrated;
}
export function saveSourceSettings(settings: PluginSourceSettings) { return pluginStorage.set(KEY, settings); }
