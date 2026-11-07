import { satisfies, valid, validRange } from 'semver';
import { CatalogEntry, PluginCatalog, PluginContext, PluginManifest, PLUGIN_API_VERSION, Platform } from './types';

export const LIMITS = { file: 32 * 1024 * 1024, package: 128 * 1024 * 1024, files: 512, metadata: 1024 * 1024, rpc: 4 * 1024 * 1024 };
export const ID = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/;
export const PERMISSIONS = new Set([
  'document.read', 'document.write', 'netlist.read', 'symbols.read', 'symbols.write',
  'extensionData.write', 'libraries.provide', 'files.read', 'files.write', 'desktop.tools',
]);
export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function path(value: unknown): string {
  check(typeof value === 'string' && value.length > 0 && value.length <= 240, 'Invalid package path.');
  check(!/[\\\x00-\x1f:#?%]/.test(value) && !value.startsWith('/'), `Unsafe package path: ${value}`);
  check(value.split('/').every(part => !!part && part !== '.' && part !== '..'), `Unsafe package path: ${value}`);
  return value;
}
export function resolvePath(base: string, relative: string): string {
  const parts = base.split('/').slice(0, -1);
  for (const part of relative.split('/')) {
    if (part === '..') { check(parts.length, 'Link escapes the plugin package.'); parts.pop(); }
    else if (part !== '.' && part) parts.push(part);
  }
  return path(parts.join('/'));
}
function object(value: any): asserts value is Record<string, any> {
  check(value && typeof value === 'object' && !Array.isArray(value), 'Expected an object.');
}
function text(value: unknown, name: string, max = 500): asserts value is string {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `Invalid ${name}.`);
}
function metadata(value: any) {
  object(value); check(ID.test(value.id), 'Invalid plugin ID.');
  text(value.name, 'name', 100); text(value.description, 'description', 1000);
  check(!!valid(value.version), 'Plugin version must be semantic versioning.');
  check(typeof value.apiVersion === 'string' && !!validRange(value.apiVersion), 'Invalid API version range.');
  check(Array.isArray(value.platforms) && value.platforms.length > 0 && value.platforms.every((p: any) => p === 'browser' || p === 'electron'), 'Invalid platforms.');
  for (const field of ['readme', 'changelog', 'documentation']) {
    check(path(value[field]).toLowerCase().endsWith('.md'), `${field} must reference Markdown.`);
  }
}
export function parseCatalog(value: unknown): PluginCatalog {
  object(value); check(value.catalogVersion === 1, 'Unsupported plugin catalog version.');
  check(Array.isArray(value.plugins) && value.plugins.length > 0 && value.plugins.length <= 100, 'Invalid plugin catalog.');
  const ids = new Set<string>();
  for (const entry of value.plugins) {
    metadata(entry); check(!ids.has(entry.id), `Duplicate plugin ID: ${entry.id}`); ids.add(entry.id);
    object(entry.package);
    if (entry.package.type === 'releaseAsset') {
      text(entry.package.asset, 'asset name', 200);
      check(!/[\/\\]/.test(entry.package.asset), 'Asset must be a filename.');
      if (entry.package.sha256 !== undefined) check(/^[a-f0-9]{64}$/.test(entry.package.sha256), 'Invalid package SHA-256.');
    } else { check(entry.package.type === 'source', 'Unsupported package type.'); path(entry.package.manifest); }
  }
  return value as PluginCatalog;
}
export function compatible(value: { apiVersion: string; platforms: Platform[] }, platform: Platform) {
  return value.platforms.includes(platform) && satisfies(PLUGIN_API_VERSION, value.apiVersion);
}
const contextKeys = new Set(['platform', 'editorKind', 'hasSelection', 'documentWritable', 'activeViewType', 'documentOpen']);
/** A deliberately small parser: no eval, object access, function calls, or user code. */
export function evaluate(expression: string | undefined, context: PluginContext): boolean {
  if (!expression) return true;
  check(typeof expression === 'string' && expression.length <= 500, 'Invalid condition.');
  const tokens: string[] = [];
  const token = /\s*(&&|\|\||===|!==|==|!=|!|\(|\)|'(?:[^'\\]|\\['\\])*'|"(?:[^"\\]|\\["\\])*"|[a-zA-Z][a-zA-Z0-9]*|\d+)\s*/gy;
  let index = 0;
  while (index < expression.length) {
    token.lastIndex = index; const match = token.exec(expression);
    check(match, 'Unsupported condition syntax.'); tokens.push(match[1]); index = token.lastIndex;
  }
  let position = 0;
  const atom = (): any => {
    const t = tokens[position++]; check(t !== undefined, 'Incomplete condition.');
    if (t === '!') return !atom();
    if (t === '(') { const result = or(); check(tokens[position++] === ')', 'Unclosed condition.'); return result; }
    if (t === 'true' || t === 'false') return t === 'true';
    if (/^['"]/.test(t)) return t.slice(1, -1).replace(/\\(['"\\])/g, '$1');
    if (/^\d+$/.test(t)) return Number(t);
    check(contextKeys.has(t), `Unknown condition key: ${t}`); return context[t];
  };
  const equal = (): any => {
    let result = atom(); const op = tokens[position];
    if (['==', '!=', '===', '!=='].includes(op)) {
      position++; const rhs = atom(); result = op.includes('!') ? result !== rhs : result === rhs;
    }
    return result;
  };
  const and = (): any => { let result = equal(); while (tokens[position] === '&&') { position++; const rhs = equal(); result = result && rhs; } return result; };
  const or = (): any => { let result = and(); while (tokens[position] === '||') { position++; const rhs = and(); result = result || rhs; } return result; };
  const result = or(); check(position === tokens.length, 'Unexpected condition token.'); return !!result;
}
export function parseManifest(value: unknown, entry?: CatalogEntry): PluginManifest {
  object(value); metadata(value); check(value.manifestVersion === 1, 'Unsupported manifest version.');
  check(Array.isArray(value.files) && value.files.length <= LIMITS.files, 'Invalid resource list.');
  const files = new Set(value.files.map(path)); check(files.size === value.files.length, 'Duplicate resource paths.');
  for (const field of ['controller', 'readme', 'changelog', 'documentation', ...(value.ui ? ['ui'] : [])]) {
    check(files.has(path(value[field])), `Undeclared ${field} resource.`);
  }
  check(Array.isArray(value.permissions) && value.permissions.length <= 50, 'Invalid permissions.');
  for (const permission of value.permissions) {
    check(typeof permission === 'string', 'Invalid permission.');
    if (permission.startsWith('network:')) {
      const url = new URL(permission.slice(8)); check(url.protocol === 'https:' && url.origin === permission.slice(8), 'Network grants require an exact HTTPS origin.');
    } else check(PERMISSIONS.has(permission), `Unknown permission: ${permission}`);
  }
  check(!value.activationEvents || (Array.isArray(value.activationEvents) && value.activationEvents.every((e: any) => typeof e === 'string')), 'Invalid activation events.');
  const contributes = value.contributes || {}; object(contributes);
  const ids = new Set<string>();
  const collections = ['commands', 'panels', 'symbolEditorTabs', 'mainViews', 'menus', 'toolbars', 'toolbarItems', 'libraryProviders', 'dataSchemas'];
  for (const key of Object.keys(contributes)) check(collections.includes(key), `Unknown contribution: ${key}`);
  for (const key of collections) {
    const items = contributes[key] || []; check(Array.isArray(items) && items.length <= 100, `Invalid ${key}.`);
    for (const item of items) {
      object(item);
      if (item.id !== undefined) {
        check(typeof item.id === 'string' && item.id.startsWith(value.id + '.') && ID.test(item.id), 'Contribution ID must belong to its plugin.');
        check(!ids.has(item.id), `Duplicate contribution ID: ${item.id}`); ids.add(item.id);
      }
      if (['commands', 'panels', 'symbolEditorTabs', 'mainViews', 'toolbars', 'libraryProviders'].includes(key)) {
        check(!!item.id, `Missing ${key} ID.`); text(item.title, 'contribution title', 100);
      }
      if (['panels', 'symbolEditorTabs', 'mainViews'].includes(key)) {
        text(item.surface, 'surface ID', 100); check(!!value.ui, 'Surface contributions require a UI bundle.');
      }
      if (key === 'panels') check(['left', 'bottom'].includes(item.location), 'Invalid panel location.');
      if (key === 'mainViews') check(['application', 'document'].includes(item.scope), 'Invalid view scope.');
      if (key === 'menus') check(/^(file\/(import|export)|edit\/plugins|view\/(panels|main)|tools\/plugins|help\/plugins|context\/(editor|symbol))$/.test(item.location), 'Unknown menu slot.');
      if (item.order !== undefined) check(Number.isFinite(item.order), 'Invalid contribution order.');
      if (item.platforms) check(Array.isArray(item.platforms) && item.platforms.every((p: any) => ['browser', 'electron'].includes(p)), 'Invalid contribution platforms.');
      evaluate(item.when, {}); evaluate(item.enablement, {});
    }
  }
  const commands = new Set((contributes.commands || []).map((c: any) => c.id));
  const toolbars = new Set(['main/plugins', 'schematic/plugins', 'symbol/plugins', ...(contributes.toolbars || []).map((t: any) => t.id)]);
  for (const item of [...(contributes.menus || []), ...(contributes.toolbarItems || [])]) check(commands.has(item.command), 'Menu/toolbar refers to an undeclared command.');
  for (const item of contributes.toolbarItems || []) check(toolbars.has(item.toolbar), 'Unknown toolbar.');
  for (const schema of contributes.dataSchemas || []) {
    check(['document', 'sheet', 'symbolDefinition', 'symbolInstance', 'library', 'libraryName'].includes(schema.scope) && Number.isInteger(schema.version) && schema.version > 0, 'Invalid extension data schema.');
  }
  if (entry) for (const field of ['id', 'version', 'description', 'readme', 'changelog', 'documentation', 'apiVersion', 'platforms']) {
    check(JSON.stringify(value[field]) === JSON.stringify((entry as any)[field]), `Catalog/manifest ${field} mismatch.`);
  }
  return value as PluginManifest;
}
export async function sha256(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource))).map(b => b.toString(16).padStart(2, '0')).join('');
}
export function canonicalRepository(input: string): { url: string; slug: string } {
  const u = new URL(input.trim());
  check(u.protocol === 'https:' && u.hostname === 'github.com' && !u.port && !u.username && !u.password && !u.search && !u.hash, 'Enter an HTTPS GitHub repository URL.');
  const parts = u.pathname.replace(/\/$/, '').replace(/\.git$/, '').split('/').filter(Boolean);
  check(parts.length === 2 && parts.every(p => /^[a-zA-Z0-9_.-]+$/.test(p) && p !== '.' && p !== '..'), 'Enter a repository URL, without /tree or /releases.');
  const slug = parts.join('/').toLowerCase(); return { url: `https://github.com/${slug}`, slug };
}
