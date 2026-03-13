import { docDrawing } from '../undo/undo';
import { connect } from 'react-redux';
import { DesignApp } from '../../components/pages/designApp';

const mapStateToProps = (state: docDrawing) => {
  return {
    selected_sheet: state.docStore.present.view.selected_sheet,
    editSymbol: state.docStore.present.editSymbol,
    browserSheets: state.docStore.present.view.browserSheets,
  };
};

const DesignAppContainer = connect(mapStateToProps)(DesignApp);

export default DesignAppContainer;
