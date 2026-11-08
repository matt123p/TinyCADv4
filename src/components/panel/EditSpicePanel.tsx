import React, { Dispatch } from 'react';
import { WithTranslation, withTranslation } from 'react-i18next';
import { SpiceFields } from '../controls/SpiceFields';
import { actionSymbolEditSymbol } from '../../state/dispatcher/AppDispatcher';
import { tclibLibraryEntry, TextDisplayMethod } from '../../model/tclib';
import { DocItem } from '../../model/dsnItem';

interface EditSpicePanelProps extends WithTranslation {
  editSymbol: tclibLibraryEntry;
  heterogeneous: boolean;
  items: DocItem[];
  dispatch: Dispatch<any>;
}

export class EditSpicePanel extends React.PureComponent<EditSpicePanelProps> {
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
    const { editSymbol } = this.props;
    if (!editSymbol) return null;

    return (
      <div style={{ height: '100%', overflowY: 'auto' }}>
        <SpiceFields
          key={[editSymbol.id, editSymbol.NameID, editSymbol.SymbolID].join(':')}
          wide
          value={(name) =>
            editSymbol.Attributes.find((a) => a.AttName === name)?.AttValue
          }
          onChange={(name, value) => this.changeValue(name, value)}
        />
      </div>
    );
  }
}

export default withTranslation()(EditSpicePanel);
