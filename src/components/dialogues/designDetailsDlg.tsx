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
  Checkbox,
  Field,
  Input,
  Tab,
  TabList,
  TabValue,
} from '@fluentui/react-components';
import { SheetDetails } from '../../model/dsnDrawing';
import {
  actionUpdateDetails,
  actionUpdateDetailsAllSheets,
  actionCancelDialog,
} from '../../state/dispatcher/AppDispatcher';
import { connect } from 'react-redux';

interface DesignDetailsDialogProps extends WithTranslation {
  details: SheetDetails;
  dispatch: Dispatch<any>;
}

interface DesignDetailsDialogState {
  selectedTab: TabValue;
  author: string;
  revision: string;
  organisation: string;
  date: string;
  title: string;
  sheets: string;
  show_details: boolean;
  show_guides: boolean;
  horiz_guide: number;
  vert_guide: number;
  applyToAllSheets: boolean;
}

//
// This class represents the design details dialogue
//
class DesignDetailsDialog extends React.PureComponent<
  DesignDetailsDialogProps,
  DesignDetailsDialogState
> {
  constructor(props: DesignDetailsDialogProps) {
    super(props);

    this.handleClickOk = this.handleClickOk.bind(this);
    this.handleClickCancel = this.handleClickCancel.bind(this);

    this.state = {
      selectedTab: 'details',
      author: this.props.details.author,
      revision: this.props.details.revision,
      organisation: this.props.details.organisation,
      date: this.props.details.date,
      title: this.props.details.title,
      sheets: this.props.details.sheets,
      show_details: this.props.details.show_details,
      show_guides: this.props.details.show_guides,
      horiz_guide: this.props.details.horiz_guide,
      vert_guide: this.props.details.vert_guide,
      applyToAllSheets: false,
    };
  }

  handleClickOk() {
    const details = {
      author: this.state.author,
      revision: this.state.revision,
      organisation: this.state.organisation,
      date: this.state.date,
      title: this.state.title,
      sheets: this.state.sheets,
      show_details: this.state.show_details,
      show_guides: this.state.show_guides,
      horiz_guide: this.state.horiz_guide,
      vert_guide: this.state.vert_guide,
      // Include other required SheetDetails properties with current values from props
      docnumber: this.props.details.docnumber,
      filename: this.props.details.filename,
      page_size: this.props.details.page_size,
      grid_snap: this.props.details.grid_snap,
      grid: this.props.details.grid,
    };

    if (this.state.applyToAllSheets) {
      this.props.dispatch(actionUpdateDetailsAllSheets(details));
    } else {
      this.props.dispatch(actionUpdateDetails(details));
    }
    this.props.dispatch(actionCancelDialog());
  }

  handleClickCancel() {
    this.props.dispatch(actionCancelDialog());
  }

  private parseGuideSegments(value: string, currentValue: number): number {
    const parsedValue = Number(value);
    if (!Number.isFinite(parsedValue)) {
      return currentValue;
    }
    return Math.max(1, Math.round(parsedValue));
  }

  handleChange(svalue: string, name: string) {
    this.setState((s) => {
      switch (name) {
        case 'author':
          return { ...s, author: svalue };
        case 'revision':
          return { ...s, revision: svalue };
        case 'organisation':
          return { ...s, organisation: svalue };
        case 'date':
          return { ...s, date: svalue };
        case 'title':
          return { ...s, title: svalue };
        case 'sheets':
          return { ...s, sheets: svalue };
        case 'horiz_guide':
          return {
            ...s,
            horiz_guide: this.parseGuideSegments(svalue, s.horiz_guide),
          };
        case 'vert_guide':
          return {
            ...s,
            vert_guide: this.parseGuideSegments(svalue, s.vert_guide),
          };
      }
      return s;
    });
  }

  handleCheckboxChange(bvalue: boolean, name: string) {
    this.setState((s) => {
      if (name === 'show_details') {
        return { ...s, show_details: bvalue };
      }
      if (name === 'show_guides') {
        return { ...s, show_guides: bvalue };
      }
      if (name === 'applyToAllSheets') {
        return { ...s, applyToAllSheets: bvalue };
      }
      return s;
    });
  }

  render() {
    const { t } = this.props;
    return (
      <Dialog open={true} onOpenChange={this.handleClickCancel}>
        <DialogSurface style={{ width: '520px', maxWidth: '90vw' }}>
          <DialogBody>
            <DialogTitle>{t('dialogues.designDetails.title')}</DialogTitle>
            <DialogContent>
              <div style={{ display: 'flex', flexDirection: 'column', rowGap: '10px' }}>
                <TabList
                  selectedValue={this.state.selectedTab}
                  onTabSelect={(e, data) =>
                    this.setState({ selectedTab: data.value as TabValue })
                  }
                >
                  <Tab value="details">{t('dialogues.designDetails.detailsTab')}</Tab>
                  <Tab value="guides">{t('dialogues.designDetails.guidesTab')}</Tab>
                </TabList>
                <div
                  style={{
                    height: '380px',
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    rowGap: '10px',
                  }}
                >
                  {this.state.selectedTab === 'details' ? (
                    <>
                      <Field label={t('dialogues.designDetails.author')}>
                        <Input
                          type="text"
                          value={this.state.author}
                          onChange={(e, data) => this.handleChange(data.value, 'author')}
                        />
                      </Field>
                      <Field label={t('dialogues.designDetails.revision')}>
                        <Input
                          type="text"
                          value={this.state.revision}
                          onChange={(e, data) => this.handleChange(data.value, 'revision')}
                        />
                      </Field>
                      <Field label={t('dialogues.designDetails.organisation')}>
                        <Input
                          type="text"
                          value={this.state.organisation}
                          onChange={(e, data) => this.handleChange(data.value, 'organisation')}
                        />
                      </Field>
                      <Field label={t('dialogues.designDetails.date')}>
                        <Input
                          type="text"
                          value={this.state.date}
                          onChange={(e, data) => this.handleChange(data.value, 'date')}
                        />
                      </Field>
                      <Field label={t('dialogues.designDetails.documentTitle')}>
                        <Input
                          type="text"
                          value={this.state.title}
                          onChange={(e, data) => this.handleChange(data.value, 'title')}
                        />
                      </Field>
                      <Field label={t('dialogues.designDetails.sheets')}>
                        <Input
                          type="text"
                          value={this.state.sheets}
                          onChange={(e, data) => this.handleChange(data.value, 'sheets')}
                        />
                      </Field>
                      <Checkbox
                        label={t('dialogues.designDetails.showDesignDetails')}
                        checked={this.state.show_details}
                        onChange={(e, data) =>
                          this.handleCheckboxChange(data.checked as boolean, 'show_details')
                        }
                      />
                    </>
                  ) : null}
                  {this.state.selectedTab === 'guides' ? (
                    <>
                      <Checkbox
                        label={t('dialogues.designDetails.showDesignGuides')}
                        checked={this.state.show_guides}
                        onChange={(e, data) =>
                          this.handleCheckboxChange(data.checked as boolean, 'show_guides')
                        }
                      />
                      <Field label={t('dialogues.designDetails.segmentsX')}>
                        <Input
                          type="number"
                          min={1}
                          value={this.state.horiz_guide.toString()}
                          onChange={(e, data) => this.handleChange(data.value, 'horiz_guide')}
                        />
                      </Field>
                      <Field label={t('dialogues.designDetails.segmentsY')}>
                        <Input
                          type="number"
                          min={1}
                          value={this.state.vert_guide.toString()}
                          onChange={(e, data) => this.handleChange(data.value, 'vert_guide')}
                        />
                      </Field>
                    </>
                  ) : null}
                </div>
                <Checkbox
                  label={t('dialogues.designDetails.applyAllSheets')}
                  checked={this.state.applyToAllSheets}
                  onChange={(e, data) =>
                    this.handleCheckboxChange(data.checked as boolean, 'applyToAllSheets')
                  }
                />
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

export default connect()(withTranslation()(DesignDetailsDialog));
