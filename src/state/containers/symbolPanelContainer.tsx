import { docDrawing } from '../undo/undo';
import { SymbolPanel } from '../../components/panel/SymbolPanel';
import { updateView } from '../../manipulators/updateView';
import { connect } from 'react-redux';
import { activeSheet } from '../stores/docStoreReducer';

const mapStateToProps = (state: docDrawing) => {
  const sheet = activeSheet(state.docStore.present);
  const view = state.docStore.present.view;
  const update_view = new updateView();
  return {
    selectedSymbol: update_view.getSelectedSymbol(view, sheet),
  };
};

const SymbolPanelContainer = connect(mapStateToProps)(SymbolPanel);

export default SymbolPanelContainer;
