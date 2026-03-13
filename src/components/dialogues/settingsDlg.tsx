import React, { Dispatch } from 'react';
import { WithTranslation, withTranslation } from 'react-i18next';
import {
  SetSettingModel,
  actionUpdateSettings,
  actionCancelDialog,
} from '../../state/dispatcher/AppDispatcher';
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogContent,
  DialogBody,
  DialogActions,
  Button,
  Checkbox,
  Field,
  Input,
  RadioGroup,
  Radio,
} from '@fluentui/react-components';
import { connect } from 'react-redux';

interface SettingsDialogProps extends WithTranslation {
  details: SetSettingModel;
  dispatch: Dispatch<any>;
}

interface SettingsDialogState {
  grid: number;
  grid_snap: boolean;
  show_grid: boolean;
  units: number;
  grid_spacing: number;
  grid_units: number;
}

//
// This class represents the settings dialogue
//
class SettingsDialog extends React.PureComponent<
  SettingsDialogProps,
  SettingsDialogState
> {
  constructor(props: SettingsDialogProps) {
    super(props);

    this.handleClickOk = this.handleClickOk.bind(this);
    this.handleClickCancel = this.handleClickCancel.bind(this);

    // 10th inch
    let grid_units = this.props.details.grid / 5.0 / 2.54;
    if (this.props.details.units === 0) {
      // mm
      grid_units = this.props.details.grid / 5.0;
    }

    let grid_spacing = 0;
    if (this.props.details.grid === 10) {
      grid_spacing = 0;
    } else if (this.props.details.grid === 5) {
      grid_spacing = 1;
    } else {
      grid_spacing = 2;
    }

    this.state = {
      grid: this.props.details.grid,
      grid_snap: this.props.details.grid_snap,
      show_grid: this.props.details.show_grid,
      grid_spacing: grid_spacing,
      grid_units: grid_units,
      units: this.props.details.units,
    };
  }

  handleClickOk() {
    this.props.dispatch(
      actionUpdateSettings({
        grid: this.state.grid,
        grid_snap: this.state.grid_snap,
        show_grid: this.state.show_grid,
        units: this.state.units,
      }),
    );
  }

  handleClickCancel() {
    this.props.dispatch(actionCancelDialog());
  }

  handleCheckboxChange(bvalue: boolean, name: string) {
    let grid_snap = name === 'grid_snap' ? bvalue : this.state.grid_snap;
    let show_grid = name === 'show_grid' ? bvalue : this.state.show_grid;

    this.setState({
      grid_snap: grid_snap,
      show_grid: show_grid,
    });
  }

  handleChange(svalue: string, name: string) {
    let grid = this.state.grid;
    let grid_units = this.state.grid_units;
    let units = this.state.units;
    let grid_spacing = this.state.grid_spacing;
    if (name === 'grid') {
      grid = Number(svalue);
    } else if (name === 'units') {
      units = Number(svalue);
    } else if (name === 'grid_spacing') {
      grid_spacing = Number(svalue);
      switch (grid_spacing) {
        case 0:
          grid = 10;
          break;
        case 1:
          grid = 5;
          break;
      }
    }

    if (name !== 'grid_units') {
      if (units === 0) {
        // mm
        grid_units = grid / 5.0;
      } else {
        // 10th inch
        grid_units = grid / 5.0 / 2.54;
      }
    } else {
      grid_units = Number(svalue);
      if (units === 0) {
        // mm
        grid = grid_units * 5.0;
      } else {
        // 10th inch
        grid = grid_units * 2.54 * 5.0;
      }
    }

    this.setState({
      units: units,
      grid: grid,
      grid_units: grid_units,
      grid_spacing: grid_spacing,
    });
  }

  setUnits(units: number) {
    let grid_units = this.state.grid_units;
    let grid = this.state.grid;
    if (units === 0) {
      // mm
      grid_units = grid / 5.0;
    } else {
      // 10th inch
      grid_units = grid / 5.0 / 2.54;
    }

    this.setState({
      units: units,
      grid_units: grid_units,
    });
  }

  render() {
    const { t } = this.props;
    return (
      <Dialog open={true} onOpenChange={this.handleClickCancel}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t('dialogues.settings.title')}</DialogTitle>
            <DialogContent>
              <div style={{ display: 'flex', flexDirection: 'column', rowGap: '10px' }}>
                <strong>{t('dialogues.settings.grid')}</strong>
                <Checkbox
                  label={t('dialogues.settings.showGrid')}
                  checked={this.state.show_grid}
                  onChange={(e, data) =>
                    this.handleCheckboxChange(data.checked as boolean, 'show_grid')
                  }
                />
                <Checkbox
                  label={t('dialogues.settings.snapToGrid')}
                  checked={this.state.grid_snap}
                  onChange={(e, data) =>
                    this.handleCheckboxChange(data.checked as boolean, 'grid_snap')
                  }
                />
                <Field label={t('dialogues.settings.gridSpacing')}>
                  <RadioGroup
                    value={this.state.grid_spacing.toString()}
                    onChange={(e, data) =>
                      this.handleChange(data.value, 'grid_spacing')
                    }
                  >
                    <Radio value="0" label={t('dialogues.settings.normalGridSpacing')} />
                    <Radio value="1" label={t('dialogues.settings.fineGridSpacing')} />
                    <Radio value="2" label={t('dialogues.settings.userGridSpacing')} />
                  </RadioGroup>
                </Field>
                <Input
                  type="number"
                  value={this.state.grid_units.toString()}
                  disabled={this.state.grid_spacing !== 2}
                  onChange={(e, data) => this.handleChange(data.value, 'grid_units')}
                />
                <Field label={t('dialogues.settings.units')}>
                  <RadioGroup
                    value={this.state.units.toString()}
                    onChange={(e, data) => this.setUnits(Number(data.value))}
                  >
                    <Radio value="0" label={t('dialogues.settings.millimeters')} />
                    <Radio value="1" label={t('dialogues.settings.inches')} />
                  </RadioGroup>
                </Field>
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={this.handleClickOk}>
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

export default connect()(withTranslation()(SettingsDialog));
