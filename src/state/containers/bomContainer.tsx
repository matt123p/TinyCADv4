import { docDrawing } from '../undo/undo';
import { connect } from 'react-redux';
import { Bom } from '../../components/sheets/bom';

const mapStateToProps = (state: docDrawing) => {
  return {
    bom: state.docStore.present.bom,
  };
};

const BomContainer = connect(mapStateToProps)(Bom);

export default BomContainer;
