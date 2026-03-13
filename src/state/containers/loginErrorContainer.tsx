import { docDrawing } from '../undo/undo';
import { connect } from 'react-redux';
import { LoginError } from '../../components/pages/loginError';

const mapStateToProps = (state: docDrawing) => {
  return {
    error: state.altStore.loginError,
  };
};

const LoginErrorContainer = connect(mapStateToProps)(LoginError);

export default LoginErrorContainer;
