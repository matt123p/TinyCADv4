import { docDrawing } from '../undo/undo';
import { connect } from 'react-redux';
import { DesignApp } from '../../components/pages/designApp';
import { actionCommand } from '../dispatcher/AppDispatcher';

const mapStateToProps = (state: docDrawing) => {
  return {
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
