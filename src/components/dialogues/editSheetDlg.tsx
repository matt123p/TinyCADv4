import React, { Dispatch } from 'react';
import { WithTranslation, withTranslation } from 'react-i18next';
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogContent,
  DialogBody,
  DialogActions,
  Button,
  Field,
  Input,
} from '@fluentui/react-components';
import {
  actionSheetRename,
  actionSheetAdd,
  actionCancelDialog,
} from '../../state/dispatcher/AppDispatcher';
import { connect } from 'react-redux';

interface EditSheetDialogProps extends WithTranslation {
  name: string;
  type: string;
  dispatch: Dispatch<any>;
}

interface EditSheetDialogState {
  value: string;
}

//
// This class represents the edit sheet name dialogue
//
class EditSheetDialog extends React.PureComponent<
  EditSheetDialogProps,
  EditSheetDialogState
> {
  constructor(props: EditSheetDialogProps) {
    super(props);

    this.handleClickOk = this.handleClickOk.bind(this);
    this.handleClickCancel = this.handleClickCancel.bind(this);
    this.state = {
      value: this.props.name,
    };
  }

  handleClickOk() {
    if (this.props.type === 'rename') {
      this.props.dispatch(actionSheetRename(this.state.value));
    } else {
      this.props.dispatch(actionSheetAdd(this.state.value));
    }
  }

  handleClickCancel() {
    this.props.dispatch(actionCancelDialog());
  }

  handleChange(svalue: string) {
    this.setState({ value: svalue });
  }

  render() {
    const { t } = this.props;
    let title = this.props.type === 'rename' ? t('dialogues.editSheet.renameTitle') : t('dialogues.editSheet.newTitle');
    let ok = this.props.type === 'rename' ? t('common.rename') : t('common.add');

    return (
      <Dialog open={true} onOpenChange={this.handleClickCancel}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
              <Field label={t('dialogues.editSheet.sheetName')}>
                <Input
                  type="text"
                  value={this.state.value}
                  onChange={(e, data) => this.handleChange(data.value)}
                />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={this.handleClickOk}>
                {ok}
              </Button>
              <Button appearance="secondary" onClick={this.handleClickCancel}>
                {t('common.cancel')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    );
  }
}

export default connect()(withTranslation()(EditSheetDialog));
