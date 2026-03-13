import React from 'react';
import { WithTranslation, withTranslation } from 'react-i18next';
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogContent,
  DialogBody,
  DialogActions,
  Button,
  Dropdown,
  Option,
} from '@fluentui/react-components';
import {
  actionCancelDialog,
  actionUpdateNetlistHints,
} from '../../state/dispatcher/AppDispatcher';
import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import { docDrawing } from '../../state/undo/undo';
import { wkrGenerateNetlist } from '../../web-worker/worker';
import { downloadNetlist } from '../../io/netlists/netlistFiles';

interface NetlistDialogProps extends WithTranslation {
  dispatch: Dispatch<any>;
}

interface NetlistDialogState {
  file_type: string;
  busy: boolean;
}

const file_types = [
  'PADS-PCB',
  'PADS-PCB-WITH-VALUE',
  'Eagle SCR',
  'Protel',
  'gEDA PCB',
];

//
// This class represents the netlist dialogue
//
class NetlistDialog extends React.PureComponent<
  NetlistDialogProps,
  NetlistDialogState
> {
  private cancel = false;

  constructor(props: NetlistDialogProps) {
    super(props);

    this.handleClickOk = this.handleClickOk.bind(this);
    this.handleClickCancel = this.handleClickCancel.bind(this);

    this.state = {
      file_type: null,
      busy: false,
    };
  }

  handleClickOk() {
    if (!this.state.busy) {
      this.setState({ busy: true });
      this.props.dispatch(
        (dispatch: Dispatch, getState: { (): docDrawing }) => {
          wkrGenerateNetlist(getState().docStore.present.drawing).then(
            (netlist) => {
              if (!this.cancel) {
                // Write the netlist hints back to the drawing
                this.props.dispatch(actionUpdateNetlistHints(netlist));

                // We can close the dialogue
                this.props.dispatch(actionCancelDialog());

                // Now save the netlist
                downloadNetlist(
                  getState().altStore.file.name,
                  this.state.file_type,
                  netlist,
                );
              }
            },
          );
        },
      );
    }
  }

  handleClickCancel() {
    this.cancel = true;
    this.props.dispatch(actionCancelDialog());
  }

  handleNetlistChange(value: string) {
    this.setState({
      file_type: value,
    });
  }

  render() {
    const { t } = this.props;
    return (
      <Dialog open={true} onOpenChange={this.handleClickCancel}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t('dialogues.netlist.title')}</DialogTitle>
            <DialogContent>
              <div style={{ display: 'flex', flexDirection: 'column', rowGap: '10px' }}>
                <Dropdown
                  placeholder={t('dialogues.netlist.selectOutputFormat')}
                  value={this.state.file_type || ''}
                  onOptionSelect={(e, data) =>
                    this.handleNetlistChange(data.optionValue as string)
                  }
                >
                  {file_types.map((t) => (
                    <Option key={t} value={t}>
                      {t}
                    </Option>
                  ))}
                </Dropdown>
              </div>
            </DialogContent>
            <DialogActions>
              {this.state.busy ? <div className="lds-hourglass"></div> : null}
              <Button
                appearance="primary"
                onClick={this.handleClickOk}
                disabled={this.state.busy || !this.state.file_type}
              >
                {t('common.ok')}
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

export default connect()(withTranslation()(NetlistDialog));
