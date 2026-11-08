import { docDrawing } from '../undo/undo';
import { connect } from 'react-redux';
import { DesignApp } from '../../components/pages/designApp';
import { actionCommand } from '../dispatcher/AppDispatcher';
import { activeSheet } from '../stores/docStoreReducer';
import { updateView } from '../../manipulators/updateView';
import { readControl } from '../../simulation/controls';
import { DocItemTypes } from '../../model/dsnItem';

const mapStateToProps = (state: docDrawing) => {
  const present = state.docStore.present;
  const sheet = activeSheet(present);
  const symbol = (sheet && new updateView().getSelectedSymbol(present.view, sheet)) ||
    (present.view.add?.NodeName === DocItemTypes.Symbol ? present.view.add : null);
  return {
    simulationPanelActivated: state.altStore.simulationPanelActivated,
    selectedSpiceControl: !!symbol && !!readControl(symbol),
    simulationSheet: !state.docStore.present.editSymbol && state.docStore.present.drawing.sheets[state.docStore.present.view.selected_sheet]?.kind === 'simulation',
    creating: !!state.docStore.present.view.add,
    dialogOpen: !!state.altStore.show_dialogue,
    selected_sheet: state.docStore.present.view.selected_sheet,
    editSymbol: state.docStore.present.editSymbol,
    browserSheets: state.docStore.present.view.browserSheets,
  };
};

const DesignAppContainer = connect(mapStateToProps, {
  cancelCreation: () => actionCommand('escape'),
})(DesignApp);

export default DesignAppContainer;
