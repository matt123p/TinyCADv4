import { docDrawing } from '../undo/undo';
import { EditLibraryView } from '../../components/libraryPanel/EditLibraryView';
import { connect } from 'react-redux';

const mapStateToProps = (state: docDrawing) => {
  return {
    viewLibrary: state.altStore.viewLibrary,
    editLibrary: state.docStore.present.editLibrary,
    editSymbol: state.docStore.present.editSymbol,
  };
};

const EditLibraryViewContainer = connect(mapStateToProps)(EditLibraryView);

export default EditLibraryViewContainer;
