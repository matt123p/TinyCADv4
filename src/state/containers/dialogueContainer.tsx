import TDialogue from '../../components/dialogues/Dialogue';
import { docDrawing } from '../undo/undo';
import { connect } from 'react-redux';
import { activeSheet } from '../stores/docStoreReducer';

const mapStateToProps = (state: docDrawing) => {
  const sheet = activeSheet(state.docStore.present);
  let props: any;
  switch (state.altStore.show_dialogue) {
    case 'page_size':
      props = sheet.details.page_size;
      break;
    case 'design_details':
      props = sheet.details;
      break;
    case 'settings':
      props = {
        grid: sheet.details.grid,
        grid_snap: sheet.details.grid_snap,
        show_grid: sheet.options.show_grid,
        units: sheet.options.units,
      };
      break;
    case 'colours':
      props = {
        color_background: sheet.options.color_background,
        color_bus: sheet.options.color_bus,
        color_hidden_pin: sheet.options.color_hidden_pin,
        color_junction: sheet.options.color_junction,
        color_label: sheet.options.color_label,
        color_noconnect: sheet.options.color_noconnect,
        color_notetext_fill: sheet.options.color_notetext_fill,
        color_notetext_line: sheet.options.color_notetext_line,
        color_notetext_text: sheet.options.color_notetext_text,
        color_pin: sheet.options.color_pin,
        color_power: sheet.options.color_power,
        color_wire: sheet.options.color_wire,
        show_label_connection_point: sheet.options.show_label_connection_point,
      };
      break;
    case 'drc':
      props = state.docStore.present.drawing.drc;
      break;
    case 'annotate':
      props = state.docStore.present.drawing.annotate;
      break;
    default:
      props = state.altStore.dialogue_props;
  }

  return {
    show_dialogue: state.altStore.show_dialogue,
    dialogue_props: props,
  };
};

const DialogueContainer = connect(mapStateToProps)(TDialogue);

export default DialogueContainer;
