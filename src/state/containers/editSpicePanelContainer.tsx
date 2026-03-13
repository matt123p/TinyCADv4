import { docDrawing } from '../undo/undo';
import EditSpicePanel from '../../components/panel/EditSpicePanel';
import { updateView } from '../../manipulators/updateView';
import { connect } from 'react-redux';
import { activeSheet } from '../stores/docStoreReducer';

const mapStateToProps = (state: docDrawing) => {
  const sheet = activeSheet(state.docStore.present);
  return {
    editSymbol: state.docStore.present.editSymbol,
    heterogeneous: state.docStore.present.heterogeneous,
    items: sheet?.items ?? [],
  };
};

const EditSpicePanelContainer = connect(mapStateToProps)(EditSpicePanel);

export default EditSpicePanelContainer;
