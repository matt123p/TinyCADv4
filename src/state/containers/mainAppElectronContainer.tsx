import { docDrawing } from '../undo/undo';
import { connect } from 'react-redux';
import { MainAppElectron } from '../../components/pages/mainAppElectron';

const mapStateToProps = (state: docDrawing) => {
  return {
    selected_sheet: state.docStore.present.view.selected_sheet,
    editSymbol: state.docStore.present.editSymbol,
    editLibrary: state.docStore.present.editLibrary,
    browserSheets: state.docStore.present.view.browserSheets,
    file: state.altStore.file,
    saveNeeded: state.docStore.present.drawingVersion !== state.altStore.savedVersion,
  };
};

const MainAppElectronContainer = connect(mapStateToProps)(MainAppElectron);

export default MainAppElectronContainer;
