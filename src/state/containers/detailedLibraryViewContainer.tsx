import { docDrawing } from '../undo/undo';
import { DetailedLibraryView } from '../../components/libraryPanel/DetailedLibraryView';
import { connect } from 'react-redux';

const mapStateToProps = (state: docDrawing) => {
  return {
    viewLibrary: state.altStore.viewLibrary,
    editLibrary: state.docStore.present.editLibrary,
  };
};

const DetailedLibraryViewContainer =
  connect(mapStateToProps)(DetailedLibraryView);

export default DetailedLibraryViewContainer;
