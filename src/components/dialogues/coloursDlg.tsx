import React, { Dispatch } from 'react';
import { WithTranslation, withTranslation } from 'react-i18next';
import { SketchPicker, ColorResult } from 'react-color';
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogContent,
  DialogBody,
  DialogActions,
  Button,
  Checkbox,
  Text,
  tokens,
} from '@fluentui/react-components';
import { SheetOptions } from '../../model/dsnDrawing';
import {
  actionUpdateColours,
  actionCancelDialog,
} from '../../state/dispatcher/AppDispatcher';
import { connect } from 'react-redux';
import { defaultSheetOption } from '../../io/ioXml';

interface ColoursDialogProps extends WithTranslation {
  options: SheetOptions;
  dispatch: Dispatch<any>;
}

interface ColoursDialogState {
  selected: string;
  color_background: string;
  color_bus: string;
  color_hidden_pin: string;
  color_junction: string;
  color_label: string;
  color_noconnect: string;
  color_notetext_fill: string;
  color_notetext_line: string;
  color_notetext_text: string;
  color_pin: string;
  color_power: string;
  color_wire: string;
  show_label_connection_point: boolean;
}

type ColourKey =
  | 'color_background'
  | 'color_bus'
  | 'color_hidden_pin'
  | 'color_junction'
  | 'color_label'
  | 'color_noconnect'
  | 'color_notetext_fill'
  | 'color_notetext_line'
  | 'color_notetext_text'
  | 'color_pin'
  | 'color_power'
  | 'color_wire';

type ColourValues = Record<ColourKey, string>;

const colourSections: Array<{
  titleKey: string;
  items: Array<{ key: ColourKey; labelKey: string }>;
}> = [
  {
    titleKey: 'dialogues.colours.sections.sheet',
    items: [{ key: 'color_background', labelKey: 'dialogues.colours.items.background' }],
  },
  {
    titleKey: 'dialogues.colours.sections.schematic',
    items: [
      { key: 'color_bus', labelKey: 'dialogues.colours.items.bus' },
      { key: 'color_hidden_pin', labelKey: 'dialogues.colours.items.hiddenPin' },
      { key: 'color_junction', labelKey: 'dialogues.colours.items.junction' },
      { key: 'color_label', labelKey: 'dialogues.colours.items.label' },
      { key: 'color_noconnect', labelKey: 'dialogues.colours.items.noConnect' },
      { key: 'color_pin', labelKey: 'dialogues.colours.items.pin' },
      { key: 'color_power', labelKey: 'dialogues.colours.items.power' },
      { key: 'color_wire', labelKey: 'dialogues.colours.items.wire' },
    ],
  },
  {
    titleKey: 'dialogues.colours.sections.annotations',
    items: [
      { key: 'color_notetext_fill', labelKey: 'dialogues.colours.items.noteTextFill' },
      { key: 'color_notetext_line', labelKey: 'dialogues.colours.items.noteTextLine' },
      { key: 'color_notetext_text', labelKey: 'dialogues.colours.items.noteText' },
    ],
  },
];

const getColourValues = (options: SheetOptions): ColourValues => ({
  color_background: options.color_background,
  color_bus: options.color_bus,
  color_hidden_pin: options.color_hidden_pin,
  color_junction: options.color_junction,
  color_label: options.color_label,
  color_noconnect: options.color_noconnect,
  color_notetext_fill: options.color_notetext_fill,
  color_notetext_line: options.color_notetext_line,
  color_notetext_text: options.color_notetext_text,
  color_pin: options.color_pin,
  color_power: options.color_power,
  color_wire: options.color_wire,
});

const defaultColours: ColourValues = getColourValues(defaultSheetOption);

//
// This class represents a colours dialogue
//
class ColoursDialog extends React.PureComponent<
  ColoursDialogProps,
  ColoursDialogState
> {
  constructor(props: ColoursDialogProps) {
    super(props);

    this.handleClick = this.handleClick.bind(this);
    this.handleColorChange = this.handleColorChange.bind(this);
    this.handleClickOk = this.handleClickOk.bind(this);
    this.handleClickCancel = this.handleClickCancel.bind(this);
    this.handleResetDefault = this.handleResetDefault.bind(this);
    this.handleLabelConnectionPointChange =
      this.handleLabelConnectionPointChange.bind(this);

    const values = getColourValues(this.props.options);

    this.state = {
      selected: 'color_background',
      ...values,
      show_label_connection_point: this.props.options.show_label_connection_point,
    };
  }

  handleClickOk() {
    this.props.dispatch(
      actionUpdateColours({
        color_background: this.state.color_background,
        color_bus: this.state.color_bus,
        color_hidden_pin: this.state.color_hidden_pin,
        color_junction: this.state.color_junction,
        color_label: this.state.color_label,
        color_noconnect: this.state.color_noconnect,
        color_notetext_fill: this.state.color_notetext_fill,
        color_notetext_line: this.state.color_notetext_line,
        color_notetext_text: this.state.color_notetext_text,
        color_pin: this.state.color_pin,
        color_power: this.state.color_power,
        color_wire: this.state.color_wire,
        show_label_connection_point: this.state.show_label_connection_point,
      }),
    );
  }

  handleClickCancel() {
    this.props.dispatch(actionCancelDialog());
  }

  handleResetDefault() {
    this.setState((state) => {
      const selected = state.selected as ColourKey;
      return {
        ...state,
        [selected]: defaultColours[selected],
      };
    });
  }

  handleColorChange(colour: ColorResult) {
    this.setState((s) => {
      switch (s.selected) {
        case 'color_background':
          return { ...s, color_background: colour?.hex };
        case 'color_bus':
          return { ...s, color_bus: colour?.hex };
        case 'color_hidden_pin':
          return { ...s, color_hidden_pin: colour?.hex };
        case 'color_junction':
          return { ...s, color_junction: colour?.hex };
        case 'color_label':
          return { ...s, color_label: colour?.hex };
        case 'color_noconnect':
          return { ...s, color_noconnect: colour?.hex };
        case 'color_notetext_fill':
          return { ...s, color_notetext_fill: colour?.hex };
        case 'color_notetext_line':
          return { ...s, color_notetext_line: colour?.hex };
        case 'color_notetext_text':
          return { ...s, color_notetext_text: colour?.hex };
        case 'color_pin':
          return { ...s, color_pin: colour?.hex };
        case 'color_power':
          return { ...s, color_power: colour?.hex };
        case 'color_wire':
          return { ...s, color_wire: colour?.hex };
      }
      return s;
    });
  }

  handleClick(name: ColourKey) {
    this.setState(() => {
      return { selected: name };
    });
  }

  handleLabelConnectionPointChange(
    _event: React.FormEvent<HTMLInputElement>,
    data: { checked: boolean | 'mixed' },
  ) {
    this.setState({ show_label_connection_point: data.checked === true });
  }

  render() {
    const { t } = this.props;
    const selectedKey = this.state.selected as ColourKey;
    const colour = this.state[selectedKey];
    const selectedItem = colourSections
      .flatMap((section) => section.items)
      .find((item) => item.key === selectedKey);
    const isSelectedDefault =
      colour.toLowerCase() === defaultColours[selectedKey].toLowerCase();

    return (
      <Dialog open={true} onOpenChange={this.handleClickCancel}>
        <DialogSurface style={{ width: '760px', maxWidth: '96vw' }}>
          <DialogBody>
            <DialogTitle>{t('dialogues.colours.title')}</DialogTitle>
            <DialogContent>
              <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '16px' }}>
                <div
                  style={{
                    maxHeight: '430px',
                    overflowY: 'auto',
                    border: `1px solid ${tokens.colorNeutralStroke1}`,
                    borderRadius: tokens.borderRadiusMedium,
                    backgroundColor: tokens.colorNeutralBackground2,
                    padding: '10px',
                  }}
                >
                  {colourSections.map((section) => (
                    <div key={section.titleKey} style={{ marginBottom: '10px' }}>
                      <Text
                        weight="semibold"
                        style={{
                          display: 'block',
                          marginBottom: '6px',
                          color: tokens.colorNeutralForeground2,
                        }}
                      >
                        {t(section.titleKey)}
                      </Text>
                      {section.items.map((item) => (
                        <Button
                          key={item.key}
                          appearance={selectedKey === item.key ? 'secondary' : 'subtle'}
                          onClick={() => this.handleClick(item.key)}
                          style={{
                            width: '100%',
                            justifyContent: 'flex-start',
                            marginBottom: '4px',
                          }}
                        >
                          <span
                            style={{
                              width: '14px',
                              height: '14px',
                              border: `1px solid ${tokens.colorNeutralStroke1}`,
                              borderRadius: '2px',
                              marginRight: '8px',
                              backgroundColor: this.state[item.key],
                              display: 'inline-block',
                              flexShrink: 0,
                            }}
                          />
                          {t(item.labelKey)}
                        </Button>
                      ))}
                    </div>
                  ))}
                </div>

                <div
                  style={{
                    border: `1px solid ${tokens.colorNeutralStroke1}`,
                    borderRadius: tokens.borderRadiusMedium,
                    padding: '12px',
                    backgroundColor: tokens.colorNeutralBackground1,
                  }}
                >
                  <Text
                    style={{
                      display: 'block',
                      marginBottom: '8px',
                      color: tokens.colorNeutralForeground2,
                    }}
                  >
                    {t('dialogues.colours.selected', {
                      item: selectedItem ? t(selectedItem.labelKey) : selectedKey,
                    })}
                  </Text>
                  <SketchPicker
                    disableAlpha={true}
                    color={colour}
                    onChange={this.handleColorChange}
                  />
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      marginTop: '10px',
                    }}
                  >
                    <Button
                      appearance="subtle"
                      onClick={this.handleResetDefault}
                      disabled={isSelectedDefault}
                    >
                      {t('dialogues.colours.resetToDefault')}
                    </Button>
                  </div>
                  <div
                    style={{
                      borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
                      marginTop: '12px',
                      paddingTop: '12px',
                    }}
                  >
                    <Checkbox
                      checked={this.state.show_label_connection_point}
                      label={t('dialogues.colours.showLabelConnectionPointMarker')}
                      onChange={this.handleLabelConnectionPointChange}
                    />
                    <Text
                      size={200}
                      style={{
                        display: 'block',
                        marginTop: '6px',
                        color: tokens.colorNeutralForeground3,
                      }}
                    >
                      {t('dialogues.colours.showLabelConnectionPointMarkerHelp')}
                    </Text>
                  </div>
                </div>
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={this.handleClickCancel}>
                {t('common.cancel')}
              </Button>
              <Button appearance="primary" onClick={this.handleClickOk}>
                {t('common.ok')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    );
  }
}

export default connect()(withTranslation()(ColoursDialog));
