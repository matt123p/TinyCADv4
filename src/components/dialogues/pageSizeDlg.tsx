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
  Dropdown,
  Option,
} from '@fluentui/react-components';
import { Coordinate } from '../../model/dsnItem';
import {
  actionUpdatePageSize,
  actionCancelDialog,
} from '../../state/dispatcher/AppDispatcher';
import { connect } from 'react-redux';

interface PageSizeDialogProps extends WithTranslation {
  page_size: Coordinate;
  dispatch: Dispatch<any>;
}

interface PageSizeDialogState {
  width: number;
  height: number;
  port: boolean;
  page_size: string;
}

const page_sizes = [
  { name: 'A1', width: 594, height: 841 },
  { name: 'A2', width: 420, height: 594 },
  { name: 'A3', width: 297, height: 420 },
  { name: 'A4', width: 210, height: 297 },
  { name: 'Custom', width: 0, height: 0 },
];

//
// This class represents the page size dialogue
//
class PageSizeDialog extends React.PureComponent<
  PageSizeDialogProps,
  PageSizeDialogState
> {
  constructor(props: PageSizeDialogProps) {
    super(props);

    this.handleClickOk = this.handleClickOk.bind(this);
    this.handleClickCancel = this.handleClickCancel.bind(this);

    const port = this.props.page_size[0] < this.props.page_size[1];
    const width = this.props.page_size[0] / 5;
    const height = this.props.page_size[1] / 5;
    let page_size = 'Custom';
    for (let i = 0; i < page_sizes.length; ++i) {
      if (port) {
        if (page_sizes[i].width === width && page_sizes[i].height === height) {
          page_size = page_sizes[i].name;
        }
      } else {
        if (page_sizes[i].height === width && page_sizes[i].width === height) {
          page_size = page_sizes[i].name;
        }
      }
    }

    this.state = {
      width: width,
      height: height,
      port: port,
      page_size: page_size,
    };
  }

  handleClickOk() {
    this.props.dispatch(
      actionUpdatePageSize([this.state.width * 5, this.state.height * 5]),
    );
  }

  handleClickCancel() {
    this.props.dispatch(actionCancelDialog());
  }

  handleChange(svalue: string, name: string) {
    this.setState((s) => {
      switch (name) {
        case 'width':
          return { ...s, width: Number(svalue) };
        case 'height':
          return { ...s, height: Number(svalue) };
      }
      return s;
    });
  }

  handlePageSizeChange(value: string) {
    // Custom
    if (value === 'Custom') {
      this.setState({
        page_size: value,
      });
      return;
    }

    for (let i = 0; i < page_sizes.length; ++i) {
      if (page_sizes[i].name === value) {
        if (this.state.port) {
          this.setState({
            width: page_sizes[i].width,
            height: page_sizes[i].height,
            page_size: value,
          });
          return;
        } else {
          this.setState({
            width: page_sizes[i].height,
            height: page_sizes[i].width,
            page_size: value,
          });
          return;
        }
      }
    }
  }

  handlePortLandscapeChange(port: boolean) {
    if (port !== this.state.port) {
      this.setState((s) => {
        return {
          width: s.height,
          height: s.width,
          port: port,
        };
      });
    }
  }

  render() {
    const { t } = this.props;
    return (
      <Dialog open={true} onOpenChange={this.handleClickCancel}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t('dialogues.pageSize.title')}</DialogTitle>
            <DialogContent>
              <div style={{ display: 'flex', flexDirection: 'column', rowGap: '10px' }}>
                <Field label={t('dialogues.pageSize.paperSize')}>
                  <Dropdown
                    value={this.state.page_size}
                    onOptionSelect={(e, data) =>
                      this.handlePageSizeChange(data.optionValue as string)
                    }
                  >
                    {page_sizes.map((size) => (
                      <Option key={size.name} value={size.name}>
                        {size.name}
                      </Option>
                    ))}
                  </Dropdown>
                </Field>
                <Field label={t('dialogues.pageSize.orientation')}>
                  <RadioGroup
                    value={this.state.port ? 'portrait' : 'landscape'}
                    onChange={(e, data) =>
                      this.handlePortLandscapeChange(data.value === 'portrait')
                    }
                  >
                    <Radio value="portrait" label={t('dialogues.pageSize.portrait')} />
                    <Radio value="landscape" label={t('dialogues.pageSize.landscape')} />
                  </RadioGroup>
                </Field>
                <Field label={t('dialogues.pageSize.width')}>
                  <Input
                    type="number"
                    value={this.state.width.toString()}
                    onChange={(e, data) => this.handleChange(data.value, 'width')}
                    disabled={'Custom' !== this.state.page_size}
                  />
                </Field>
                <Field label={t('dialogues.pageSize.height')}>
                  <Input
                    type="number"
                    value={this.state.height.toString()}
                    onChange={(e, data) => this.handleChange(data.value, 'height')}
                    disabled={'Custom' !== this.state.page_size}
                  />
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

export default connect()(withTranslation()(PageSizeDialog));
