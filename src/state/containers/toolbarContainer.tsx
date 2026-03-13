import { Toolbar } from '../../components/toolbar/toolbar';
import { docDrawing } from '../undo/undo';
import { updateView } from '../../manipulators/updateView';
import { connect } from 'react-redux';
import { activeSheet } from '../stores/docStoreReducer';

const mapStateToProps = (state: docDrawing) => {
  const sheet = activeSheet(state.docStore.present);
  const view = state.docStore.present.view;
  const update_view = new updateView();
  return {
    menu_command: view.menu_command,
    can_paste: update_view.can_paste(view, sheet),
    can_copy: update_view.can_copy(view, sheet),
    can_cut: update_view.can_copy(view, sheet),
    can_undo: state.docStore.past?.length > 0,
    can_redo: state.docStore.future?.length > 0,
    can_rotate: update_view.can_rotate(view, sheet),
    can_flip: update_view.can_flip(view, sheet),
    can_zoom_in: update_view.can_zoom_in(view, sheet),
    can_zoom_out: update_view.can_zoom_out(view, sheet),
    editLibrary: state.docStore.present.editLibrary,
    toolbarDefaults: state.altStore.toolbarDefaults,
    selected_sheet: state.docStore.present.view.selected_sheet,
    saveInProgress: state.altStore.saveInProgress,
    saveNeeded:
      state.docStore.present.drawingVersion !== state.altStore.savedVersion,
    editSymbol: state.docStore.present.editSymbol,
    recentFiles: state.altStore.recentFiles,
    hover_point: view.hover_point,
    showRulers: state.docStore.present.drawing.settings.showRulers,
  };
};

const ToolbarContainer = connect(mapStateToProps)(Toolbar);

export default ToolbarContainer;
