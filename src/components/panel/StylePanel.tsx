import React, { Dispatch } from 'react';
import { useTranslation } from 'react-i18next';
import PanelCheckbox, { PanelCheckboxTarget } from './panelCheckbox';
import ColourPicker, { ColorPickerTarget } from './colourPicker';
import {
  Dropdown,
  Option,
  SpinButton,
  Checkbox,
  Button,
  makeStyles,
} from '@fluentui/react-components';
import { MergedStyle } from '../../manipulators/updateInterfaces';
import { actionStyle } from '../../state/dispatcher/AppDispatcher';
import { StylePanelLayout, StylePanelSection } from './StylePanelLayout';
import { FONT_OPTIONS } from './styleFontOptions';

const useStyles = makeStyles({
  row: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8px',
  },
  label: {
    fontSize: '12px',
    color: '#424242',
    whiteSpace: 'nowrap',
  },
});

interface StylePanelProps {
  selectedStyle: MergedStyle;
  dispatch: Dispatch<any>;
}

export const StylePanel: React.FC<StylePanelProps> = (props) => {
  const styles = useStyles();
  const { t } = useTranslation();
  const { selectedStyle, dispatch } = props;

  const getClampedSpinButtonValue = (
    value: number | null | undefined,
    displayValue: string | undefined,
    min: number,
    max: number,
  ) => {
    if (typeof value === 'number' && !Number.isNaN(value)) {
      return Math.min(max, Math.max(min, value));
    }

    const parsedValue = Number(displayValue?.trim());
    if (Number.isFinite(parsedValue)) {
      return Math.min(max, Math.max(min, parsedValue));
    }

    return null;
  };

  const lineWidthChange = (value: number) => {
    let style: MergedStyle = {
      fill: false,
      line: true,
      text: false,
      text_colour: false,
      border_style: false,
      line_width: value,
    };
    dispatch(actionStyle(style));
  };

  const fontSizeChange = (value: number) => {
    let style: MergedStyle = {
      fill: false,
      line: false,
      text: true,
      text_colour: false,
      border_style: false,
      font_size: value,
    };
    dispatch(actionStyle(style));
  };

  const linePatternChange = (i: number) => {
    let style: MergedStyle = {
      fill: false,
      line: true,
      text: false,
      text_colour: false,
      border_style: false,
      line_pattern: i,
    };
    dispatch(actionStyle(style));
  };

  const fontChange = (font: string) => {
    let style: MergedStyle = {
      fill: false,
      line: false,
      text: true,
      text_colour: false,
      border_style: false,
      font_name: font,
    };
    dispatch(actionStyle(style));
  };

  const hatchChange = (hatch: number) => {
    let style: MergedStyle = {
      fill: true,
      line: false,
      text: false,
      text_colour: false,
      border_style: false,
      hatch: hatch,
    };
    dispatch(actionStyle(style));
  };

  const renderLinePattern = (dashArray: string) => (
    <svg width="100" height="10" style={{ verticalAlign: 'middle' }}>
      <line
        x1="5"
        y1="5"
        x2="95"
        y2="5"
        style={{
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeDasharray: dashArray === '0' ? 'none' : dashArray,
        }}
      />
    </svg>
  );

  const linePatternOptions = [
    { text: '0', key: 0 },
    { text: '4', key: 1 },
    { text: '2', key: 2 },
    { text: '4 2', key: 3 },
    { text: '4 2 2 2', key: 4 },
    { text: '4 2 2 2 2 2', key: 5 },
  ];

  const hatchOptions = [
    { text: t('panel.style.solid'), key: 0 },
    { text: t('panel.style.horizontal'), key: 1 },
    { text: t('panel.style.vertical'), key: 2 },
    { text: t('panel.style.downwards'), key: 3 },
    { text: t('panel.style.upwards'), key: 4 },
    { text: t('panel.style.crosshatch'), key: 5 },
    { text: t('panel.style.diagonalCrosshatch'), key: 6 },
  ];

  return (
    <StylePanelLayout>
      {selectedStyle.image && (
        <StylePanelSection title="Image">
            <div className={styles.row}>
              <Checkbox label="Fixed aspect ratio" checked={selectedStyle.fixed_aspect ?? 'mixed'}
              onChange={(_, data) => dispatch(actionStyle({ line: false, fill: false, text: false, text_colour: false, border_style: false, image: true, fixed_aspect: data.checked === true }))} />
              <Button size="small" title="Restore the image's original proportions, accounting for clipping. Keeps its width and top-left position."
                onClick={() => dispatch(actionStyle({ line: false, fill: false, text: false, text_colour: false, border_style: false, image: true, reset_aspect: true }))}>
                Reset aspect ratio
              </Button>
            </div>
            <div className={styles.row}>
              {(['left', 'right', 'top', 'bottom'] as const).map(side => {
                const key = `clip_${side}` as const;
                const opposite = side === 'left' ? 'right' : side === 'right' ? 'left' : side === 'top' ? 'bottom' : 'top';
                const max = Math.max(0, (side === 'left' || side === 'right' ? selectedStyle.image_width : selectedStyle.image_height) - (selectedStyle[`clip_${opposite}`] ?? 0) - 1);
                const label = `${side.charAt(0).toUpperCase() + side.slice(1)} clipping (px)`;
                return <label key={side} className={styles.label}>
                  {label}
                  <SpinButton aria-label={label} style={{ width: '90px' }} value={selectedStyle[key]} min={0} max={max} step={1}
                    onChange={(_, data) => {
                      const value = getClampedSpinButtonValue(data.value, data.displayValue, 0, max);
                      if (value !== null) dispatch(actionStyle({ line: false, fill: false, text: false, text_colour: false, border_style: false, image: true, [key]: Math.floor(value) }));
                    }} />
                </label>;
              })}
            </div>
        </StylePanelSection>
      )}
      {selectedStyle.line && (
        <StylePanelSection title={t('panel.style.line')}>
            <div className={styles.row}>
              <PanelCheckbox
                checked={selectedStyle.stroked}
                enable={'stroked' in selectedStyle}
                target={PanelCheckboxTarget.Stroked}
                caption={t('panel.common.show')}
              />
              <ColourPicker
                iconName="FontColorSwatch"
                button-text={t('panel.common.colour')}
                settings={selectedStyle.line_colour}
                enable={
                  'line_colour' in selectedStyle && selectedStyle.stroked
                }
                target={ColorPickerTarget.Line}
              />
            </div>
            <div className={styles.row}>
              <span className={styles.label}>{t('panel.style.width')}</span>
              <SpinButton
                style={{ width: '70px' }}
                value={selectedStyle.line_width}
                min={1}
                max={64}
                step={1}
                onChange={(e, data) => {
                  const nextValue = getClampedSpinButtonValue(
                    data.value,
                    data.displayValue,
                    1,
                    64,
                  );

                  if (nextValue !== null) {
                    lineWidthChange(nextValue);
                  }
                }}
                disabled={
                  !('line_width' in selectedStyle && selectedStyle.stroked)
                }
              />
            </div>
            <div className={styles.row}>
              <span className={styles.label}>{t('panel.style.pattern')}</span>
              <Dropdown
                style={{ minWidth: '80px' }}
                placeholder=""
                value={
                  linePatternOptions.find(
                    (o) => o.key === selectedStyle.line_pattern
                  )?.text || ''
                }
                button={{
                  children: (
                    <span
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      {renderLinePattern(
                        linePatternOptions.find(
                          (o) => o.key === selectedStyle.line_pattern,
                        )?.text || '0',
                      )}
                    </span>
                  ),
                }}
                onOptionSelect={(e, data) =>
                  linePatternChange(Number(data.optionValue))
                }
                disabled={
                  !('line_pattern' in selectedStyle && selectedStyle.stroked)
                }
              >
                {linePatternOptions.map((o) => (
                  <Option key={o.key} value={o.key.toString()} text={o.text}>
                    <div style={{ width: '100%' }}>
                      {renderLinePattern(o.text)}
                    </div>
                  </Option>
                ))}
              </Dropdown>
            </div>
        </StylePanelSection>
      )}

      {selectedStyle.fill && (
        <StylePanelSection title={t('panel.style.fill')}>
            <div className={styles.row}>
              <PanelCheckbox
                checked={selectedStyle.filled}
                enable={'filled' in selectedStyle}
                target={PanelCheckboxTarget.Filled}
                caption={t('panel.style.fill')}
              />
              <PanelCheckbox
                checked={selectedStyle.rounded_rect}
                enable={'rounded_rect' in selectedStyle}
                target={PanelCheckboxTarget.RoundedRect}
                caption={t('panel.style.rounded')}
              />
            </div>
            <div className={styles.row}>
              <ColourPicker
                iconName="BucketColor"
                button-text={t('panel.common.colour')}
                settings={selectedStyle.fill_colour}
                enable={
                  'fill_colour' in selectedStyle && selectedStyle.filled
                }
                target={ColorPickerTarget.Fill}
              />
            </div>
            <div className={styles.row}>
              <span className={styles.label}>{t('panel.style.hatch')}</span>
              <Dropdown
                style={{ minWidth: '100px' }}
                placeholder=""
                value={
                  hatchOptions.find((o) => o.key === selectedStyle.hatch)?.text ||
                  ''
                }
                onOptionSelect={(e, data) => hatchChange(Number(data.optionValue))}
                disabled={
                  !('hatch' in selectedStyle && selectedStyle.filled)
                }
              >
                {hatchOptions.map((o) => (
                  <Option key={o.key} value={o.key.toString()}>
                    {o.text}
                  </Option>
                ))}
              </Dropdown>
            </div>
        </StylePanelSection>
      )}

      {selectedStyle.text && (
        <StylePanelSection title={t('panel.style.font')}>
            <div className={styles.row}>
              <ColourPicker
                iconName="FontColorSwatch"
                button-text={t('panel.common.colour')}
                settings={selectedStyle.font_colour}
                enable={'font_colour' in selectedStyle}
                target={ColorPickerTarget.Font}
              />
            </div>
            <div className={styles.row}>
              <span className={styles.label}>{t('panel.style.font')}</span>
              <Dropdown
                style={{ minWidth: '100px' }}
                placeholder=""
                value={selectedStyle.font_name || ''}
                onOptionSelect={(e, data) =>
                  fontChange(data.optionValue as string)
                }
                disabled={!('font_name' in selectedStyle)}
              >
                {FONT_OPTIONS.map((o) => (
                  <Option key={o.key} value={o.key}>
                    {o.text}
                  </Option>
                ))}
              </Dropdown>
            </div>
            <div className={styles.row}>
              <span className={styles.label}>{t('panel.style.size')}</span>
              <SpinButton
                style={{ width: '70px' }}
                value={selectedStyle.font_size}
                min={4}
                max={200}
                step={1}
                onChange={(e, data) => {
                  const nextValue = getClampedSpinButtonValue(
                    data.value,
                    data.displayValue,
                    4,
                    200,
                  );

                  if (nextValue !== null) {
                    fontSizeChange(nextValue);
                  }
                }}
                disabled={!('font_size' in selectedStyle)}
              />
              <PanelCheckbox
                checked={selectedStyle.font_bold}
                enable={'font_bold' in selectedStyle}
                target={PanelCheckboxTarget.FontBold}
                caption={t('panel.style.bold')}
              />
              <PanelCheckbox
                checked={selectedStyle.font_italic}
                enable={'font_italic' in selectedStyle}
                target={PanelCheckboxTarget.FontItalic}
                caption={t('panel.style.italic')}
              />
            </div>
        </StylePanelSection>
      )}
    </StylePanelLayout>
  );
};
