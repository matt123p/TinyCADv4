import React from 'react';
import {
  Dropdown, DropdownProps, Option, SpinButton, SpinButtonProps,
} from '@fluentui/react-components';
import { FONT_OPTIONS } from './styleFontOptions';

type FontDropdownProps = Pick<
  DropdownProps, 'aria-label' | 'className' | 'disabled' | 'placeholder' | 'size' | 'style' | 'value'
> & {
  onFontChange: (font: string) => void;
};

export function FontDropdown({ onFontChange, value, ...props }: FontDropdownProps) {
  return (
    <Dropdown
      {...props}
      value={value}
      selectedOptions={value ? [value] : []}
      onOptionSelect={(_, data) => {
        if (data.optionValue !== undefined) onFontChange(data.optionValue);
      }}
    >
      {FONT_OPTIONS.map(({ key, text }) => <Option key={key} value={key}>{text}</Option>)}
    </Dropdown>
  );
}

type FontSizeSpinButtonProps = Pick<
  SpinButtonProps, 'aria-label' | 'className' | 'disabled' | 'placeholder' | 'size' | 'style' | 'value'
> & {
  onSizeChange: (size: number) => void;
  onClear?: () => void;
};

const minFontSize = 4;
const maxFontSize = 200;

export function FontSizeSpinButton({ onSizeChange, onClear, ...props }: FontSizeSpinButtonProps) {
  return (
    <SpinButton
      {...props}
      min={minFontSize}
      max={maxFontSize}
      step={1}
      onChange={(_, { value, displayValue }) => {
        const text = displayValue?.trim();
        if (value == null && text === '' && onClear) {
          onClear();
          return;
        }
        const size = typeof value === 'number' && !Number.isNaN(value) ? value : Number(text);
        if (Number.isFinite(size)) onSizeChange(Math.min(maxFontSize, Math.max(minFontSize, size)));
      }}
    />
  );
}
