import React, { Dispatch } from 'react';
import { WithTranslation, withTranslation } from 'react-i18next';
import { Field, Input, Textarea } from '@fluentui/react-components';
import { actionSymbolEditSymbol } from '../../state/dispatcher/AppDispatcher';
import { tclibLibraryEntry } from '../../model/tclib';
import { DocItem } from '../../model/dsnItem';
import update from 'immutability-helper';

interface EditSpicePanelProps extends WithTranslation {
  editSymbol: tclibLibraryEntry;
  heterogeneous: boolean;
  items: DocItem[];
  dispatch: Dispatch<any>;
}

export class EditSpicePanel extends React.PureComponent<EditSpicePanelProps> {
  constructor(props: EditSpicePanelProps) {
    super(props);
  }

  changeValue(name: string, svalue: string) {
    const index = this.props.editSymbol.Attributes.findIndex(
      (a) => a.AttName === name,
    );
    if (index >= 0) {
      this.props.dispatch(
        actionSymbolEditSymbol({
          ...this.props.editSymbol,
          Attributes: update(this.props.editSymbol.Attributes, {
            [index]: {
              AttValue: { $set: svalue },
            },
          }),
        }),
      );
    }
  }

  render() {
    const { t } = this.props;
    if (!this.props.editSymbol) {
      return null;
    }

    const spice = this.props.editSymbol.Attributes.find(
      (a) => a.AttName === '$$SPICE',
    );
    const spiceProlog = this.props.editSymbol.Attributes.find(
      (a) => a.AttName === '$$SPICE_PROLOG',
    );
    const spiceEpilog = this.props.editSymbol.Attributes.find(
      (a) => a.AttName === '$$SPICE_EPILOG',
    );
    const spicePrologPri = this.props.editSymbol.Attributes.find(
      (a) => a.AttName === '$$SPICE_PROLOG_PRIORITY',
    );
    const spiceEpilogPri = this.props.editSymbol.Attributes.find(
      (a) => a.AttName === '$$SPICE_EPILOG_PRIORITY',
    );

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'row', gap: '10px', flex: 1, maxWidth: '800px' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label className="m-label">{t('panel.editSpice.model')}</label>
            <Textarea
              className="spice-text"
              style={{ flex: 1, resize: 'none' }}
              value={spice?.AttValue}
              onChange={(e, data) => this.changeValue('$$SPICE', data.value)}
            />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="m-label">{t('panel.editSpice.prologue')}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '12px' }}>{t('panel.editSpice.priority')}:</span>
                <Input
                  type="number"
                  min={0}
                  max={9}
                  style={{ width: '60px' }}
                  value={spicePrologPri?.AttValue ?? '5'}
                  onChange={(e, data) => this.changeValue('$$SPICE_PROLOG_PRIORITY', data.value)}
                />
              </div>
            </div>
            <Textarea
              className="spice-text"
              style={{ flex: 1, resize: 'none' }}
              value={spiceProlog?.AttValue}
              onChange={(e, data) => this.changeValue('$$SPICE_PROLOG', data.value)}
            />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="m-label">{t('panel.editSpice.epilogue')}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '12px' }}>{t('panel.editSpice.priority')}:</span>
                <Input
                  type="number"
                  min={0}
                  max={9}
                  style={{ width: '60px' }}
                  value={spiceEpilogPri?.AttValue ?? '5'}
                  onChange={(e, data) => this.changeValue('$$SPICE_EPILOG_PRIORITY', data.value)}
                />
              </div>
            </div>
            <Textarea
              className="spice-text"
              style={{ flex: 1, resize: 'none' }}
              value={spiceEpilog?.AttValue}
              onChange={(e, data) => this.changeValue('$$SPICE_EPILOG', data.value)}
            />
          </div>
        </div>
      </div>
    );
  }
}

export default withTranslation()(EditSpicePanel);
