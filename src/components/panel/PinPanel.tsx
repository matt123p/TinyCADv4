import React, { Dispatch } from 'react';
import { WithTranslation, withTranslation } from 'react-i18next';
import {
  Checkbox,
  Field,
  Input,
  Dropdown,
  Option,
} from '@fluentui/react-components';
import {
  actionSymbolEditPin,
} from '../../state/dispatcher/AppDispatcher';
import { dsnPin } from '../../model/dsnItem';

interface PinPanelProps extends WithTranslation {
  selectedPin: dsnPin;
  dispatch: Dispatch<any>;
}

interface PinPanelState {
  editing: number;
  value: boolean;
}

export class PinPanel extends React.PureComponent<
  PinPanelProps,
  PinPanelState
> {
  constructor(props: PinPanelProps) {
    super(props);
    this.state = {
      editing: -1,
      value: false,
    };
  }

  render() {
    const { t } = this.props;
    if (!this.props.selectedPin) {
      return null;
    }

    const shapeOptions = [
      { key: 0, text: t('panel.pin.normal') },
      { key: 1, text: t('panel.pin.dot') },
      { key: 2, text: t('panel.pin.clock') },
      { key: 3, text: t('panel.pin.dotClock') },
      { key: 4, text: t('panel.pin.power') },
      { key: 5, text: t('panel.pin.hidden') },
      { key: 6, text: t('panel.pin.cross') },
      { key: 7, text: t('panel.pin.inputLow') },
      { key: 8, text: t('panel.pin.clockLow') },
      { key: 9, text: t('panel.pin.outputLow') },
      { key: 10, text: t('panel.pin.fallingEdgeClock') },
    ];

    const elecOptions = [
      { key: 0, text: t('panel.pin.input') },
      { key: 1, text: t('panel.pin.output') },
      { key: 2, text: t('panel.pin.tristate') },
      { key: 3, text: t('panel.pin.openCollector') },
      { key: 4, text: t('panel.pin.passive') },
      { key: 5, text: t('panel.pin.inputOutput') },
      { key: 6, text: t('panel.pin.notConnected') },
      { key: 7, text: t('panel.pin.free') },
      { key: 8, text: t('panel.pin.unspecified') },
      { key: 9, text: t('panel.pin.powerInput') },
      { key: 10, text: t('panel.pin.powerOutput') },
      { key: 11, text: t('panel.pin.openEmitter') },
    ];

    return (
      <div className="pin-panel-horizontal" style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'row' }}>
        <div className="symbol-panel-title-vertical" style={{ margin: '4px 0 20px 4px' }}>{t('panel.pin.pinProperties')}</div>
        <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, overflow: 'auto', gap: '10px', padding: '10px' }}>
          {/* Name Section */}
          <div className="pin-panel-section">
          <div className="pin-panel-section-title">{t('panel.pin.name')}</div>
          <div className="pin-panel-section-content">
            <Checkbox
              label={t('panel.common.show')}
              checked={this.props.selectedPin.show_name}
              onChange={(e, data) =>
                this.props.dispatch(
                  actionSymbolEditPin({
                    ...this.props.selectedPin,
                    show_name: data.checked as boolean,
                  }),
                )
              }
            />
            <Input
              type="text"
              value={this.props.selectedPin.name}
              onChange={(e, data) =>
                this.props.dispatch(
                  actionSymbolEditPin({
                    ...this.props.selectedPin,
                    name: data.value,
                  }),
                )
              }
            />
            <Checkbox
              label={t('panel.pin.centreOnPin')}
              checked={this.props.selectedPin.centre_name}
              onChange={(e, data) =>
                this.props.dispatch(
                  actionSymbolEditPin({
                    ...this.props.selectedPin,
                    centre_name: data.checked as boolean,
                  }),
                )
              }
            />
          </div>
        </div>

        {/* Number Section */}
        <div className="pin-panel-section">
          <div className="pin-panel-section-title">{t('panel.pin.number')}</div>
          <div className="pin-panel-section-content">
            <Checkbox
              label={t('panel.common.show')}
              checked={this.props.selectedPin.show_number}
              onChange={(e, data) =>
                this.props.dispatch(
                  actionSymbolEditPin({
                    ...this.props.selectedPin,
                    show_number: data.checked as boolean,
                  }),
                )
              }
            />
            <Input
              type="text"
              value={this.props.selectedPin.number}
              onChange={(e, data) =>
                this.props.dispatch(
                  actionSymbolEditPin({
                    ...this.props.selectedPin,
                    number: data.value,
                  }),
                )
              }
            />
            <Field label={t('panel.pin.offset')}>
              <Input
                type="number"
                value={this.props.selectedPin.number_pos.toString()}
                onChange={(e, data) =>
                  this.props.dispatch(
                    actionSymbolEditPin({
                      ...this.props.selectedPin,
                      number_pos: Number(data.value),
                    }),
                  )
                }
              />
            </Field>
          </div>
        </div>

        {/* Type Section */}
        <div className="pin-panel-section">
          <div className="pin-panel-section-title">{t('panel.pin.type')}</div>
          <div className="pin-panel-section-content">
            <Field label={t('panel.pin.shape')}>
              <Dropdown
                value={
                  shapeOptions.find((o) => o.key === this.props.selectedPin.which)
                    ?.text || ''
                }
                onOptionSelect={(e, data) =>
                  this.props.dispatch(
                    actionSymbolEditPin({
                      ...this.props.selectedPin,
                      which: Number(data.optionValue),
                    }),
                  )
                }
              >
                {shapeOptions.map((o) => (
                  <Option key={o.key} value={o.key.toString()}>
                    {o.text}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <Field label={t('panel.pin.electrical')}>
              <Dropdown
                value={
                  elecOptions.find((o) => o.key === this.props.selectedPin.elec)
                    ?.text || ''
                }
                onOptionSelect={(e, data) =>
                  this.props.dispatch(
                    actionSymbolEditPin({
                      ...this.props.selectedPin,
                      elec: Number(data.optionValue),
                    }),
                  )
                }
              >
                {elecOptions.map((o) => (
                  <Option key={o.key} value={o.key.toString()}>
                    {o.text}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <Field label={t('panel.pin.length')}>
              <Input
                type="number"
                min={5}
                max={50}
                value={this.props.selectedPin.length.toString()}
                onChange={(e, data) =>
                  this.props.dispatch(
                    actionSymbolEditPin({
                      ...this.props.selectedPin,
                      length: Number(data.value),
                    }),
                  )
                }
              />
            </Field>
          </div>
        </div>
        </div>
      </div>
    );
  }
}

export default withTranslation()(PinPanel);
