import React, { Dispatch } from 'react';
import { SpiceFields } from '../controls/SpiceFields';
import { SpiceModelPicker } from './SpiceModelPicker';
import { actionSymbolEditSymbol } from '../../state/dispatcher/AppDispatcher';
import { tclibLibraryEntry, TextDisplayMethod } from '../../model/tclib';
import { DocItemTypes, type DocItem, type dsnPin } from '../../model/dsnItem';
import { symbolField } from '../../simulation/catalogBindings';
import {
  bindSpiceModel,
  changeSpiceTemplateMode,
  type SpiceModelChange,
  type SpiceModelTarget,
} from '../../simulation/spiceModelCatalog';

interface EditSpicePanelProps {
  editSymbol: tclibLibraryEntry;
  outlines: DocItem[][];
  dispatch: Dispatch<any>;
}

function libraryTarget(entry: tclibLibraryEntry, outlines: DocItem[][]): SpiceModelTarget {
  const pinsByOutline = outlines.map((items) =>
    items.filter((item): item is dsnPin => item.NodeName === DocItemTypes.Pin),
  );
  const first = pinsByOutline[0] ?? [];
  // A library template is shared by all parts. Only offer pin numbers
  // that are present in each outline or part that will use that template.
  const parts = outlines.length > 1 || entry.ppp <= 1
    ? pinsByOutline
    : Array.from({ length: entry.ppp }, (_, part) =>
        first.filter((pin) => pin.part === part || pin.which === 4),
      );
  const pins = first.filter(({ number }, index) =>
    first.findIndex((pin) => pin.number === number) === index &&
    parts.every((part) => part.some((pin) => pin.number === number)),
  ).map(({ number, name }) => ({ number, name }));
  return {
    pins,
    text: [
      { description: 'Name', value: entry.Name, display: entry.ShowName, show: false, position: [0, 0] },
      ...entry.Attributes.map(({ AttName, AttValue, ShowAtt }) => ({
        description: AttName, value: AttValue, display: ShowAtt, show: false, position: [0, 0] as [number, number],
      })),
    ],
  };
}

export class EditSpicePanel extends React.PureComponent<EditSpicePanelProps> {
  changeModel(symbol: SpiceModelTarget, selection?: SpiceModelChange) {
    const { editSymbol, dispatch } = this.props;
    const next = selection && typeof selection !== 'string'
      ? bindSpiceModel(symbol, selection).symbol
      : changeSpiceTemplateMode(symbol, typeof selection === 'string' ? selection : undefined);
    if (next === symbol) return;
    const Attributes = next.text.slice(1).map(({ description, value, display }) => ({
      AttName: description, AttValue: value, ShowAtt: display,
    }));
    dispatch(actionSymbolEditSymbol({ ...editSymbol, Attributes }));
  }

  changeValue(name: string, svalue: string) {
    const index = this.props.editSymbol.Attributes.findIndex(
      (a) => a.AttName === name,
    );
    const Attributes = [...this.props.editSymbol.Attributes];
    if (index >= 0) {
      Attributes[index] = { ...Attributes[index], AttValue: svalue };
    } else {
      Attributes.push({
        AttName: name,
        AttValue: svalue,
        ShowAtt: TextDisplayMethod.NeverShow,
      });
    }
    this.props.dispatch(
      actionSymbolEditSymbol({ ...this.props.editSymbol, Attributes }),
    );
  }

  render() {
    const { editSymbol, outlines } = this.props;
    if (!editSymbol) return null;
    const symbol = libraryTarget(editSymbol, outlines);

    return (
      <div style={{ height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SpiceModelPicker
          key={[editSymbol.id, editSymbol.NameID, editSymbol.SymbolID].join(':')}
          symbol={symbol}
          onChange={(selection) => this.changeModel(symbol, selection)}
        >
          <SpiceFields
            wide
            value={(name) => symbolField(symbol, name)}
            onChange={(name, value) => this.changeValue(name, value)}
          />
        </SpiceModelPicker>
      </div>
    );
  }
}

export default EditSpicePanel;
