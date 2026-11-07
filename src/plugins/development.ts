import { verifyPackage } from './github';
import type { CatalogEntry, DevelopmentSource, PluginPackage, PluginVersion } from './types';
import { check, LIMITS, parseCatalog, parseManifest, path, sha256 } from './validation';

type Reader = (file: string, optional?: boolean) => Promise<Uint8Array | undefined>;
const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
const manifestName = 'tinycad-plugin.json';
const catalogName = 'tinycad-plugins.json';

/** Development HTTP is deliberately restricted to loopback; GitHub downloads keep their own rules. */
export function developmentURL(input: string): URL {
  const url = new URL(input);
  check(['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    && !url.username && !url.password && !url.search && !url.hash, 'Use a local server URL such as http://localhost:8080/, without credentials, query, or fragment.');
  check(!/%|\\/.test(url.pathname), 'Encoded or backslash server paths are unsupported.');
  return url;
}

async function serverReader(root: string): Promise<Reader> {
  developmentURL(root);
  return async (file, optional = false) => {
    path(file); const url = new URL(file.split('/').map(encodeURIComponent).join('/'), root);
    if (window.electronAPI?.pluginDevelopmentDownload) {
      const bytes = await window.electronAPI.pluginDevelopmentDownload(url.href);
      if (bytes === null && optional) return undefined;
      check(bytes !== null, `Missing development resource: ${file}`); return new Uint8Array(bytes);
    }
    let response: Response;
    try { response = await fetch(url.href, { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) }); }
    catch { throw new Error('Cannot reach the local plugin server. Check its address, CORS headers, and browser local-network permission.'); }
    if (response.status === 404 && optional) return undefined;
    check(response.ok, `Development resource ${file} failed (${response.status}).`);
    check(Number(response.headers.get('content-length') || 0) <= LIMITS.file, 'Development resource too large.');
    const reader = response.body?.getReader(); check(reader, 'Development resource has no body.');
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length;
      if (size > LIMITS.file) { await reader.cancel(); throw new Error('Development resource too large.'); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  };
}

async function readMetadata(read: Reader, file: string, optional = false) {
  const bytes = await read(file, optional);
  if (!bytes) return undefined;
  check(bytes.length <= LIMITS.metadata, 'Development metadata too large.');
  return { bytes, value: decode(bytes) };
}

/** Read only declared resources; unrelated repository files are never packaged or executed. */
async function load(read: Reader, source: PluginVersion): Promise<PluginPackage> {
  check(source.development, 'Missing development source.');
  const file = path(source.development.manifest); const root = file.split('/').slice(0, -1).join('/');
  const metadata = await readMetadata(read, file); check(metadata, 'Plugin manifest is missing.');
  const manifest = parseManifest(metadata.value, source.entry);
  const files: Record<string, Uint8Array> = Object.create(null); files[manifestName] = metadata.bytes;
  let size = metadata.bytes.length;
  for (const resource of manifest.files) {
    const bytes = await read(root ? `${root}/${resource}` : resource); check(bytes, `Missing plugin resource: ${resource}`);
    size += bytes.length; check(size <= LIMITS.package, 'Development package too large.'); files[resource] = bytes;
  }
  const pkg = await verifyPackage(files, source);
  // A content identity distinguishes development snapshots that share a semantic version.
  pkg.source = { ...source, commit: pkg.digest };
  return pkg;
}

async function discover(read: Reader, origin: DevelopmentSource, explicitManifest = false): Promise<PluginVersion[]> {
  const catalog = explicitManifest ? undefined : await readMetadata(read, catalogName, true);
  let entries: CatalogEntry[]; let catalogDigest: string;
  if (catalog) {
    entries = parseCatalog(catalog.value).plugins; catalogDigest = await sha256(catalog.bytes);
    check(entries.every(entry => entry.package.type === 'source'), 'Local catalogs must use source packages, not release assets.');
  } else {
    const metadata = await readMetadata(read, manifestName); check(metadata, 'Select a folder containing tinycad-plugin.json or tinycad-plugins.json.');
    const manifest = parseManifest(metadata.value);
    entries = [{ ...manifest, package: { type: 'source', manifest: manifestName } }]; catalogDigest = await sha256(metadata.bytes);
  }
  return entries.map(entry => ({ entry, commit: catalogDigest, catalogDigest, development: { ...origin, manifest: (entry.package as { manifest: string }).manifest } }));
}

export class DevelopmentPluginSource {
  private readers = new Map<string, Reader>();
  async server(input: string) {
    const url = developmentURL(input.trim());
    const explicitManifest = url.pathname.endsWith('/' + manifestName);
    if (explicitManifest || url.pathname.endsWith('/' + catalogName)) url.pathname = url.pathname.split('/').slice(0, -1).join('/') + '/';
    else if (!url.pathname.endsWith('/')) url.pathname += '/';
    return discover(await serverReader(url.href), { kind: 'server', url: url.href, manifest: manifestName }, explicitManifest);
  }
  async directory(files: FileList | File[], previous?: DevelopmentSource): Promise<PluginVersion[]> {
    const list = Array.from(files); check(list.length > 0, 'Select a plugin folder.');
    const root = list[0].webkitRelativePath.split('/')[0]; check(root, 'Choose a folder, rather than individual files.');
    if (previous) check(previous.kind === 'directory' && previous.name === root, `Select the original development folder: ${previous.kind === 'directory' ? previous.name : ''}`);
    const id = previous?.kind === 'directory' ? previous.id : crypto.randomUUID();
    const map = new Map<string, File>();
    for (const file of list) {
      check(file.webkitRelativePath.startsWith(root + '/'), 'All files must belong to the selected folder.');
      const relative = file.webkitRelativePath.slice(root.length + 1);
      // Repository checkouts can include node_modules/.git. Only validated, requested paths are read.
      check(!map.has(relative), 'Duplicate folder path.'); map.set(relative, file);
    }
    const reader: Reader = async (file, optional = false) => {
      path(file); const selected = map.get(file);
      if (!selected && optional) return undefined;
      check(selected, `Missing development resource: ${file}`); check(selected.size <= LIMITS.file, 'Development resource too large.');
      return new Uint8Array(await selected.arrayBuffer());
    };
    const versions = await discover(reader, { kind: 'directory', id, name: root, manifest: manifestName });
    this.readers.set(id, reader); return versions;
  }
  async chooseDirectory() {
    const selected = await window.electronAPI.choosePluginDirectory();
    if (!selected) return [];
    return discover(this.electronReader(selected.id), { kind: 'directory', ...selected, manifest: manifestName });
  }
  private electronReader(id: string): Reader {
    return async (file, optional = false) => {
      path(file); const bytes = await window.electronAPI.readPluginDevelopmentFile(id, file);
      if (bytes === null && optional) return undefined;
      check(bytes !== null, `Missing development resource: ${file}`); return new Uint8Array(bytes);
    };
  }
  private async reader(origin: DevelopmentSource): Promise<Reader> {
    if (origin.kind === 'server') return serverReader(origin.url);
    if (window.electronAPI?.readPluginDevelopmentFile) return this.electronReader(origin.id);
    const reader = this.readers.get(origin.id); check(reader, 'Choose the development folder again to reload its files.'); return reader;
  }
  async load(source: PluginVersion) { check(source.development, 'Missing development source.'); return load(await this.reader(source.development), source); }
  async reload(source: PluginVersion) {
    const origin = source.development; check(origin, 'Only development plugins can be reloaded.');
    const reader = await this.reader(origin);
    const metadata = await readMetadata(reader, path(origin.manifest)); check(metadata, 'Plugin manifest is missing.');
    const manifest = parseManifest(metadata.value); check(manifest.id === source.entry.id, 'Reload cannot change the plugin ID.');
    // During iteration the manifest is authoritative; the catalog need not be updated on each edit.
    const entry: CatalogEntry = { ...manifest, package: { type: 'source', manifest: origin.manifest } };
    return load(reader, { ...source, entry, catalogDigest: await sha256(metadata.bytes) });
  }
}
export const developmentPlugins = new DevelopmentPluginSource();
