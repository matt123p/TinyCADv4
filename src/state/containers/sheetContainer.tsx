import { TSheet } from '../../components/svg/Sheet';
import { docDrawing } from '../undo/undo';
import { Panels } from '../dispatcher/AppDispatcher';
import { connect } from 'react-redux';
import { activeSheet } from '../stores/docStoreReducer';

const mapStateToProps = (state: docDrawing) => {
  const sheet = activeSheet(state.docStore.present);
  const view = state.docStore.present.view;

  const heterogeneous = state.docStore.present.heterogeneous;
  const part =
    !state.docStore.present.editSymbol || heterogeneous
      ? 0
      : view.selected_sheet;
  const show_power =
    !state.docStore.present.editSymbol ||
    (view.selected_sheet !== 0 && !heterogeneous)
      ? false
      : true;

  let markers = [];
  if (state.altStore.panel === Panels.DrcPanel) {
    markers = state.docStore.present.drawing.drcTable;
  }
  return {
    sheet_name: sheet.name,
    items: sheet.items,
    page_size: sheet.details.page_size,
    add: view.add,
    display_add: view.display_add,
    _selected_handle: view._selected_handle,
    _in_select_rect: view._in_select_rect,
    _select_rect_a: view._select_rect_a,
    _select_rect_b: view._select_rect_b,
    _selected_array: view._selected_array,
    hover_obj: view.hover_obj,
    hover_ids: view.hover_ids,
    hover_pins: view.hover_pins,
    hover_point: view.hover_point,
    cursor: view.cursor,
    details: sheet.details,
    options: sheet.options,
    markers: markers?.filter((p) => p.sheet === sheet.name),
    zoom: view.zoom,
    images: sheet.images,
    hatches: sheet.hatches,
    contextMenu:
      state.altStore.contextMenu && !state.altStore.contextMenu?.hidden,
    part: part,
    show_power: show_power,
    editingLibrary: !!state.docStore.present.editLibrary,
    heterogeneous: heterogeneous,
    showRulers: state.docStore.present.drawing.settings.showRulers,
    netlistTypes: state.docStore.present.drawing.netlistTypes,
    netTypeAssignments: state.docStore.present.drawing.netTypeAssignments,
  };
};

const SheetContainer = connect(mapStateToProps)(TSheet);

export default SheetContainer;
