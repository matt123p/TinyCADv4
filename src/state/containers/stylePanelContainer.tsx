import { docDrawing } from '../undo/undo';
import { StylePanel } from '../../components/panel/StylePanel';
import { connect } from 'react-redux';

const mapStateToProps = (state: docDrawing) => {
  const view = state.docStore.present.view;
  return {
    selectedStyle: view.selectedStyle
      ? view.selectedStyle
      : {
          line: false,
          fill: false,
          text: false,
          text_colour: false,
          border_style: false,
        },
    panel: state.altStore.panel,
  };
};

const StylePanelContainer = connect(mapStateToProps)(StylePanel);

export default StylePanelContainer;
