import { docDrawing } from '../undo/undo';
import { LibrariesPanel } from '../../components/libraryPanel/LibrariesPanel';
import { connect } from 'react-redux';

const mapStateToProps = (state: docDrawing) => {
  return {
    libraries: state.altStore.libraries,
    standardLibraryNavigation: state.altStore.standardLibraryNavigation,
    config: state.altStore.config,
  };
};

const LibrariesPanelContainer = connect(mapStateToProps)(LibrariesPanel);

export default LibrariesPanelContainer;
