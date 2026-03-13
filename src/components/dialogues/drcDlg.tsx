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
  Checkbox,
} from '@fluentui/react-components';
import { DrcOptions } from '../../model/dsnDrawing';
import {
  actionDrc,
  actionCancelDialog,
} from '../../state/dispatcher/AppDispatcher';
import { connect } from 'react-redux';
import { wkrGenerateNetlist } from '../../web-worker/worker';
import { Dispatch, AnyAction } from 'redux';
import { ThunkDispatch } from 'redux-thunk';
import { docDrawing } from '../../state/undo/undo';

interface DrcDialogProps extends WithTranslation {
  drc: DrcOptions;
  dispatch: ThunkDispatch<any, any, AnyAction>;
}

interface DrcDialogState {
  DupRef: boolean;
  UnConnect: boolean;
  NoConnect: boolean;
  Power: boolean;
  OutputPwr: boolean;
  Output: boolean;
  NoOutput: boolean;
  UnConnected: boolean;
  MultipleNetNames: boolean;
  NonCaseDistinctNetNames: boolean;
  UnAssignedRefDes: boolean;
  PowerInputConflict: boolean;
  PowerOutputConflict: boolean;
  busy: boolean;
}

//
// This class represents the DRC dialogue
//
class DrcDialog extends React.PureComponent<DrcDialogProps, DrcDialogState> {
  private cancel = false;

  constructor(props: DrcDialogProps) {
    super(props);

    let drc = this.props.drc;
    this.state = {
      DupRef: drc.DupRef,
      UnConnect: drc.UnConnect,
      NoConnect: drc.NoConnect,
      Power: drc.Power,
      OutputPwr: drc.OutputPwr,
      Output: drc.Output,
      NoOutput: drc.NoOutput,
      UnConnected: drc.UnConnected,
      MultipleNetNames: drc.MultipleNetNames,
      NonCaseDistinctNetNames: drc.NonCaseDistinctNetNames,
      UnAssignedRefDes: drc.UnAssignedRefDes,
      PowerInputConflict: drc.PowerInputConflict,
      PowerOutputConflict: drc.PowerOutputConflict,
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
                dispatch(actionDrc(this.state, netlist));
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

  handleCheckboxChange(bvalue: boolean, name: string) {
    this.setState((s) => {
      switch (name) {
        case '0':
          return { ...s, DupRef: bvalue };
        case '1':
          return { ...s, UnConnect: bvalue };
        case '2':
          return { ...s, NoConnect: bvalue };
        case '3':
          return { ...s, Power: bvalue };
        case '4':
          return { ...s, OutputPwr: bvalue };
        case '5':
          return { ...s, Output: bvalue };
        case '6':
          return { ...s, NoOutput: bvalue };
        case '7':
          return { ...s, UnConnected: bvalue };
        case '8':
          return { ...s, MultipleNetNames: bvalue };
        case '9':
          return { ...s, NonCaseDistinctNetNames: bvalue };
        case '10':
          return { ...s, UnAssignedRefDes: bvalue };
        case '11':
          return { ...s, PowerInputConflict: bvalue };
        case '12':
          return { ...s, PowerOutputConflict: bvalue };
      }
      return s;
    });
  }

  render() {
    const { t } = this.props;
    const names = [
      { value: this.state.DupRef, name: t('dialogues.drc.duplicatedReferences') },
      { value: this.state.UnConnect, name: t('dialogues.drc.unconnectedItems') },
      {
        value: this.state.NoConnect,
        name: t('dialogues.drc.multipleOnNoConnect'),
      },
      { value: this.state.Power, name: t('dialogues.drc.powerToPower') },
      { value: this.state.OutputPwr, name: t('dialogues.drc.powerToOutput') },
      { value: this.state.Output, name: t('dialogues.drc.outputToOutput') },
      { value: this.state.NoOutput, name: t('dialogues.drc.noOutputDrivingInputs') },
      { value: this.state.UnConnected, name: t('dialogues.drc.unconnectedNets') },
      {
        value: this.state.MultipleNetNames,
        name: t('dialogues.drc.multipleNetNames'),
      },
      {
        value: this.state.NonCaseDistinctNetNames,
        name: t('dialogues.drc.nonCaseDistinctNames'),
      },
      {
        value: this.state.UnAssignedRefDes,
        name: t('dialogues.drc.unassignedRefDes'),
      },
      {
        value: this.state.PowerInputConflict,
        name: t('dialogues.drc.multiplePowerInputsNoDriver'),
      },
      {
        value: this.state.PowerOutputConflict,
        name: t('dialogues.drc.multiplePowerOutputs'),
      },
    ];

    const checkboxes = names.map((item, i) => (
      <Checkbox
        key={i}
        label={item.name}
        checked={item.value}
        onChange={(e, data) =>
          this.handleCheckboxChange(data.checked as boolean, i.toString())
        }
      />
    ));

    return (
      <Dialog open={true} onOpenChange={() => this.handleClickCancel()}>
        <DialogSurface style={{ maxWidth: '500px', minWidth: '500px' }}>
          <DialogBody>
            <DialogTitle>{t('dialogues.drc.title')}</DialogTitle>
            <DialogContent>
              <div style={{ display: 'flex', flexDirection: 'column', rowGap: '10px' }}>
                <strong>{t('dialogues.drc.settings')}</strong>
                {checkboxes}
              </div>
            </DialogContent>
            <DialogActions>
              {this.state.busy ? <div className="lds-hourglass"></div> : null}
              <Button
                appearance="primary"
                onClick={() => this.handleClickOk()}
                disabled={this.state.busy}
              >
                {t('common.ok')}
              </Button>
              <Button
                appearance="secondary"
                onClick={() => this.handleClickCancel()}
              >
                {t('common.cancel')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    );
  }
}

export default connect()(withTranslation()(DrcDialog));
