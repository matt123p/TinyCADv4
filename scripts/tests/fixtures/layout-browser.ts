import { store } from '../../../src/startup';
import { activeSheet } from '../../../src/state/stores/docStoreReducer';
import { actionEditorEvent, actionSetDocument } from '../../../src/state/dispatcher/AppDispatcher';

// This bridge is bundled only into the test entry point. UI interactions still
// use the real toolbar, dialog, Redux reducers, fonts, and compiled worker.
(window as any).layoutTest = {
  snapshot() {
    const current = store.getState().docStore.present;
    return {
      drawing: current.drawing,
      drawingVersion: current.drawingVersion,
      selectedIds: current.view._selected_array,
      past: store.getState().docStore.past.length,
    };
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
