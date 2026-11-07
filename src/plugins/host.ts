import { ActionCreators } from 'redux-undo';
import type { docDrawing } from '../state/undo/undo';
import { actionSetDocument } from '../state/dispatcher/AppDispatcher';
import { blank, ioXML } from '../io/ioXml';
import { fileSave, librarySave, handleMenuCommand, userManager } from '../io/files';
import { wkrGenerateNetlist } from '../web-worker/worker';
import { writeSpice } from '../io/netlists/netlistSpice';
import { DocItem, DocItemTypes } from '../model/dsnItem';
import { InstalledPlugin, ExtensionOwner, SurfaceContext, PluginError } from './types';
import { check, LIMITS } from './validation';
import { documentSessions } from './sessions';
import { PLUGIN_EDIT, PLUGIN_SELECTION } from './actions';
import { pluginManager, platform } from './manager';
import { exportedCoreCommand, ownerTarget, prepareEdits, requireGrant } from './edits';
import { prompts } from './prompts';
import i18n from '../i18n';

function ownedData(owner: ExtensionOwner, id: string) {
  const envelope = owner.pluginData?.[id]; if (!envelope) return null;
  return { schema: envelope.schema, encoding: envelope.encoding, data: envelope.encoding === 'json' ? JSON.parse(envelope.payload) : null };
}
function itemDto(item: DocItem) {
  const base: any = { id: item.persistentId, type: item.NodeName };
  for (const key of ['point', 'point_b', 'd_points', 'rotation', 'name', 'number', 'elec', 'part']) if ((item as any)[key] !== undefined) base[key] = structuredClone((item as any)[key]);
  if (item.NodeName === DocItemTypes.Symbol) {
    base.definitionId = item._symbol.persistentId; base.name = item._symbol.name.value;
    base.attributes = Object.fromEntries(item.text.map(a => [a.description, a.value]));
    base.definition = { id: item._symbol.persistentId, name: item._symbol.name.value, description: item._symbol.description,
      outlines: item._symbol.outlines.map(o => ({ items: o.items.map(itemDto) })) };
  } else if ('text' in item && typeof item.text === 'string') base.text = item.text;
  return base;
}
export function initializePluginHost(store: { getState(): docDrawing; dispatch(action: any): any; subscribe(listener: () => void): () => void }) {
  documentSessions.saveActive = async () => {
    await store.dispatch(store.getState().docStore.present.editLibrary ? librarySave : fileSave);
  };
  const sessionFor = (params: any, context: SurfaceContext) => documentSessions.get(params.documentId || context.documentId);
  const snapshot = (params: any, context: SurfaceContext) => {
    const session = sessionFor(params, context); const doc = session.state.docStore.present;
    return { id: session.id, persistentId: doc.drawing.persistentId, revision: session.revision, name: session.state.altStore.file?.name || 'Untitled',
      activeSheetId: doc.drawing.sheets[doc.editSymbol && !doc.heterogeneous ? 0 : Math.max(0, doc.view.selected_sheet)]?.persistentId,
      kind: doc.editLibrary ? 'library' : 'schematic',
      sheets: doc.drawing.sheets.map(s => ({ id: s.persistentId, name: s.name, items: s.items.map(itemDto) })) };
  };
  const apply = (plugin: InstalledPlugin, params: any, context: SurfaceContext) => {
    const session = sessionFor(params, context);
    check(session.id === documentSessions.activeId, 'Activate the document before applying edits.');
    if (params.expectedRevision !== session.revision) throw new PluginError('RevisionConflict', 'The document changed. Read a fresh snapshot and retry.');
    const state = store.getState().docStore.present;
    check(!store.getState().altStore.saveInProgress && !state.view.add, 'Finish the active drawing operation/save before applying plugin edits.');
    const activeSheetId = state.drawing.sheets[state.editSymbol && !state.heterogeneous ? 0 : Math.max(0, state.view.selected_sheet)]?.persistentId;
    const result = prepareEdits(plugin, { drawing: state.drawing, library: state.editLibrary, symbol: state.editSymbol, activeSheetId }, params.operations);
    store.dispatch({ type: PLUGIN_EDIT, drawing: result.drawing, library: result.library, symbol: result.symbol, expectedVersion: state.drawingVersion });
    return { revision: documentSessions.get().revision, created: result.created };
  };
  const invoke = async (plugin: InstalledPlugin, method: string, params: any, context: SurfaceContext): Promise<any> => {
    const id = plugin.id;
    if (method === 'editor.getContext') return pluginManager.context();
    if (method === 'documents.list') { requireGrant(plugin, 'document.read'); return documentSessions.list(); }
    if (method === 'documents.getSnapshot') { requireGrant(plugin, 'document.read'); return snapshot(params, context); }
    if (method === 'documents.applyEdits' || method === 'symbols.applyEdits') return apply(plugin, params, context);
    if (method === 'documents.activate') { requireGrant(plugin, 'document.read'); documentSessions.activate(params.documentId); pluginManager.activateView(); return; }
    if (method === 'documents.create') {
      requireGrant(plugin, 'document.write'); check(!store.getState().altStore.saveInProgress, 'A document is being saved.');
      const name = typeof params.name === 'string' && params.name.length <= 200 ? params.name : 'Untitled.dsn';
      store.dispatch(actionSetDocument(blank(), name, null, null)); store.dispatch(ActionCreators.clearHistory()); return documentSessions.activeId;
    }
    if (method === 'documents.open') { requireGrant(plugin, 'files.read'); check(userManager, 'File storage is not initialized.'); userManager.fileOpen(store.dispatch); return; }
    if (method === 'documents.save') {
      requireGrant(plugin, 'files.write'); const session = sessionFor(params, context); documentSessions.activate(session.id);
      await documentSessions.saveActive!(); return { saved: !documentSessions.list().find(s => s.id === session.id)?.dirty };
    }
    if (method === 'documents.close') { requireGrant(plugin, 'document.write'); return documentSessions.close(params.documentId); }
    if (method === 'documents.export') {
      requireGrant(plugin, 'document.read'); requireGrant(plugin, 'files.read'); const session = sessionFor(params, context);
      return { name: session.state.altStore.file?.name, xml: new ioXML().to_dsn(session.state.docStore.present.drawing, true, true).tostring() };
    }
    if (method === 'editor.getSelection') {
      requireGrant(plugin, 'document.read'); const state = store.getState().docStore.present;
      return state.drawing.sheets.flatMap(s => s.items.filter(i => state.view._selected_array.includes(i._id)).map(itemDto));
    }
    if (method === 'editor.select' || method === 'editor.reveal') {
      requireGrant(plugin, 'document.read'); const state = store.getState().docStore.present;
      const ids = method === 'editor.reveal' ? [params.id] : params.ids; check(Array.isArray(ids) && ids.length <= 1000, 'Invalid selection.');
      const index = state.drawing.sheets.findIndex(s => s.items.some(i => ids.includes(i.persistentId)));
      check(index >= 0 || ids.length === 0, 'Selected item is unavailable.');
      const selected = state.drawing.sheets[Math.max(0, index)].items.filter(i => ids.includes(i.persistentId)).map(i => i._id);
      store.dispatch({ type: PLUGIN_SELECTION, sheetIndex: Math.max(0, index), ids: selected }); pluginManager.activateView(); return;
    }
    if (method === 'symbols.get') {
      requireGrant(plugin, 'symbols.read'); const state = sessionFor(params, context).state.docStore.present;
      if (state.editLibrary && state.editSymbol) {
        const name = state.editSymbol; const definition = state.editLibrary.symbols.find(s => s.SymbolId === name.SymbolID)!;
        return { id: definition.persistentId, nameId: name.persistentId, name: name.Name, description: name.Description, reference: name.Reference,
          attributes: Object.fromEntries(name.Attributes.map(a => [a.AttName, a.AttValue])), parts: name.ppp,
          extensionData: ownedData(definition, id), sheets: state.drawing.sheets.map(s => ({ id: s.persistentId, name: s.name, items: s.items.map(itemDto) })) };
      }
      const item = state.drawing.sheets.flatMap(s => s.items).find(i => i.persistentId === (params.symbolId || context.symbolId));
      check(item?.NodeName === DocItemTypes.Symbol, 'Symbol is unavailable.'); return itemDto(item);
    }
    if (method.startsWith('extensionData.')) {
      const session = sessionFor(params, context); const state = session.state.docStore.present;
      const scope = params.scope || (state.editSymbol ? 'symbolDefinition' : 'document');
      requireGrant(plugin, ['library', 'libraryName', 'symbolDefinition'].includes(scope) ? 'symbols.read' : 'document.read');
      const targetId = params.targetId || (scope === 'symbolDefinition' ? context.symbolId : undefined);
      if (method === 'extensionData.get') return { ...ownedData(ownerTarget(state.drawing, state.editLibrary, state.editSymbol, scope, targetId), id), revision: session.revision };
      check(method === 'extensionData.set' || method === 'extensionData.delete', 'Unknown extension data method.');
      return apply(plugin, { documentId: session.id, expectedRevision: params.expectedRevision ?? session.revision,
        operations: [{ ...params, scope, targetId, type: method.endsWith('.delete') ? 'deleteExtensionData' : 'setExtensionData' }] }, context);
    }
    if (method === 'netlists.generate') {
      requireGrant(plugin, 'netlist.read'); const session = sessionFor(params, context); const drawing = session.state.docStore.present.drawing;
      const data = await wkrGenerateNetlist(drawing);
      if (params.format === 'spice') return { revision: session.revision, text: writeSpice(data) };
      check(!params.format || params.format === 'connectivity', 'Unsupported netlist format.');
      return { revision: session.revision, nets: Object.entries(data.nets).map(([net, nodes]) => ({ id: net, nodes: nodes.map(n => ({ reference: n.reference, pin: n.pin, point: n.a, sheet: n.sheet, label: n.label })) })) };
    }
    if (method === 'commands.execute') {
      return store.dispatch(handleMenuCommand(exportedCoreCommand(plugin, params.command, !!store.getState().docStore.present.editLibrary)));
    }
    if (method === 'ui.notify') { check(typeof params.message === 'string' && params.message.length <= 2000, 'Invalid notification.'); pluginManager.notify(`${plugin.current.manifest.name}: ${params.message}`); return; }
    if (method === 'ui.confirm') return await prompts.ask(plugin.current.manifest.name, String(params.message).slice(0, 2000)) === 'accept';
    if (method === 'ui.previewEdits') {
      check(JSON.stringify(params).length <= LIMITS.rpc, 'Edit preview is too large.');
      check(Array.isArray(params.operations), 'An edit preview requires operations.');
      const descriptions = params.operations.map((operation: any) => {
        if (operation.type === 'insertWire') return `Add a wire from (${operation.a}) to (${operation.b}).`;
        if (operation.type === 'insertText') return `Add text: ${String(operation.text).slice(0, 200)}`;
        if (operation.type === 'insertSymbol') return `Add component ${operation.symbol?.name || 'from the design'} at (${operation.point}).`;
        if (operation.type === 'move') return `Move an item by (${operation.delta}).`;
        if (operation.type === 'delete') return 'Delete an item.';
        if (operation.type === 'setAttributes' || operation.type === 'setLibraryAttributes') return `Update component properties: ${Object.entries(operation.attributes || {}).map(([name, value]) => `${name} = ${value}`).join(', ')}`;
        if (operation.type === 'setPin') return `Update pin ${operation.number || ''} ${operation.name || ''}.`;
        if (operation.type === 'setExtensionData' || operation.type === 'deleteExtensionData') return 'Update the plugin’s saved design information.';
        return 'Unsupported change (the host will reject this operation).';
      });
      const choice = await prompts.ask(plugin.current.manifest.name, 'Apply these changes to the drawing? They can be undone together.', [{ value: 'accept', label: 'Apply changes' }, { value: 'cancel', label: 'Cancel' }], descriptions.map((description: string) => '• ' + description).join('\n'));
      if (choice !== 'accept') return { accepted: false }; return { accepted: true, ...apply(plugin, params, context) };
    }
    if (method === 'network.request') {
      const url = new URL(params.url); check(url.protocol === 'https:' && !url.username && !url.password, 'Plugin network requests require HTTPS.');
      requireGrant(plugin, 'network:' + url.origin);
      const response = await fetch(url.href, { method: ['GET', 'POST', 'PUT', 'DELETE'].includes(params.method) ? params.method : 'GET',
        headers: params.headers || {}, body: params.body, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000) });
      check(Number(response.headers.get('content-length') || 0) <= LIMITS.rpc, 'Network response too large.');
      const reader = response.body!.getReader(); let text = ''; const decoder = new TextDecoder();
      while (true) { const chunk = await reader.read(); if (chunk.done) break; text += decoder.decode(chunk.value, { stream: true }); if (text.length > LIMITS.rpc) { await reader.cancel(); throw new Error('Network response too large.'); } }
      return { status: response.status, ok: response.ok, text };
    }
    if (method === 'desktop.getCapabilities') {
      const allowed = platform === 'electron' && plugin.grants.includes('desktop.tools');
      return { nativeTools: allowed, tools: allowed ? await window.electronAPI.listPluginTools(id) : [] };
    }
    if (method === 'desktop.runTool') { requireGrant(plugin, 'desktop.tools'); check(window.electronAPI?.runPluginTool, 'Native tools are only available in Electron.'); return window.electronAPI.runPluginTool(id, params.toolId, params.input); }
    if (method === 'libraries.placeSymbol') {
      requireGrant(plugin, 'libraries.provide'); requireGrant(plugin, 'document.write');
      check(plugin.current.manifest.contributes?.libraryProviders?.some(p => p.id === params.providerId), 'Unknown library provider.');
      const connection = await pluginManager.controller(id); const spec = await connection.call('library:' + params.providerId + ':resolve', { id: params.symbolId });
      const session = documentSessions.get(); return apply(plugin, { documentId: session.id, expectedRevision: session.revision, operations: [{ type: 'insertSymbol', symbol: spec, point: [100, 100] }] }, context);
    }
    throw new PluginError('Unavailable', 'Unsupported plugin API method: ' + method);
  };
  pluginManager.attach({
    context: () => {
      const state = store.getState(); const doc = state.docStore.present;
      return { platform, editorKind: doc.editLibrary ? 'symbol' : 'schematic', hasSelection: doc.view._selected_array.length > 0,
        documentWritable: !state.altStore.saveInProgress, documentOpen: true };
    },
    safeToUpdate: () => { const state = store.getState(); return !state.altStore.saveInProgress && !state.docStore.present.view.add && !state.altStore.show_dialogue && !prompts.snapshot(); },
    invoke,
    subscribe: callback => {
      let previous = store.getState(); let previousSession = documentSessions.activeId; let previousSaved = previous.altStore.savedVersion;
      const unsubscribe = store.subscribe(() => {
        const state = store.getState(); const doc = state.docStore.present;
        if (previousSession !== documentSessions.activeId) callback('documentOpened', { documentId: documentSessions.activeId, pluginIds: Object.keys(doc.drawing.pluginData || {}) });
        else if (previous.docStore.present.drawing !== doc.drawing || previous.docStore.present.editLibrary !== doc.editLibrary) callback('documentChanged', { documentId: documentSessions.activeId });
        if (previous.docStore.present.view._selected_array !== doc.view._selected_array) callback('selectionChanged', { documentId: documentSessions.activeId });
        if (previousSaved !== state.altStore.savedVersion) callback('documentSaved', { documentId: documentSessions.activeId });
        previous = state; previousSession = documentSessions.activeId; previousSaved = state.altStore.savedVersion;
      });
      const languageChanged = () => { pluginManager.event('localeChanged', { locale: i18n.language }); };
      i18n.on('languageChanged', languageChanged);
      return () => { unsubscribe(); i18n.off('languageChanged', languageChanged); };
    },
  });
  window.addEventListener('beforeunload', event => { if (documentSessions.anyDirty() || pluginManager.hasDrafts()) { event.preventDefault(); event.returnValue = ''; } });
  window.electronAPI?.onPluginCommand?.(command => {
    if (command !== 'tinycad.managePlugins') void pluginManager.execute(command).catch(error => pluginManager.notify(error.message));
  });
  void pluginManager.init();
}
