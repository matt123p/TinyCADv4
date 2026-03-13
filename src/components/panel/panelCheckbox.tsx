import React, { Dispatch } from 'react';
import { Checkbox } from '@fluentui/react-components';
import { MergedStyle } from '../../manipulators/updateInterfaces';
import { actionStyle } from '../../state/dispatcher/AppDispatcher';
import { connect } from 'react-redux';

export enum PanelCheckboxTarget {
  Stroked,
  RoundedRect,
  Filled,
  FontBold,
  FontItalic,
  ShowPower,
}

interface PanelCheckboxProps {
  enable?: boolean;
  checked?: boolean;
  caption: string;
  target: PanelCheckboxTarget;
  dispatch: Dispatch<any>;
}

//
// This component represents a panel checkbox
//
class PanelCheckbox extends React.PureComponent<PanelCheckboxProps, {}> {
  static defaultProps = {
    enable: true,
  };

  constructor(props: PanelCheckboxProps) {
    super(props);
    this.handleClick = this.handleClick.bind(this);
  }

  handleClick() {
    if (!this.props.enable) {
      return;
    }

    let style: MergedStyle = {
      line: this.props.target === PanelCheckboxTarget.Stroked,
      fill: this.props.target === PanelCheckboxTarget.Filled,
      text:
        this.props.target === PanelCheckboxTarget.FontBold ||
        this.props.target === PanelCheckboxTarget.FontItalic,
      text_colour: false,
      border_style: this.props.target === PanelCheckboxTarget.RoundedRect,
    };

    switch (this.props.target) {
      case PanelCheckboxTarget.Stroked:
        style.stroked = !this.props.checked;
        break;
      case PanelCheckboxTarget.RoundedRect:
        style.rounded_rect = !this.props.checked;
        break;
      case PanelCheckboxTarget.Filled:
        style.filled = !this.props.checked;
        break;
      case PanelCheckboxTarget.FontBold:
        style.font_bold = !this.props.checked;
        break;
      case PanelCheckboxTarget.FontItalic:
        style.font_italic = !this.props.checked;
        break;
    }

    this.props.dispatch(actionStyle(style));
  }

  render() {
    return (
      <Checkbox
        label={this.props.caption}
        checked={this.props.checked ?? 'mixed'}
        disabled={!this.props.enable}
        onChange={(e, data) => this.handleClick()}
      />
    );
  }
}

export default connect()(PanelCheckbox);
