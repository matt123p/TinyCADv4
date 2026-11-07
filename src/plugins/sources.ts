import type { DevelopmentSource, PluginVersion } from './types';
import { pluginStorage } from './storage';
import { canonicalRepository, check } from './validation';
import { developmentURL } from './development';
import starters from './repositories.json';

export interface PluginSource {
  id: string;
  name: string;
  kind: 'bundled' | 'github' | 'server' | 'directory';
  url?: string;
  ref?: string;
  directory?: Extract<DevelopmentSource, { kind: 'directory' }>;
}
export interface PluginSourceSettings { sources: PluginSource[]; catalogs: Record<string, PluginVersion[]>; }
const KEY = 'manager-sources-v1';
export const bundledSource: PluginSource = { id: 'bundled', name: 'Bundled examples', kind: 'bundled' };
export function githubSource(input: string, ref?: string): PluginSource {
  const repo = canonicalRepository(input.trim());
  return { id: 'github:' + repo.url, name: repo.slug, kind: 'github', url: repo.url, ...(ref ? { ref } : {}) };
}
export function versionSource(version: PluginVersion): PluginSource {
  if (version.commit === 'bundled') return bundledSource;
  const dev = version.development;
  if (dev?.kind === 'directory') return { id: 'directory:' + dev.id, name: dev.name, kind: 'directory', directory: dev };
  if (dev?.kind === 'server') return { id: 'server:' + dev.url, name: dev.url, kind: 'server', url: dev.url };
  return githubSource(version.repository.url);
}
export async function loadSourceSettings(installed: PluginVersion[]): Promise<PluginSourceSettings> {
  const saved = await pluginStorage.get<PluginSourceSettings>(KEY);
  if (!saved) {
    const sources = [bundledSource, ...starters.map(repo => ({ ...githubSource(repo.url), name: repo.name })), ...installed.map(versionSource)];
    return { sources: sources.filter((source, i) => sources.findIndex(other => other.id === source.id) === i), catalogs: {} };
  }
  check(Array.isArray(saved.sources) && saved.sources.length <= 100 && saved.catalogs && typeof saved.catalogs === 'object', 'Invalid saved plugin sources.');
  for (const source of saved.sources) {
    check(typeof source.name === 'string' && source.name.length <= 500, 'Invalid plugin source name.');
    if (source.kind === 'github') check(source.id === githubSource(source.url).id, 'Invalid repository source.');
    else if (source.kind === 'server') check(source.id === 'server:' + developmentURL(source.url).href, 'Invalid local server source.');
    else if (source.kind === 'directory') check(source.directory?.kind === 'directory' && source.id === 'directory:' + source.directory.id, 'Invalid directory source.');
    else check(source.kind === 'bundled' && source.id === 'bundled', 'Invalid plugin source.');
  }
  return { sources: [bundledSource, ...saved.sources.filter(source => source.id !== 'bundled')], catalogs: saved.catalogs };
}
export function saveSourceSettings(settings: PluginSourceSettings) { return pluginStorage.set(KEY, settings); }
