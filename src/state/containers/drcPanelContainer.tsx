import { docDrawing } from '../undo/undo';
import { DrcPanel } from '../../components/panel/DrcPanel';
import { updateView } from '../../manipulators/updateView';
import { connect } from 'react-redux';
import { activeSheet } from '../stores/docStoreReducer';
import { projectDrcDrawing } from '../projectDrc';

const mapStateToProps = (state: docDrawing) => {
  const sheet = activeSheet(state.docStore.present);
  const view = state.docStore.present.view;
  const update_view = new updateView();
  const checked = projectDrcDrawing(state);
  return {
    selected: update_view.getSelected(view, sheet),
    panel: !update_view.getSelectedSymbol(view, sheet)
      ? state.altStore.panel
      : null,
    drcTable: checked?.drawing.drcTable ?? state.docStore.present.drawing.drcTable,
    checkedFileName: checked?.name,
    hover_point: state.docStore.present.view.hover_point,
  };
};

const DrcPanelContainer = connect(mapStateToProps)(DrcPanel);

export default DrcPanelContainer;
