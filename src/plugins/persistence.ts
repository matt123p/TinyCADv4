import type { ExtensionOwner } from './types';
import type { dsnDrawing, libSymbol } from '../model/dsnDrawing';
import type { DocItem } from '../model/dsnItem';
import type { tclib } from '../model/tclib';
import { XMLBuilder } from '../util/xmlbuilder';

const NS = 'https://www.tinycad.net/plugin-data/1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const newIdentity = () => globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16);
});
export function ensureDrawingIds(drawing: dsnDrawing): dsnDrawing {
  const seen = new Set<string>();
  const identify = <T extends ExtensionOwner>(owner: T): T => {
    if (owner.persistentId && !seen.has(owner.persistentId)) { seen.add(owner.persistentId); return owner; }
    const id = newIdentity(); seen.add(id); return { ...owner, persistentId: id };
  };
  const definitions = new Map<libSymbol, libSymbol>();
  const items = (list: DocItem[]): DocItem[] => {
    let changed = false;
    const result = list.map(original => {
      let item = identify(original);
      if (item.NodeName === 'symbol' && item._symbol) {
        const definition = normalizeDefinition(item._symbol);
        if (definition !== item._symbol) item = { ...item, _symbol: definition };
      }
      if (item !== original) changed = true; return item;
    });
    return changed ? result : list;
  };
  const normalizeDefinition = (original: libSymbol): libSymbol => {
    if (definitions.has(original)) return definitions.get(original)!;
    let definition = original.persistentId ? original : { ...original, persistentId: newIdentity() };
    definitions.set(original, definition);
    const outlines = definition.outlines.map(outline => { const normalized = items(outline.items); return normalized === outline.items ? outline : { ...outline, items: normalized }; });
    if (outlines.some((outline, i) => outline !== definition.outlines[i])) definition = { ...definition, outlines };
    definitions.set(original, definition); return definition;
  };
  const root = identify(drawing);
  const sheets = root.sheets.map(original => {
    const sheet = identify(original);
    const symbols = Object.fromEntries(Object.entries(sheet.symbols).map(([id, definition]) => [id, normalizeDefinition(definition)]));
    const normalized = items(sheet.items);
    const symbolsChanged = Object.keys(symbols).some(id => symbols[id] !== sheet.symbols[id]);
    return normalized === sheet.items && !symbolsChanged ? sheet : { ...sheet, items: normalized, symbols };
  });
  return sheets.some((sheet, i) => sheet !== root.sheets[i]) ? { ...root, sheets } : root;
}
export function copyOwnerIdentity<T extends ExtensionOwner>(owner: T): T { return { ...owner, persistentId: newIdentity() }; }
export function ensureLibraryIds(library: tclib): tclib {
  const seen = new Set<string>();
  const identify = <T extends ExtensionOwner>(owner: T): T => {
    if (owner.persistentId && !seen.has(owner.persistentId)) { seen.add(owner.persistentId); return owner; }
    const id = newIdentity(); seen.add(id); return { ...owner, persistentId: id };
  };
  const root = identify(library); const names = root.names.map(identify); const symbols = root.symbols.map(identify);
  return names.some((name, i) => name !== root.names[i]) || symbols.some((symbol, i) => symbol !== root.symbols[i]) ? { ...root, names, symbols } : root;
}
function serialize(node: any): string {
  // A detached document avoids serializing siblings; importNode is provided by common-xml-features.
  const target = new XMLBuilder(); target.createDoc('ROOT');
  target.insert.appendChild(target.xmlDoc.importNode(node, true));
  return target.tostring().replace(/^[\s\S]*?<ROOT>/, '').replace(/<\/ROOT>\s*$/, '');
}
export function readExtensionOwner(node: any): ExtensionOwner {
  const rawId = node?.getAttribute?.('tc:uid');
  const owner: ExtensionOwner = { persistentId: UUID.test(rawId || '') ? rawId : newIdentity() };
  for (const container of Array.from(node?.childNodes || []) as any[]) {
    if (container.nodeName !== 'PLUGIN_DATA') continue;
    if (container.getAttribute('format') !== '1') { (owner.pluginDataXml ||= []).push(serialize(container)); continue; }
    for (const child of Array.from(container.childNodes || []) as any[]) {
      if (child.nodeType !== 1) continue;
      const id = child.getAttribute('id'); const schema = Number(child.getAttribute('schema')); const encoding = child.getAttribute('encoding');
      if (child.nodeName !== 'PLUGIN' || !id || !Number.isInteger(schema) || schema < 1 || !encoding || owner.pluginData?.[id]) {
        (owner.pluginDataXml ||= []).push(`<PLUGIN_DATA format="1">${serialize(child)}</PLUGIN_DATA>`); continue;
      }
      let payload = ''; for (const n of Array.from(child.childNodes || []) as any[]) if (n.nodeType === 3 || n.nodeType === 4) payload += n.nodeValue;
      const hasUnknownAttributes = Array.from(child.attributes || []).some((attribute: any) => !['id', 'schema', 'encoding'].includes(attribute.name));
      const hasElements = Array.from(child.childNodes || []).some((node: any) => node.nodeType === 1);
      (owner.pluginData ||= Object.create(null))[id] = { schema, encoding, payload, ...(hasUnknownAttributes || hasElements ? { rawXml: serialize(child) } : {}) };
    }
  }
  return owner;
}
export function writeExtensionOwner(root: XMLBuilder, owner: ExtensionOwner) {
  if (owner.persistentId) { root.insert.setAttribute('xmlns:tc', NS); root.insert.setAttribute('tc:uid', owner.persistentId); }
  const entries = Object.entries(owner.pluginData || {});
  if (entries.length) {
    const container = root.appendChild('PLUGIN_DATA', undefined, { format: '1' });
    for (const [id, envelope] of entries) {
      if (envelope.rawXml) {
        const parsed = new XMLBuilder(); parsed.fromText(envelope.rawXml);
        container.insert.appendChild(container.xmlDoc.importNode(parsed.xmlDoc.documentElement, true));
      } else container.appendChild('PLUGIN', envelope.payload, { id, schema: envelope.schema, encoding: envelope.encoding });
    }
  }
  for (const raw of owner.pluginDataXml || []) {
    const parsed = new XMLBuilder(); parsed.fromText(raw);
    const node = parsed.xmlDoc.documentElement || parsed.xmlDoc.childNodes[0];
    if (node?.nodeName === 'PLUGIN_DATA') root.insert.appendChild(root.xmlDoc.importNode(node, true));
  }
}
