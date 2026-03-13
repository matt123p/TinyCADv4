import { Topbar } from '../../components/toolbar/topbar';
import { docDrawing } from '../undo/undo';
import { connect } from 'react-redux';

const mapStateToProps = (state: docDrawing) => {
  return {
    user: state.altStore.user,
    file: state.altStore.file,
    saveNeeded:
      state.docStore.present.drawingVersion !== state.altStore.savedVersion,
  };
};

const TopbarContainer = connect(mapStateToProps)(Topbar);

export default TopbarContainer;
