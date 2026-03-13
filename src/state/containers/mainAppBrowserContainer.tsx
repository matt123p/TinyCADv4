import { docDrawing } from '../undo/undo';
import { connect } from 'react-redux';
import { MainAppBrowser } from '../../components/pages/mainAppBrowser';

const mapStateToProps = (state: docDrawing) => {
  return {
    loginState: state.altStore.loginState,
    selected_sheet: state.docStore.present.view.selected_sheet,
    editSymbol: state.docStore.present.editSymbol,
  };
};

const MainAppBrowserContainer = connect(mapStateToProps)(MainAppBrowser);

export default MainAppBrowserContainer;
