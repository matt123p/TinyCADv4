import React, { Dispatch } from 'react';
import { WithTranslation, withTranslation } from 'react-i18next';
import {
  actionSetPPP,
  actionSymbolEditOutline,
  actionSymbolEditSymbol,
} from '../../state/dispatcher/AppDispatcher';
import { tclibLibraryEntry } from '../../model/tclib';
import { DocItem } from '../../model/dsnItem';
import update from 'immutability-helper';
import {
  Dropdown,
  Option,
  Field,
  Textarea,
} from '@fluentui/react-components';
import { PropertyItem, EditablePropertyTable } from '../controls/EditablePropertyTable';

interface EditSymbolPanelProps extends WithTranslation {
  editSymbol: tclibLibraryEntry;
  heterogeneous: boolean;
  items: DocItem[];
  dispatch: Dispatch<any>;
}

export class EditSymbolPanel extends React.PureComponent<EditSymbolPanelProps> {
  constructor(props: EditSymbolPanelProps) {
    super(props);
  }

  changeValue(id: string | number, svalue: string) {
    const idx = Number(id);
    switch (idx) {
      case 0:
        this.props.dispatch(
          actionSymbolEditSymbol({
            ...this.props.editSymbol,
            Reference: svalue,
          }),
        );
        break;
      case 1:
        this.props.dispatch(
          actionSymbolEditSymbol({
            ...this.props.editSymbol,
            Name: svalue,
          }),
        );
        break;
      default:
        this.props.dispatch(
          actionSymbolEditSymbol({
            ...this.props.editSymbol,
            Attributes: update(this.props.editSymbol.Attributes, {
              [idx - 2]: {
                AttValue: { $set: svalue },
              },
            }),
          }),
        );
        break;
    }
  }

  changeName(id: string | number, svalue: string) {
    const idx = Number(id);
    switch (idx) {
      case 0:
      case 1:
        break;
      default:
        this.props.dispatch(
          actionSymbolEditSymbol({
            ...this.props.editSymbol,
            Attributes: update(this.props.editSymbol.Attributes, {
              [idx - 2]: {
                AttName: { $set: svalue },
              },
            }),
          }),
        );
        break;
    }
  }

  changeDescription(value: string) {
    this.props.dispatch(
      actionSymbolEditSymbol({
        ...this.props.editSymbol,
        Description: value,
      }),
    );
  }

  changeShowAtt(id: string | number, value: number) {
    const idx = Number(id);
    switch (idx) {
      case 0:
        this.props.dispatch(
          actionSymbolEditSymbol({
            ...this.props.editSymbol,
            ShowRef: value,
          }),
        );
        break;
      case 1:
        this.props.dispatch(
          actionSymbolEditSymbol({
            ...this.props.editSymbol,
            ShowName: value,
          }),
        );
        break;
      default:
        this.props.dispatch(
          actionSymbolEditSymbol({
            ...this.props.editSymbol,
            Attributes: update(this.props.editSymbol.Attributes, {
              [idx - 2]: {
                ShowAtt: { $set: value },
              },
            }),
          }),
        );
        break;
    }
  }

  addAttribute() {
    this.props.dispatch(
      actionSymbolEditSymbol({
        ...this.props.editSymbol,
        Attributes: update(this.props.editSymbol.Attributes, {
          $push: [{ AttName: 'Other', AttValue: '', ShowAtt: 1 }],
        }),
      }),
    );
  }

  deleteAttribute(id: string | number) {
    const idx = Number(id);
    this.props.dispatch(
      actionSymbolEditSymbol({
        ...this.props.editSymbol,
        Attributes: update(this.props.editSymbol.Attributes, {
          $splice: [[idx - 2, 1]],
        }),
      }),
    );
  }

  changePPP(value: number) {
    this.props.dispatch(actionSetPPP(value));
  }

  changeOutline(heterogeneous: boolean) {
    this.props.dispatch(actionSymbolEditOutline(heterogeneous));
  }

  render() {
    const { t } = this.props;
    if (!this.props.editSymbol) {
      return null;
    }

    const displayOptions = [
      { key: 0, text: t('panel.editSymbol.showValueOnly') },
      { key: 1, text: t('panel.editSymbol.hideValue') },
      { key: 2, text: t('panel.editSymbol.neverShow') },
      { key: 3, text: t('panel.editSymbol.showValueExtraOnly') },
      { key: 4, text: t('panel.editSymbol.showNameValueWhenPresent') },
      { key: 5, text: t('panel.editSymbol.showNameValue') },
      { key: 6, text: t('panel.editSymbol.showValueWhenPresent') },
    ];

    const pppOptions = [
      { key: 0, text: t('panel.editSymbol.sameOutlineAllParts') },
      { key: 1, text: t('panel.editSymbol.differentOutlinePerPart') },
    ];

    const attributeItems: PropertyItem[] = this.props.editSymbol.Attributes.map((v, index) => ({
      id: index + 2,
      name: v.AttName,
      value: v.AttValue,
      show: v.ShowAtt,
      editable: true,
      deletable: true,
    })).filter((v) => v.name !== 'Ref' && !v.name.startsWith('$$SPICE'));

    const items: PropertyItem[] = [
      {
        id: 0,
        name: 'Ref',
        value: this.props.editSymbol.Reference,
        show: this.props.editSymbol.ShowRef,
        editable: false,
        deletable: false,
        isRef: true,
      },
      {
        id: 1,
        name: 'Name',
        value: this.props.editSymbol.Name,
        show: this.props.editSymbol.ShowName,
        editable: false,
        deletable: false,
        isRef: false,
      },
      ...attributeItems
    ];

    return (
      <div style={{ display: 'flex', flexDirection: 'row', gap: '10px', height: '100%' }}>
        <div style={{ flex: 2, overflow: 'hidden', minHeight: '200px' }}>
          <EditablePropertyTable
            title={t('panel.editSymbol.symbolAttributes')}
            items={items}
            showOptions={displayOptions}
            onNameChange={(id, val) => this.changeName(id, val)}
            onValueChange={(id, val) => this.changeValue(id, val)}
            onShowChange={(id, val) => this.changeShowAtt(id, val)}
            onDelete={(id) => this.deleteAttribute(id)}
            onAdd={() => this.addAttribute()}
          />
        </div>
        
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto' }}>
          <Field label={t('panel.editSymbol.outline')}>
            <Dropdown
              value={pppOptions[this.props.heterogeneous ? 1 : 0].text}
              onOptionSelect={(e, data) =>
                this.changeOutline(data.optionValue === '1')
              }
            >
              {pppOptions.map((o) => (
                <Option key={o.key} value={o.key.toString()}>
                  {o.text}
                </Option>
              ))}
            </Dropdown>
          </Field>
          
          <Field label={t('panel.editSymbol.description')}>
            <Textarea
              value={this.props.editSymbol.Description}
              onChange={(e, data) => this.changeDescription(data.value)}
              style={{ minHeight: '100px', resize: 'vertical' }}
            />
          </Field>
        </div>
      </div>
    );
  }
}

export default withTranslation()(EditSymbolPanel);
