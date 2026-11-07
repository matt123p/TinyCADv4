import { compare, prerelease } from 'semver';
import { CatalogEntry, PluginPackage, PluginVersion, Release, Repository } from './types';
import { canonicalRepository, check, LIMITS, parseCatalog, parseManifest, path, sha256 } from './validation';
import { unpackPlugin } from './archive';
import { pluginStorage } from './storage';

const API = 'https://api.github.com';
const text = (data: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(data);
export class GitHubPluginSource {
  private inFlight = new Map<string, Promise<any>>();
  async request(url: string, binary = false, releaseId?: number): Promise<Uint8Array> {
    const u = new URL(url);
    check(u.protocol === 'https:' && ['api.github.com', 'github.com'].includes(u.hostname), 'Unsupported GitHub endpoint.');
    if (window.electronAPI?.pluginDownload) {
      const result = await window.electronAPI.pluginDownload(url, binary);
      return new Uint8Array(result);
    }
    let response: Response;
    try { response = await fetch(url, { credentials: 'omit', headers: { Accept: binary ? 'application/octet-stream' : 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000) }); }
    catch (error) {
      const relay = process.env.PLUGIN_DOWNLOAD_RELAY;
      const match = u.pathname.match(/^\/repos\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\/releases\/assets\/(\d+)$/);
      if (!binary || !relay || !match || !releaseId) throw new Error(`GitHub download could not be fetched.${binary ? ' This deployment may need PLUGIN_DOWNLOAD_RELAY for browser release assets.' : ''}`);
      const target = new URL(relay, location.origin);
      check(target.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(target.hostname), 'Download relay must use HTTPS.');
      target.searchParams.set('repository', match[1]); target.searchParams.set('release', String(releaseId)); target.searchParams.set('asset', match[2]);
      response = await fetch(target.href, { credentials: 'omit', signal: AbortSignal.timeout(30000) });
    }
    if (!response.ok) throw new Error(`GitHub request failed (${response.status}).${response.status === 403 || response.status === 429 ? ' Rate limited; try again later.' : ''}`);
    check(Number(response.headers.get('content-length') || 0) <= LIMITS.package, 'Download too large.');
    const reader = response.body?.getReader(); check(reader, 'Download body is missing.');
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length;
      if (size > LIMITS.package) { await reader.cancel(); throw new Error('Download exceeds plugin package limit.'); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  }
  async json(endpoint: string, refresh = false): Promise<any> {
    if (this.inFlight.has(endpoint)) return this.inFlight.get(endpoint);
    const task = (async () => {
      const key = 'github-' + await sha256(endpoint);
      const cached = await pluginStorage.get<{ time: number; value: any }>(key).catch((): undefined => undefined);
      if (cached && !refresh && Date.now() - cached.time < 15 * 60 * 1000) return cached.value;
      try {
        const bytes = await this.request(API + endpoint);
        check(bytes.length <= (endpoint.includes('/git/blobs/') ? Math.ceil(LIMITS.file * 4 / 3) + LIMITS.metadata : 8 * LIMITS.metadata), 'GitHub metadata too large.');
        const value = JSON.parse(text(bytes)); await pluginStorage.set(key, { time: Date.now(), value }).catch(() => {}); return value;
      } catch (error) { if (cached && !refresh) return cached.value; throw error; }
    })();
    this.inFlight.set(endpoint, task);
    try { return await task; } finally { this.inFlight.delete(endpoint); }
  }
  async repository(url: string): Promise<Repository> {
    const normalized = canonicalRepository(url); const result = await this.json(`/repos/${normalized.slug}`);
    check(Number.isSafeInteger(result.id) && typeof result.default_branch === 'string', 'Invalid GitHub repository.');
    return { id: result.id, url: normalized.url, slug: normalized.slug, defaultBranch: result.default_branch };
  }
  async commit(repository: Repository, ref: string): Promise<string> {
    check(ref.length > 0 && ref.length <= 200, 'Invalid Git reference.');
    const result = await this.json(`/repos/${repository.slug}/commits/${encodeURIComponent(ref)}`);
    check(/^[a-f0-9]{40,64}$/.test(result.sha), 'GitHub did not return a commit SHA.'); return result.sha;
  }
  async sourceFile(repository: Repository, commit: string, file: string): Promise<Uint8Array> {
    path(file); check(/^[a-f0-9]{40,64}$/.test(commit), 'Source retrieval requires an exact commit.');
    // Contents can dereference symlinks and report them as normal files; inspect Git modes first.
    const gitCommit = await this.json(`/repos/${repository.slug}/git/commits/${commit}`);
    check(/^[a-f0-9]{40,64}$/.test(gitCommit.tree?.sha), 'Git commit has no tree.');
    const tree = await this.json(`/repos/${repository.slug}/git/trees/${gitCommit.tree.sha}?recursive=1`);
    check(Array.isArray(tree.tree) && !tree.truncated, 'Repository tree is incomplete; use release assets for this repository.');
    const info = tree.tree.find((entry: any) => entry.path === file);
    check(info?.type === 'blob' && ['100644', '100755'].includes(info.mode) && info.size <= LIMITS.file, 'Source resource is missing, a symlink/submodule, or oversized.');
    const blob = await this.json(`/repos/${repository.slug}/git/blobs/${info.sha}`);
    check(blob.encoding === 'base64' && typeof blob.content === 'string', 'Unsupported GitHub resource encoding.');
    const decoded = atob(blob.content.replace(/\s/g, '')); check(decoded.length <= LIMITS.file, 'Resource too large.');
    return Uint8Array.from(decoded, char => char.charCodeAt(0));
  }
  async releases(repository: Repository, refresh = false): Promise<Release[]> {
    const releases: Release[] = [];
    for (let page = 1; page <= 20; page++) {
      const list = await this.json(`/repos/${repository.slug}/releases?per_page=100&page=${page}`, refresh);
      check(Array.isArray(list), 'Invalid GitHub releases response.'); releases.push(...list.filter((r: Release) => !r.draft));
      if (list.length < 100) return releases;
    }
    throw new Error('Too many repository releases; choose a specific release.');
  }
  async versions(url: string, options: { ref?: string; prerelease?: boolean; refresh?: boolean } = {}): Promise<PluginVersion[]> {
    const repository = await this.repository(url); const releases = options.ref ? [] : await this.releases(repository, options.refresh);
    const versions: PluginVersion[] = []; const errors: string[] = [];
    const read = async (release?: Release) => {
      const ref = release?.tag_name || options.ref || repository.defaultBranch;
      const commit = await this.commit(repository, ref);
      const asset = release?.assets.find(a => a.name === 'tinycad-plugins.json');
      const catalogKey = asset ? 'catalog-' + await sha256(`${repository.id}:${release!.id}:${asset.id}:${asset.digest || (asset as any).updated_at || ''}`) : undefined;
      const cached = catalogKey ? await pluginStorage.get<{ bytes: Uint8Array; time: number }>(catalogKey).catch((): undefined => undefined) : undefined;
      const bytes = cached && Date.now() - cached.time < 15 * 60 * 1000 ? cached.bytes : asset ? await this.request(`${API}/repos/${repository.slug}/releases/assets/${asset.id}`, true, release!.id) : await this.sourceFile(repository, commit, 'tinycad-plugins.json');
      check(bytes.length <= LIMITS.metadata, 'Catalog too large.');
      const catalog = parseCatalog(JSON.parse(text(bytes))); const catalogDigest = await sha256(bytes);
      if (catalogKey && (!cached || bytes !== cached.bytes)) await pluginStorage.set(catalogKey, { bytes, time: Date.now() }).catch(() => {});
      for (const entry of catalog.plugins) versions.push({ repository, entry, commit, release, catalogDigest, ref });
    };
    if (releases.length) {
      for (const release of releases.filter(r => options.prerelease || !r.prerelease)) {
        try { await read(release); } catch (error) { errors.push(`${release.tag_name}: ${(error as Error).message}`); }
      }
      check(versions.length > 0, `No valid compatible plugin catalogs in published releases. ${errors.slice(0, 3).join(' ')}`);
    } else await read();
    const digests = new Map<string, string>();
    for (const version of versions) {
      const descriptor = version.entry.package;
      if (descriptor.type !== 'releaseAsset') continue;
      const digest = descriptor.sha256 || version.release?.assets.find(a => a.name === descriptor.asset)?.digest?.replace(/^sha256:/, '');
      if (!digest) continue;
      const key = version.entry.id + ':' + version.entry.version;
      check(!digests.has(key) || digests.get(key) === digest, `Conflicting packages for ${key}. Publish changed content under a new version.`); digests.set(key, digest);
    }
    return versions.filter(v => options.prerelease || !prerelease(v.entry.version)).sort((a, b) => compare(b.entry.version, a.entry.version));
  }
  async load(source: PluginVersion): Promise<PluginPackage> {
    const { entry, repository } = source; let files: Record<string, Uint8Array>; let digest: string;
    if (entry.package.type === 'releaseAsset') {
      check(source.release, 'Release assets require a published release.');
      const asset = source.release.assets.find(a => a.name === (entry.package as any).asset);
      check(asset && asset.size <= LIMITS.package, 'Release package is missing or too large.');
      const githubDigest = asset.digest?.replace(/^sha256:/, ''); const declared = entry.package.sha256;
      check(!githubDigest || !declared || githubDigest === declared, 'Package digest metadata disagrees.');
      const expected = githubDigest || declared; check(expected && /^[a-f0-9]{64}$/.test(expected), 'Release package requires a SHA-256 digest.');
      const bytes = await this.request(`${API}/repos/${repository.slug}/releases/assets/${asset.id}`, true, source.release.id);
      digest = await sha256(bytes); check(digest === expected, 'Release package failed SHA-256 verification.'); files = unpackPlugin(bytes);
    } else {
      const manifestPath = path(entry.package.manifest); const root = manifestPath.split('/').slice(0, -1).join('/');
      const manifestBytes = await this.sourceFile(repository, source.commit, manifestPath);
      check(manifestBytes.length <= LIMITS.metadata, 'Manifest too large.');
      const manifest = parseManifest(JSON.parse(text(manifestBytes)), entry);
      files = Object.create(null); files['tinycad-plugin.json'] = manifestBytes;
      let size = manifestBytes.length;
      for (const file of manifest.files) {
        const data = await this.sourceFile(repository, source.commit, root ? `${root}/${file}` : file);
        size += data.length; check(size <= LIMITS.package, 'Package exceeds size limit.'); files[file] = data;
      }
      digest = '';
    }
    return verifyPackage(files, source, digest);
  }
}
export async function verifyPackage(files: Record<string, Uint8Array>, source: PluginVersion, digest = ''): Promise<PluginPackage> {
  check(files['tinycad-plugin.json'] && files['tinycad-plugin.json'].length <= LIMITS.metadata, 'Plugin manifest is missing or oversized.');
  const manifest = parseManifest(JSON.parse(text(files['tinycad-plugin.json'])), source.entry);
  const allowed = new Set(['tinycad-plugin.json', ...manifest.files]); const hashes: Record<string, string> = Object.create(null); let size = 0;
  for (const file of Object.keys(files).sort()) {
    path(file); check(allowed.has(file), `Undeclared package resource: ${file}`); check(files[file].length <= LIMITS.file, 'Resource too large.');
    size += files[file].length; check(size <= LIMITS.package, 'Package too large.'); hashes[file] = await sha256(files[file]);
  }
  for (const file of allowed) check(files[file], `Missing package resource: ${file}`);
  if (!digest) digest = await sha256(JSON.stringify(Object.keys(hashes).sort().map(file => [file, files[file].length, hashes[file]])));
  return { manifest, source, files, digest, fileHashes: hashes };
}
export const githubPlugins = new GitHubPluginSource();
