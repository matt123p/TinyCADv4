import { store } from '../../../src/startup';
import { activeSheet } from '../../../src/state/stores/docStoreReducer';
import { actionEditLibrary, actionEditorEvent, actionSelectBottomPanel, actionSetDocument, actionSetLibraryList, BottomPanels } from '../../../src/state/dispatcher/AppDispatcher';
import { bundledLibraries } from '../../../src/io/bundledLibraries';
import { librarySymbolSelection } from '../../../src/io/librarySymbols';
import { importSymbolsFromFile } from '../../../src/io/files';
import { blank, ioXML } from '../../../src/io/ioXml';
import { loadTcLibrary, saveTcLibrary } from '../../../src/io/tclib';
import { XMLBuilder } from '../../../src/util/xmlbuilder';

// This bridge is bundled only into the test entry point. UI interactions still
// use the real toolbar, dialog, Redux reducers, fonts, and compiled worker.
(window as any).layoutTest = {
  importKiCadSymbols() {
    void store.dispatch(importSymbolsFromFile() as any);
  },
  installLibrary(library: any) {
    store.dispatch(actionSetLibraryList([library]));
  },
  async placeSpiceSymbol(name: string) {
    const library = await bundledLibraries.readLibrary('spice');
    const symbol = library.names.find(entry => entry.Name === name);
    if (!symbol) throw new Error('Missing bundled SPICE symbol ' + name);
    store.dispatch(librarySymbolSelection(library, symbol));
    (window as any).layoutTest.selectSymbol(name);
  },
  async editLibrarySymbol(name: string) {
    const source = await bundledLibraries.readLibrary('spice');
    const entry = source.names.find((symbol) => symbol.Name === name);
    const library = {
      ...source, name: 'Test library', fileId: 'test-library', readOnly: false,
      names: [{ ...entry, Attributes: [] }],
      symbols: source.symbols.filter((symbol) => symbol.SymbolId === entry.SymbolID),
    };
    store.dispatch(actionEditLibrary(library, 'Test library.TCLib', library.fileId, null));
  },
  async saveLibraryAndPlaceSymbol() {
    const { editLibrary } = store.getState().docStore.present;
    const data = await saveTcLibrary(editLibrary);
    const library = await loadTcLibrary(editLibrary.fileId, editLibrary.name, editLibrary.modified, data);
    const [entry] = library.names;
    store.dispatch(actionSetDocument(blank(), 'Test.dsn', null, null));
    store.dispatch(librarySymbolSelection(library, entry));
    (window as any).layoutTest.selectSymbol(entry.Name);
  },
  selectSymbol(name: string) {
    const sheet = activeSheet(store.getState().docStore.present);
    const symbol = sheet.items.find(item => item.NodeName === 'symbol' && item.text.some(field => field.description === 'Name' && field.value === name));
    if (!symbol) throw new Error('Missing placed SPICE symbol ' + name);
    store.dispatch({ type: '[Find] SetFindSelection', mode: 2,
      selection: { id: symbol._id, sheet: sheet.name, a: [0, 0], text: '', symbol: name } } as any);
    store.dispatch(actionSelectBottomPanel(BottomPanels.SymbolPanel));
  },
  snapshot() {
    const current = store.getState().docStore.present;
    return {
      drawing: current.drawing,
      drawingVersion: current.drawingVersion,
      selectedIds: current.view._selected_array,
      past: store.getState().docStore.past.length,
    };
  },
  saveAndReopen() {
    const xml = new ioXML().to_dsn(store.getState().docStore.present.drawing, true, true).tostring();
    (window as any).layoutTest.reopenXml(xml);
    return xml;
  },
  reopenXml(xml: string) {
    const builder = new XMLBuilder();
    builder.fromText(xml);
    store.dispatch(actionSetDocument(new ioXML().from_dsn(builder), 'Reopened.dsn', null, null));
  },
  selectLabel(text: string) {
    const state = store.getState();
    const current = state.docStore.present;
    const sheet = activeSheet(current);
    const label = sheet.items.find(item => item.NodeName === 'label' && item.text === text);
    if (!label) throw new Error('Missing fixture label: ' + text);
    store.dispatch({ type: '[Find] SetFindSelection', mode: 2,
      selection: { id: label._id, sheet: sheet.name, a: [0, 0], text: '', symbol: '' } } as any);
  },
  selectSection() {
    const sheet = activeSheet(store.getState().docStore.present);
    const points = sheet.items.filter(item => item.NodeName === 'wire').slice(0, 3)
      .flatMap(item => item.NodeName === 'wire' ? item.d_points : []);
    const start: [number, number] = [Math.min(...points.map(p => p[0])) - 100, Math.min(...points.map(p => p[1])) - 100];
    const end: [number, number] = [Math.max(...points.map(p => p[0])) + 100, Math.max(...points.map(p => p[1])) + 100];
    for (const [event, point] of [['lbuttondown', start], ['mousedrag', end], ['dragend', end]] as const) {
      store.dispatch(actionEditorEvent(event, point, [0, 0], point, { x: 0, y: 0 }, 0));
    }
  },
  replaceSheet() {
    const drawing = structuredClone(store.getState().docStore.present.drawing);
    store.dispatch(actionSetDocument(drawing, 'Updated.dsn', null, null));
  },
};
