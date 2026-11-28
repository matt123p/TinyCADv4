import React, { useState } from 'react';
import {
  ColorArea,
  ColorSlider,
  ColorSwatch,
  Field,
  Input,
  SwatchPicker,
  SwatchPickerRow,
  makeStyles,
} from '@fluentui/react-components';
import type { ColorAreaProps } from '@fluentui/react-components';
import { tinycolor } from '@ctrl/tinycolor';
import { useTranslation } from 'react-i18next';

const presets = [
  ['#d0021b', '#f5a623', '#f8e71c', '#8b572a', '#7ed321', '#417505', '#bd10e0', '#9013fe'],
  ['#4a90e2', '#50e3c2', '#b8e986', '#000000', '#4a4a4a', '#9b9b9b', '#ffffff'],
];

const useStyles = makeStyles({
  picker: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: '100%',
    boxSizing: 'border-box',
    // The 20px handles extend past the edge at minimum and maximum values.
    padding: '14px',
  },
  area: { minWidth: 0, minHeight: '150px' },
  slider: { minWidth: 0 },
  fields: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.65fr) repeat(3, minmax(0, 1fr))',
    gap: '4px',
  },
  input: { minWidth: 0 },
  swatchRow: { flexWrap: 'wrap', rowGap: '2px' },
});

type HSV = ColorAreaProps['color'];
type Channel = 'hex' | 'r' | 'g' | 'b';
const channels: Channel[] = ['hex', 'r', 'g', 'b'];

export function ColourPicker({
  colour,
  onChange,
}: {
  colour: string;
  onChange: (hex: string) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [lastSelection, setLastSelection] = useState<{ hex: string; hsv: HSV }>();
  const [draft, setDraft] = useState<{ channel: Channel; value: string }>();
  const parsed = tinycolor(colour);
  const hex = parsed.toHexString();
  const rgb = parsed.toRgb();
  const values = { hex, r: String(rgb.r), g: String(rgb.g), b: String(rgb.b) };
  // Keep the chosen hue even when a grayscale colour has no hue in RGB.
  const hsv = lastSelection?.hex === hex ? lastSelection.hsv : parsed.toHsv();

  const updateHSV = (next: HSV) => {
    const nextHex = tinycolor(next).toHexString();
    setLastSelection({ hex: nextHex, hsv: next });
    onChange(nextHex);
  };

  const updateInput = (channel: Channel, value: string, commit = false) => {
    if (channel === 'hex') {
      const digits = value.trim().replace(/^#/, '');
      if (/^[a-f0-9]{6}$/i.test(digits) || (commit && /^[a-f0-9]{3}$/i.test(digits))) {
        updateHSV(tinycolor(`#${digits}`).toHsv());
      }
      return;
    }
    if (/^\d{1,3}$/.test(value) && Number(value) <= 255) {
      updateHSV(tinycolor({ ...rgb, [channel]: Number(value) }).toHsv());
    }
  };

  return (
    <div className={styles.picker}>
      <ColorArea
        className={styles.area}
        color={hsv}
        inputX={{ 'aria-label': t('panel.colourPicker.saturation') }}
        inputY={{ 'aria-label': t('panel.colourPicker.brightness') }}
        onChange={(_, data) => updateHSV(data.color)}
      />
      <ColorSlider
        className={styles.slider}
        aria-label={t('panel.colourPicker.hue')}
        color={hsv}
        onChange={(_, data) => updateHSV(data.color)}
      />
      <div className={styles.fields}>
        {channels.map((channel) => (
          <Field key={channel} size="small" label={channel === 'hex' ? 'Hex' : channel.toUpperCase()}>
            <Input
              className={styles.input}
              value={draft?.channel === channel ? draft.value : values[channel]}
              inputMode={channel === 'hex' ? 'text' : 'numeric'}
              onChange={(_, data) => {
                setDraft({ channel, value: data.value });
                updateInput(channel, data.value);
              }}
              onBlur={() => {
                if (draft?.channel === channel && channel === 'hex' && /^#?[a-f0-9]{3}$/i.test(draft.value.trim())) {
                  updateInput(channel, draft.value, true);
                }
                setDraft(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }
              }}
            />
          </Field>
        ))}
      </div>
      <SwatchPicker
        aria-label={t('panel.colourPicker.presets')}
        layout="grid"
        size="extra-small"
        spacing="small"
        selectedValue={hex}
        onSelectionChange={(_, data) => updateHSV(tinycolor(data.selectedValue).toHsv())}
      >
        {presets.map((row) => (
          <SwatchPickerRow key={row[0]} className={styles.swatchRow}>
            {row.map((preset) => (
              <ColorSwatch key={preset} value={preset} color={preset} aria-label={preset} title={preset} />
            ))}
          </SwatchPickerRow>
        ))}
      </SwatchPicker>
    </div>
  );
}
