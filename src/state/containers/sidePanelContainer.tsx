import { docDrawing } from '../undo/undo';
import { SidePanel } from '../../components/panel/SidePanel';
import { updateView } from '../../manipulators/updateView';
import { connect } from 'react-redux';
import { activeSheet } from '../stores/docStoreReducer';

const mapStateToProps = (state: docDrawing) => {
  const sheet = activeSheet(state.docStore.present);
  const view = state.docStore.present.view;
  const update_view = new updateView();
  return {
    panel: state.altStore.panel,
    selectedSymbol: update_view.getSelectedSymbol(view, sheet),
    selectedPin: update_view.getSelectedPin(view, sheet),
    saveInProgress: state.altStore.saveInProgress,
    viewLibrary: state.altStore.viewLibrary,
    editLibrary: state.docStore.present.editLibrary,
    editSymbol: state.docStore.present.editSymbol,
  };
};

const SidePanelContainer = connect(mapStateToProps)(SidePanel);

export default SidePanelContainer;
