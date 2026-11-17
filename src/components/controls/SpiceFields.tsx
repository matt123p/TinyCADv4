import React, { useState } from 'react';
import {
  Checkbox,
  Field,
  Input,
  Textarea,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';

const useStyles = makeStyles({
  root: {
    display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0,
  },
  wide: {
    display: 'flex', flexWrap: 'wrap', gap: '16px', maxWidth: '1100px',
  },
  model: { flex: '1.4 1 300px', minWidth: 0 },
  sections: { display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 },
  wideSections: { flex: '1 1 300px' },
  section: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 },
  row: { display: 'flex', alignItems: 'flex-start', gap: '8px' },
  text: { flexGrow: 1, minWidth: 0 },
  priority: { width: '68px', flexShrink: 0 },
  code: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
});

interface SpiceFieldsProps {
  value: (name: string) => string;
  onChange: (name: string, value: string) => void;
  wide?: boolean;
}

function OptionalSpiceSection({
  name,
  label,
  value,
  onChange,
}: SpiceFieldsProps & { name: string; label: string }) {
  const styles = useStyles();
  const { t } = useTranslation();
  // An empty section can be opened for editing without writing a definition flag.
  const [enabledEmpty, setEnabledEmpty] = useState(false);
  const text = value(name) ?? '';
  const enabled = text.length > 0 || enabledEmpty;
  return (
    <div className={styles.section}>
      <Checkbox
        label={label}
        checked={enabled}
        onChange={(_, data) => {
          setEnabledEmpty(!!data.checked);
          if (!data.checked) onChange(name, '');
        }}
      />
      {enabled && (
        <div className={styles.row}>
          <Textarea
            className={styles.text}
            size="small"
            resize="vertical"
            rows={3}
            aria-label={label}
            textarea={{ className: styles.code }}
            value={text}
            onChange={(_, data) => {
              setEnabledEmpty(true);
              onChange(name, data.value);
            }}
          />
          <Field
            className={styles.priority}
            label={t('panel.editSpice.priority')}
            size="small"
          >
            <Input
              size="small"
              type="number"
              min={0}
              max={9}
              style={{ width: '100%', minWidth: 0 }}
              aria-label={`${label} / ${t('panel.editSpice.priority')}`}
              value={value(`${name}_PRIORITY`) ?? '5'}
              onChange={(_, data) => onChange(`${name}_PRIORITY`, data.value)}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

/** Shared by placed-symbol overrides and the library symbol editor. */
export function SpiceFields({ value, onChange, wide }: SpiceFieldsProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <div className={wide ? styles.wide : styles.root}>
      <Field
        className={wide ? styles.model : undefined}
        label={t('panel.editSpice.model')}
        size="small"
      >
        <Textarea
          size="small"
          resize="vertical"
          rows={5}
          textarea={{ className: styles.code }}
          value={value('$$SPICE') ?? ''}
          onChange={(_, data) => onChange('$$SPICE', data.value)}
        />
      </Field>
      <div className={`${styles.sections} ${wide ? styles.wideSections : ''}`}>
        <OptionalSpiceSection
          name="$$SPICE_PROLOG"
          label={t('panel.editSpice.prologue')}
          value={value}
          onChange={onChange}
        />
        <OptionalSpiceSection
          name="$$SPICE_EPILOG"
          label={t('panel.editSpice.epilogue')}
          value={value}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
