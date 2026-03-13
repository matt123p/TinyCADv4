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
  RadioGroup,
  Radio,
} from '@fluentui/react-components';
import { AnnotateOptions } from '../../model/dsnDrawing';
import {
  actionAnnotate,
  actionCancelDialog,
} from '../../state/dispatcher/AppDispatcher';
import { connect } from 'react-redux';

interface AnnotateDialogProps extends WithTranslation {
  annotate: AnnotateOptions;
  dispatch: Dispatch<any>;
}

interface AnnotateDialogState {
  matching: string;
  all_sheets: number;
  add_references: number;
  which_references: number;
  start_value: number;
}

//
// This class represents the annotate dialogue
//
class AnnotateDialog extends React.PureComponent<
  AnnotateDialogProps,
  AnnotateDialogState
> {
  constructor(props: AnnotateDialogProps) {
    super(props);

    const annotate = this.props.annotate;
    this.state = {
      add_references: annotate.add_references ? 1 : 2,
      which_references: annotate.which_references,
      matching: annotate.matching,
      all_sheets: annotate.all_sheets ? 1 : 2,
      start_value: annotate.start_value,
    };
  }

  handleClickOk() {
    this.props.dispatch(
      actionAnnotate({
        add_references: this.state.add_references === 1,
        which_references: this.state.which_references,
        matching: this.state.matching,
        all_sheets: this.state.all_sheets === 1,
        start_value: this.state.start_value,
      }),
    );
  }

  handleClickCancel() {
    this.props.dispatch(actionCancelDialog());
  }

  handleChange(newValue: string, name: string) {
    this.setState((s) => {
      switch (name) {
        case 'matching':
          return { ...s, matching: newValue };
        case 'start_value':
          return { ...s, start_value: Number(newValue) };
      }
      return s;
    });
  }

  render() {
    const { t } = this.props;
    return (
      <Dialog open={true} onOpenChange={() => this.handleClickCancel()}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t('dialogues.annotate.title')}</DialogTitle>
            <DialogContent>
              <div style={{ display: 'flex', flexDirection: 'column', rowGap: '10px' }}>
                <Field label={t('dialogues.annotate.action')}>
                  <RadioGroup
                    value={this.state.add_references.toString()}
                    onChange={(e, data) =>
                      this.setState((s) => ({ ...s, add_references: Number(data.value) }))
                    }
                  >
                    <Radio value="1" label={t('dialogues.annotate.addReferences')} />
                    <Radio value="2" label={t('dialogues.annotate.removeReferences')} />
                  </RadioGroup>
                </Field>
                <Field label={t('dialogues.annotate.startValue')}>
                  <Input
                    type="text"
                    value={this.state.start_value.toString()}
                    onChange={(e, data) => this.handleChange(data.value, 'start_value')}
                    disabled={this.state.add_references === 2}
                  />
                </Field>
                <Field label={t('dialogues.annotate.references')}>
                  <RadioGroup
                    value={this.state.which_references.toString()}
                    onChange={(e, data) =>
                      this.setState((s) => ({
                        ...s,
                        which_references: Number(data.value),
                      }))
                    }
                  >
                    <Radio value="0" label={t('dialogues.annotate.allReferences')} />
                    <Radio value="1" label={t('dialogues.annotate.unnumberedReferences')} />
                    <Radio value="2" label={t('dialogues.annotate.referencesMatching')} />
                  </RadioGroup>
                </Field>
                <Field label={t('dialogues.annotate.matching')}>
                  <Input
                    type="text"
                    value={this.state.matching}
                    onChange={(e, data) => this.handleChange(data.value, 'matching')}
                    disabled={this.state.which_references !== 2}
                  />
                </Field>
                <Field label={t('dialogues.annotate.sheets')}>
                  <RadioGroup
                    value={this.state.all_sheets.toString()}
                    onChange={(e, data) =>
                      this.setState((s) => ({ ...s, all_sheets: Number(data.value) }))
                    }
                  >
                    <Radio value="2" label={t('dialogues.annotate.thisSheet')} />
                    <Radio value="1" label={t('dialogues.annotate.allSheets')} />
                  </RadioGroup>
                </Field>
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={() => this.handleClickOk()}>
                {t('common.ok')}
              </Button>
              <Button appearance="secondary" onClick={() => this.handleClickCancel()}>
                {t('common.cancel')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    );
  }
}

export default connect()(withTranslation()(AnnotateDialog));
