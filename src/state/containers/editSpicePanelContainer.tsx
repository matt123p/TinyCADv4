import { docDrawing } from '../undo/undo';
import EditSpicePanel from '../../components/panel/EditSpicePanel';
import { connect } from 'react-redux';

const mapStateToProps = (state: docDrawing) => {
  return {
    editSymbol: state.docStore.present.editSymbol,
    outlines: state.docStore.present.drawing.sheets.map((sheet) => sheet.items),
  };
};

const EditSpicePanelContainer = connect(mapStateToProps)(EditSpicePanel);

export default EditSpicePanelContainer;
