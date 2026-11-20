import { store } from '../../../src/startup';
import { activeSheet } from '../../../src/state/stores/docStoreReducer';
import { actionCommand, actionEditorEvent, actionSetDocument, actionSetLibraryList, actionSheetRename } from '../../../src/state/dispatcher/AppDispatcher';
import { ioXML } from '../../../src/io/ioXml';
import { XMLBuilder } from '../../../src/util/xmlbuilder';

// This bridge is bundled only into the test entry point. UI interactions still
// use the real toolbar, dialog, Redux reducers, fonts, and compiled worker.
(window as any).layoutTest = {
  installLibrary(library: any) {
    store.dispatch(actionSetLibraryList([library]));
  },
  renameCurrentSheet(name: string) {
    store.dispatch(actionSheetRename(name));
  },
  snapshot() {
    const current = store.getState().docStore.present;
    return {
      drawing: current.drawing,
      drawingVersion: current.drawingVersion,
      sheet: current.view.selected_sheet,
      adding: current.view.add,
      selectedIds: current.view._selected_array,
      hoverPins: current.view.hover_pins,
      projectRoot: store.getState().altStore.file.project?.rootId,
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
  command(name: string) { store.dispatch(actionCommand(name)); },
  pointer(event: string, point: [number, number]) {
    store.dispatch(actionEditorEvent(event, point, [0, 0], point, { x: 0, y: 0 }, 0));
  },
  selectItem(id: number) {
    const sheet = activeSheet(store.getState().docStore.present);
    store.dispatch({ type: '[Find] SetFindSelection', mode: 2,
      selection: { id, sheet: sheet.name, a: [0, 0], text: '', symbol: '' } } as any);
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
