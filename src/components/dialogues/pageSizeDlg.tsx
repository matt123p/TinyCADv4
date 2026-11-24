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

type PageDimension = 'width' | 'height';
type PageUnits = 'mm' | 'in';

const drawingUnitsPerUnit = { mm: 5, in: 127 };

interface PageSizeDialogState {
  width: number;
  height: number;
  port: boolean;
  page_size: string;
  units: PageUnits;
  dimensionInputs: Partial<Record<PageDimension, string>>;
}

const page_sizes = [
  { name: 'A1', width: 594, height: 841 },
  { name: 'A2', width: 420, height: 594 },
  { name: 'A3', width: 297, height: 420 },
  { name: 'A4', width: 210, height: 297 },
  { name: 'Custom', width: 0, height: 0 },
].map(({ name, width, height }) => ({
  name,
  width: width * drawingUnitsPerUnit.mm,
  height: height * drawingUnitsPerUnit.mm,
}));

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

    const [width, height] = props.page_size;
    const port = width < height;
    const preset = page_sizes.find((size) =>
      size.width === (port ? width : height) &&
      size.height === (port ? height : width),
    );

    this.state = {
      width: width,
      height: height,
      port: port,
      page_size: preset?.name ?? 'Custom',
      units: 'mm',
      dimensionInputs: {},
    };
  }

  handleClickOk() {
    if (!this.hasValidDimensions()) return;

    this.props.dispatch(
      actionUpdatePageSize([this.state.width, this.state.height]),
    );
  }

  handleClickCancel() {
    this.props.dispatch(actionCancelDialog());
  }

  hasValidDimensions() {
    return [this.state.width, this.state.height].every(
      (dimension) => dimension > 0 && Number.isFinite(dimension),
    );
  }

  dimensionValue(name: PageDimension) {
    const { dimensionInputs, units } = this.state;
    const dimension = this.state[name];
    if (dimensionInputs[name] !== undefined) return dimensionInputs[name];
    if (!Number.isFinite(dimension)) return '';

    const value = dimension / drawingUnitsPerUnit[units];
    return units === 'mm' ? String(value) : String(Number(value.toPrecision(10)));
  }

  handleChange(value: string, name: PageDimension) {
    this.setState((state) => ({
      ...state,
      [name]: value === '' ? NaN : Number(value) * drawingUnitsPerUnit[state.units],
      dimensionInputs: { ...state.dimensionInputs, [name]: value },
    }));
  }

  handlePageSizeChange(value: string) {
    // Custom
    if (value === 'Custom') {
      this.setState({
        page_size: value,
      });
      return;
    }

    const preset = page_sizes.find((size) => size.name === value);
    if (!preset) return;

    this.setState((state) => ({
      width: state.port ? preset.width : preset.height,
      height: state.port ? preset.height : preset.width,
      page_size: value,
      dimensionInputs: {},
    }));
  }

  handlePortLandscapeChange(port: boolean) {
    if (port !== this.state.port) {
      this.setState((s) => {
        return {
          width: s.height,
          height: s.width,
          port: port,
          dimensionInputs: {
            width: s.dimensionInputs.height,
            height: s.dimensionInputs.width,
          },
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
                <Field label={t('dialogues.settings.units')}>
                  <RadioGroup
                    layout="horizontal"
                    value={this.state.units}
                    onChange={(_, data) =>
                      this.setState({ units: data.value as PageUnits, dimensionInputs: {} })
                    }
                  >
                    <Radio value="mm" label="mm" />
                    <Radio value="in" label="in" />
                  </RadioGroup>
                </Field>
                <Field label={t('dialogues.pageSize.width')}>
                  <Input
                    type="number"
                    step="any"
                    value={this.dimensionValue('width')}
                    onChange={(e, data) => this.handleChange(data.value, 'width')}
                    disabled={'Custom' !== this.state.page_size}
                  />
                </Field>
                <Field label={t('dialogues.pageSize.height')}>
                  <Input
                    type="number"
                    step="any"
                    value={this.dimensionValue('height')}
                    onChange={(e, data) => this.handleChange(data.value, 'height')}
                    disabled={'Custom' !== this.state.page_size}
                  />
                </Field>
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={this.handleClickOk} disabled={!this.hasValidDimensions()}>
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
