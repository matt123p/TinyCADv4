import { docDrawing } from '../undo/undo';
import { connect } from 'react-redux';
import { GoogleLogin } from '../../components/pages/googleLogin';

const mapStateToProps = (state: docDrawing) => {
  return {};
};

const GoogleLoginContainer = connect(mapStateToProps)(GoogleLogin);

export default GoogleLoginContainer;
