import { docDrawing } from '../undo/undo';
import PinPanel from '../../components/panel/PinPanel';
import { updateView } from '../../manipulators/updateView';
import { connect } from 'react-redux';
import { activeSheet } from '../stores/docStoreReducer';

const mapStateToProps = (state: docDrawing) => {
  const sheet = activeSheet(state.docStore.present);
  const view = state.docStore.present.view;
  const update_view = new updateView();

  return {
    selectedPin: update_view.getSelectedPin(view, sheet),
  };
};

const PinPanelContainer = connect(mapStateToProps)(PinPanel);

export default PinPanelContainer;
