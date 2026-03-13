import React, { Dispatch } from 'react';
import { SketchPicker, ColorResult } from 'react-color';
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogContent,
  DialogBody,
  DialogActions,
  Button,
} from '@fluentui/react-components';
import { MergedStyle } from '../../manipulators/updateInterfaces';
import {
  actionCancelDialog,
  actionStyle,
} from '../../state/dispatcher/AppDispatcher';
import { connect } from 'react-redux';

export enum ColorPickerTarget {
  Line,
  Fill,
  Font,
}

interface ColourPickerProps {
  target: ColorPickerTarget;
  title: string;
  settings: string;
  dispatch: Dispatch<any>;
}

interface ColourPickerState {
  color: string;
}

//
// This class represents a colours dialogue
//
class ColourPickerDialog extends React.PureComponent<
  ColourPickerProps,
  ColourPickerState
> {
  constructor(props: ColourPickerProps) {
    super(props);
    this.state = {
      color: props.settings,
    };
    this.handleColorChange = this.handleColorChange.bind(this);
    this.handleClickOk = this.handleClickOk.bind(this);
    this.handleClickCancel = this.handleClickCancel.bind(this);
  }

  handleClickOk() {
    this.props.dispatch(actionCancelDialog());
  }

  handleClickCancel() {
    this.setColor(this.state.color);
    this.props.dispatch(actionCancelDialog());
  }

  handleColorChange(color: ColorResult) {
    this.setColor(color?.hex);
  }

  setColor(color: string) {
    let style: MergedStyle = {
      line: this.props.target === ColorPickerTarget.Line,
      fill: this.props.target === ColorPickerTarget.Fill,
      text: false,
      text_colour: this.props.target === ColorPickerTarget.Font,
      border_style: false,
    };

    switch (this.props.target) {
      case ColorPickerTarget.Fill:
        style.fill_colour = color;
        break;
      case ColorPickerTarget.Line:
        style.line_colour = color;
        break;
      case ColorPickerTarget.Font:
        style.font_colour = color;
        break;
    }
    this.props.dispatch(actionStyle(style));
  }

  render() {
    return (
      <Dialog open={true} onOpenChange={this.handleClickCancel}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{this.props.title}</DialogTitle>
            <DialogContent>
              <div>
                <SketchPicker
                  disableAlpha={true}
                  color={this.props.settings ?? '#ffffff'}
                  onChange={this.handleColorChange}
                />
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={this.handleClickOk}>
                OK
              </Button>
              <Button appearance="secondary" onClick={this.handleClickCancel}>
                Cancel
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    );
  }
}

export default connect()(ColourPickerDialog);
