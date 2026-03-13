import { docDrawing } from '../undo/undo';
import { BottomPanel } from '../../components/panel/BottomPanel';
import { updateView } from '../../manipulators/updateView';
import { connect } from 'react-redux';
import { activeSheet } from '../stores/docStoreReducer';

const mapStateToProps = (state: docDrawing) => {
  const sheet = activeSheet(state.docStore.present);
  const view = state.docStore.present.view;
  const update_view = new updateView();
  // Check if there's any selection (for showing style panel)
  const hasSelection = view?._selected_array?.length > 0;
  // Check if we're in library edit mode
  const isLibraryEditMode = !!state.docStore.present.editLibrary;
  return {
    selectedSymbol: update_view.getSelectedSymbol(view, sheet),
    selectedPin: update_view.getSelectedPin(view, sheet),
    selectedItem: update_view.getSelected(view, sheet),
    hasSelection: hasSelection,
    drawing: state.docStore.present.drawing,
    panel: state.altStore.panel,
    isLibraryEditMode: isLibraryEditMode,
  };
};

const BottomPanelContainer = connect(mapStateToProps)(BottomPanel);

export default BottomPanelContainer;
