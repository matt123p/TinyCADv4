import { DocItem, DocItemTypes, dsnPin, dsnSymbol, dsnText } from '../model/dsnItem';
import { dsnDrawing, dsnSheet, libSymbol } from '../model/dsnDrawing';
import { tclib, tclibLibraryEntry } from '../model/tclib';
import { updateFactory } from '../manipulators/updateFactory';
import { updateSymbol } from '../manipulators/updateSymbol';
import { updatePin } from '../manipulators/updatePin';
import { updateText } from '../manipulators/updateText';
import { updateView } from '../manipulators/updateView';
import { Snap } from '../manipulators/snap';
import { ioXML } from '../io/ioXml';
import { get_global_id } from '../util/global_id';
import { ExtensionOwner, InstalledPlugin, PluginError } from './types';
import { check, LIMITS } from './validation';
import { ensureDrawingIds, newIdentity } from './persistence';

export function requireGrant(plugin: InstalledPlugin, grant: string) {
  if (!plugin.grants.includes(grant)) throw new PluginError('PermissionDenied', `Plugin requires ${grant} permission.`);
}
export function exportedCoreCommand(plugin: InstalledPlugin, commandId: string, libraryMode: boolean): string {
  const commands: Record<string, { command: string; grant: string }> = {
    'core.file.save': { command: 'file-save', grant: 'files.write' }, 'core.file.open': { command: 'file-open', grant: 'files.read' },
    'core.file.new': { command: 'file-new', grant: 'document.write' },
    'core.edit.undo': { command: 'edit-undo', grant: libraryMode ? 'symbols.write' : 'document.write' },
    'core.edit.redo': { command: 'edit-redo', grant: libraryMode ? 'symbols.write' : 'document.write' },
    'core.view.zoomIn': { command: 'view-zoom-in', grant: 'document.read' }, 'core.view.zoomOut': { command: 'view-zoom-out', grant: 'document.read' },
    'core.tools.bom': { command: 'tools-bom', grant: 'document.read' },
  };
  const command = commands[commandId]; check(command, 'Core command is not exported.'); requireGrant(plugin, command.grant); return command.command;
}
function string(value: any, max = 10000): string { check(typeof value === 'string' && value.length <= max, 'Invalid text value.'); return value; }
function point(value: any): [number, number] {
  check(Array.isArray(value) && value.length === 2 && value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e7), 'Invalid coordinate.'); return [value[0], value[1]];
}
function integer(value: any, max: number) { check(Number.isInteger(value) && value >= 0 && value <= max, 'Invalid numeric value.'); return value; }
export function ownerTarget(drawing: dsnDrawing, library: tclib, symbol: tclibLibraryEntry, scope: string, targetId?: string): ExtensionOwner {
  if (scope === 'document') return drawing;
  if (scope === 'library') { check(library, 'No library is being edited.'); return library; }
  if (scope === 'libraryName') { const name = targetId ? library?.names.find(n => n.persistentId === targetId) : symbol; check(name, 'Library name is unavailable.'); return name; }
  if (scope === 'symbolDefinition' && library && symbol) {
    const definition = library.symbols.find(s => s.persistentId === targetId || (!targetId && s.SymbolId === symbol.SymbolID));
    check(definition, 'Symbol definition is unavailable.'); return definition;
  }
  if (scope === 'sheet') { const sheet = drawing.sheets.find(s => s.persistentId === targetId); check(sheet, 'Sheet is unavailable.'); return sheet; }
  for (const sheet of drawing.sheets) for (const item of sheet.items) {
    if (scope === 'symbolInstance' && item.NodeName === DocItemTypes.Symbol && item.persistentId === targetId) return item;
    if (scope === 'symbolDefinition' && item.NodeName === DocItemTypes.Symbol && item._symbol.persistentId === targetId) return item._symbol;
  }
  throw new Error('Extension data target is unavailable.');
}
function replaceOwner(drawing: dsnDrawing, library: tclib, symbol: tclibLibraryEntry, old: ExtensionOwner, next: ExtensionOwner) {
  let nextSymbol = symbol; let nextLibrary = library;
  if (old === library) nextLibrary = next as tclib;
  if (library?.names.includes(old as tclibLibraryEntry)) {
    nextLibrary = { ...library, names: library.names.map(n => n === old ? next as tclibLibraryEntry : n) };
    if (symbol === old) nextSymbol = next as tclibLibraryEntry;
  }
  if (library?.symbols.includes(old as any)) nextLibrary = { ...library, symbols: library.symbols.map(s => s === old ? next as any : s) };
  if (old === drawing) return { drawing: next as dsnDrawing, library: nextLibrary, symbol: nextSymbol };
  const nextDrawing = { ...drawing, sheets: drawing.sheets.map(sheet => {
    if (sheet === old) return next as dsnSheet;
    return { ...sheet,
      symbols: Object.fromEntries(Object.entries(sheet.symbols).map(([key, definition]) => [key,
        definition === old || (old.persistentId && definition.persistentId === old.persistentId) ? next as libSymbol : definition,
      ])),
      items: sheet.items.map(item => {
      if (item === old) return next as DocItem;
      if (item.NodeName === DocItemTypes.Symbol && (item._symbol === old || (old.persistentId && item._symbol.persistentId === old.persistentId))) return { ...item, _symbol: next as libSymbol };
      return item;
    }) };
  }) };
  return { drawing: nextDrawing, library: nextLibrary, symbol: nextSymbol };
}
export function editExtension(plugin: InstalledPlugin, drawing: dsnDrawing, library: tclib, symbol: tclibLibraryEntry, operation: any) {
  requireGrant(plugin, 'extensionData.write'); const scope = operation.scope || 'document';
  requireGrant(plugin, ['library', 'libraryName', 'symbolDefinition'].includes(scope) ? 'symbols.read' : 'document.read');
  const owner = ownerTarget(drawing, library, symbol, scope, operation.targetId);
  const declared = plugin.current.manifest.contributes?.dataSchemas?.find(s => s.scope === scope);
  check(declared, 'Plugin did not declare a data schema for this scope.');
  const existing = owner.pluginData?.[plugin.id];
  check(!owner.pluginDataXml?.some(raw => raw.includes(plugin.id)), 'Conflicting or unsupported XML for this plugin is read-only.');
  check(!existing || (existing.encoding === 'json' && existing.schema <= declared.version), 'A newer or unsupported extension schema is read-only.');
  const data = { ...owner.pluginData };
  if (operation.type === 'deleteExtensionData') delete data[plugin.id];
  else {
    const schema = operation.schema || declared.version; check(schema === declared.version, 'Data schema must match the plugin declaration.');
    const payload = JSON.stringify(operation.data); check(typeof payload === 'string' && payload.length <= LIMITS.metadata, 'Invalid or oversized extension data.');
    data[plugin.id] = { schema, encoding: 'json', payload };
  }
  return replaceOwner(drawing, library, symbol, owner, { ...owner, pluginData: data });
}
export function createProviderDefinition(spec: any, id: number): libSymbol {
  check(spec && typeof spec === 'object', 'Library provider returned an invalid symbol.');
  const name = string(spec.name, 200); const reference = string(spec.reference || 'U?', 100);
  check(Array.isArray(spec.pins) && spec.pins.length <= 1000 && Array.isArray(spec.graphics || []) && (spec.graphics || []).length <= 1000, 'Invalid symbol geometry.');
  const items: DocItem[] = [];
  for (const pin of spec.pins) {
    const model: dsnPin = { NodeName: DocItemTypes.Pin, _id: get_global_id(), persistentId: newIdentity(), point: point(pin.point), name: string(pin.name, 100), number: string(pin.number, 100),
      rotation: integer(pin.rotation || 0, 3), length: pin.length === undefined ? 20 : integer(pin.length, 1000), part: 0, elec: integer(pin.electricalType || 0, 12), which: 0,
      show_name: true, show_number: true, number_pos: 0, centre_name: false, font_name: 'Arial', font_size: 8, font_bold: false, font_italic: false, font_colour: '#000000', textData: null };
    items.push(new updatePin(model).post_construction());
  }
  for (const graphic of spec.graphics || []) {
    check(graphic.type === 'rectangle' || graphic.type === 'line', 'Provider graphics support rectangles and lines.');
    const base = { _id: get_global_id(), persistentId: newIdentity(), stroked: true, filled: false, line_colour: '#000000', line_width: 1, line_pattern: 0, fill_colour: '#ffffff', hatch: 0 };
    if (graphic.type === 'rectangle') items.push({ ...base, NodeName: DocItemTypes.Rectangle, point: point(graphic.a), point_b: point(graphic.b) });
    else items.push({ ...base, NodeName: DocItemTypes.Line, d_points: [point(graphic.a), point(graphic.b)], polygon: false });
  }
  check(items.length > 0, 'Provider symbol has no geometry.');
  return { id, persistentId: newIdentity(), uid: string(spec.uid || newIdentity(), 200), name: { value: name, type: 0 }, ref: { value: reference, type: 0 },
    description: string(spec.description || '', 1000), parts: 1, heterogeneous: false,
    outlines: [new ioXML().normalize_symbol(items, new Snap(5, true), [0, 0], false, false)] };
}
function placedSymbol(definition: libSymbol, location: [number, number]): dsnSymbol {
  const item = { NodeName: DocItemTypes.Symbol, _id: get_global_id(), persistentId: newIdentity(), point: location, show_power: false, allow_resize: false,
    scale_x: 1, scale_y: 1, part: 0, rotation: 0, _symbol: definition,
    text: [{ description: 'Name', value: definition.name.value, position: [5, 5], display: 0, show: true }, { description: 'Ref', value: definition.ref.value, position: [5, 15], display: 0, show: true }],
    hints: [], font_name: 'Arial', font_colour: '#ff0000', font_bold: false, font_italic: false, font_size: 10, textData: [], _active_points: null } as dsnSymbol;
  return new updateSymbol(item).post_construction();
}
/** Fully build a new state before dispatching one undoable transaction. */
export function prepareEdits(plugin: InstalledPlugin, initial: { drawing: dsnDrawing; library: tclib; symbol: tclibLibraryEntry; activeSheetId?: string }, operations: any[]) {
  check(Array.isArray(operations) && operations.length > 0 && operations.length <= 1000, 'Invalid edit batch.');
  let { drawing, library, symbol } = initial;
  const created: string[] = [];
  for (const operation of operations) {
    check(operation && typeof operation.type === 'string', 'Invalid edit operation.');
    if (operation.type === 'setExtensionData' || operation.type === 'deleteExtensionData') {
      ({ drawing, library, symbol } = editExtension(plugin, drawing, library, symbol, operation)); continue;
    }
    requireGrant(plugin, library ? 'symbols.write' : 'document.write');
    if (operation.type === 'setLibraryAttributes') {
      check(symbol && library, 'No library symbol is being edited.');
      const attributes = operation.attributes; check(attributes && typeof attributes === 'object' && Object.keys(attributes).length <= 100, 'Invalid attributes.');
      const next = symbol.Attributes.filter(a => !Object.prototype.hasOwnProperty.call(attributes, a.AttName));
      for (const [key, value] of Object.entries(attributes)) { string(key, 200); next.push({ AttName: key, AttValue: string(value), ShowAtt: 1 }); }
      symbol = { ...symbol, Attributes: next }; library = { ...library, names: library.names.map(n => n.NameID === symbol!.NameID ? symbol! : n) }; continue;
    }
    const targetSheetId = operation.sheetId || initial.activeSheetId;
    const sheetIndex = targetSheetId ? drawing.sheets.findIndex(s => s.persistentId === targetSheetId) : 0;
    check(sheetIndex >= 0, 'Sheet is unavailable.'); let sheet = drawing.sheets[sheetIndex]; let items = sheet.items.slice();
    const index = operation.id ? items.findIndex(item => item.persistentId === operation.id) : -1;
    if (['delete', 'move', 'setAttributes', 'setPin'].includes(operation.type)) check(index >= 0, 'Target item is unavailable.');
    if (operation.type === 'delete') items.splice(index, 1);
    else if (operation.type === 'move') {
      const delta = point(operation.delta); items[index] = updateFactory(items[index]).relative_move([-delta[0], -delta[1]]);
    } else if (operation.type === 'setAttributes') {
      const item = items[index]; check(item.NodeName === DocItemTypes.Symbol, 'Attributes require a placed symbol.');
      check(operation.attributes && typeof operation.attributes === 'object' && Object.keys(operation.attributes).length <= 100, 'Invalid symbol attributes.');
      const attributes = item.text.map(t => ({ ...t }));
      for (const [key, value] of Object.entries(operation.attributes)) {
        string(key, 200); const found = attributes.find(a => a.description === key);
        if (found) found.value = string(value); else attributes.push({ description: key, value: string(value), position: [5, 5 + attributes.length * 10], display: 1, show: false });
      }
      items[index] = new updateSymbol({ ...item, text: attributes }).post_construction();
    } else if (operation.type === 'setPin') {
      check(library && items[index].NodeName === DocItemTypes.Pin, 'Pin edits require the symbol editor.');
      const item = items[index] as dsnPin;
      items[index] = new updatePin({ ...item, name: operation.name === undefined ? item.name : string(operation.name, 100), number: operation.number === undefined ? item.number : string(operation.number, 100), elec: operation.electricalType === undefined ? item.elec : integer(operation.electricalType, 12) }).post_construction();
    } else if (operation.type === 'insertWire') {
      const a = point(operation.a); const b = point(operation.b); check(a[0] !== b[0] || a[1] !== b[1], 'Wire must have length.');
      items.push({ NodeName: DocItemTypes.Wire, _id: get_global_id(), persistentId: newIdentity(), d_points: [a, b], line_colour: '#000000', line_width: 1, _magnetic: null });
    } else if (operation.type === 'insertText') {
      const a = point(operation.point); const text = string(operation.text);
      const item = { NodeName: DocItemTypes.Text, _id: get_global_id(), persistentId: newIdentity(), point: a, point_b: [a[0] + 100, a[1] + 30], text, rotation: 0,
        font_name: 'Arial', font_size: 10, font_bold: false, font_italic: false, font_colour: '#000000', stroked: false, filled: false, line_colour: '#000000', fill_colour: '#ffffff', line_width: 1, line_pattern: 0, hatch: 0, textData: null } as dsnText;
      items.push(new updateText(item).post_construction() as DocItem);
    } else if (operation.type === 'insertSymbol') {
      let definition: libSymbol;
      if (operation.definitionId) {
        definition = drawing.sheets.flatMap(s => s.items).filter((i): i is dsnSymbol => i.NodeName === DocItemTypes.Symbol).map(i => i._symbol).find(s => s.persistentId === operation.definitionId)!;
        check(definition, 'Symbol definition is unavailable.');
      } else {
        const nextId = Math.max(0, ...Object.keys(sheet.symbols).map(Number)) + 1;
        definition = createProviderDefinition(operation.symbol, nextId); sheet = { ...sheet, symbols: { ...sheet.symbols, [nextId]: definition } };
      }
      const item = placedSymbol(definition, point(operation.point)); items.push(item); created.push(item.persistentId!);
    } else throw new Error('Unknown edit operation: ' + operation.type);
    sheet = new updateView().tidy_wires({ ...sheet, items });
    drawing = { ...drawing, sheets: drawing.sheets.map((s, i) => i === sheetIndex ? sheet : s) };
  }
  return { drawing: ensureDrawingIds(drawing), library, symbol, created };
}
