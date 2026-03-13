import { Sheetbar } from '../../components/toolbar/sheetbar';
import { docDrawing } from '../undo/undo';
import { connect } from 'react-redux';

const mapStateToProps = (state: docDrawing) => {
  return {
    sheets: state.docStore.present.drawing.sheets,
    selected_sheet: state.docStore.present.view.selected_sheet,
    bom: state.docStore.present.bom,
    editSymbol: state.docStore.present.editSymbol,
    browserSheets: state.docStore.present.view.browserSheets,
    hover_point: state.altStore.mousePosition,
  };
};

const SheetbarContainer = connect(mapStateToProps)(Sheetbar);

export default SheetbarContainer;
