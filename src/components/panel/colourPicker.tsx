import React, { Dispatch } from 'react';
import { Button } from '@fluentui/react-components';
import { ColorFillRegular, PaintBrushRegular } from '@fluentui/react-icons';
import { actionSelectDialog } from '../../state/dispatcher/AppDispatcher';
import { connect } from 'react-redux';

export enum ColorPickerTarget {
  Line,
  Fill,
  Font,
}

interface ColourPickerProps {
  target: ColorPickerTarget;
  iconName: string;
  'button-text': string;
  enable: boolean;
  settings: string;
  dispatch: Dispatch<any>;
}

//
// This component represents a colour picker button
//
class ColourPicker extends React.PureComponent<ColourPickerProps, {}> {
  constructor(props: ColourPickerProps) {
    super(props);
  }

  handleClick() {
    this.props.dispatch(
      actionSelectDialog('colour_picker', {
        title: this.props['button-text'],
        settings: this.props.settings,
        target: this.props.target,
      }),
    );
  }

  isLight(color: string) {
    if (!color) return false;
    if (color.startsWith('#')) {
      const hex = color.substring(1);
      // Handle shorthand hex like #fff
      if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness > 155;
      }
      if (hex.length === 6) {
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness > 155;
      }
    }
    if (color.toLowerCase() === 'white') return true;
    return false;
  }

  render() {
    let color = this.props.settings;
    if (!color) {
        if (this.props.target === ColorPickerTarget.Font || this.props.target === ColorPickerTarget.Line) {
             color = '#000000';
        } else {
             color = '#ffffff';
        }
    }

    const isLight = this.isLight(color);

    const iconStyle = {
      color: color,
      fontSize: '20px',
      backgroundColor: isLight ? '#444444' : 'transparent',
      borderRadius: '2px',
    };

    return (
      <Button
        disabled={!this.props.enable}
        onClick={() => this.handleClick()}
        icon={
          this.props.iconName === 'BucketColor' ? (
            <ColorFillRegular style={iconStyle} />
          ) : (
            <PaintBrushRegular style={iconStyle} />
          )
        }
      >
        {this.props['button-text']}
      </Button>
    );
  }
}

export default connect()(ColourPicker);
