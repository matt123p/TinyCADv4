import React, { useMemo } from 'react';
import {
  Button, makeStyles, Table, TableBody, TableCell, TableHeader, TableHeaderCell,
  TableRow, tokens,
} from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { dsnSymbol, SymbolPropertyFont } from '../../model/dsnItem';
import { updateSymbol } from '../../manipulators/updateSymbol';
import type { PropertyFontEdit } from '../../state/actions/symbolActions';
import { FontDropdown, FontSizeSpinButton } from './FontControls';

const useStyles = makeStyles({
  table: { minWidth: '420px' },
  attribute: { overflowWrap: 'anywhere', fontWeight: tokens.fontWeightSemibold },
  fontColumn: { width: '148px' },
  sizeColumn: { width: '98px' },
  resetColumn: { width: '68px' },
  font: { minWidth: 0, width: '100%' },
  size: { width: '100%' },
});

interface FontRow {
  description: string;
  index?: number;
  fonts: Array<{ override?: SymbolPropertyFont; inherited: SymbolPropertyFont }>;
}

function propertyRows(symbols: dsnSymbol[], saved?: ReadonlyMap<string, SymbolPropertyFont>) {
  const rows = new Map<string | number, FontRow>();
  const single = !saved && symbols.length === 1;
  const add = (description: string, index: number) => {
    const key = single ? index : description;
    let row = rows.get(key);
    if (!row) {
      row = { description, index: single ? index : undefined, fonts: [] };
      rows.set(key, row);
    }
    return row;
  };
  for (const symbol of symbols) {
    const updater = new updateSymbol(symbol);
    symbol.text.forEach((field, index) => {
      if (!symbol.textData?.[index] || field.description.startsWith('$$')) return;
      const row = add(field.description, index);
      if (!saved) {
        row.fonts.push({ override: field.font, inherited: updater.propertyFont({ ...field, font: undefined }) });
      }
    });
  }
  if (saved) {
    for (const row of rows.values()) {
      row.fonts.push({ override: saved.get(row.description), inherited: { font_name: 'Arial', font_size: 10 } });
    }
  }
  const priority = (description: string) => description === 'Ref' ? 0 : description === 'Name' ? 1 : 2;
  return Array.from(rows.values()).sort((a, b) =>
    priority(a.description) - priority(b.description) || a.description.localeCompare(b.description),
  );
}

function fontControlValue<K extends keyof SymbolPropertyFont>(
  row: FontRow, key: K, draft: SymbolPropertyFont[K] | null,
  mixed: string, defaultText: (value: string) => string,
) {
  const first = row.fonts[0];
  const value = first.override?.[key];
  const sameOverride = row.fonts.every(({ override }) => override?.[key] === value);
  const inherited = first.inherited[key];
  const sameDefault = row.fonts.every((style) => style.inherited[key] === inherited);
  return {
    value: draft !== undefined ? draft : sameOverride ? value : undefined,
    placeholder: sameDefault && (sameOverride || draft !== undefined)
      ? defaultText(String(inherited))
      : mixed,
  };
}

type FontDraft = PropertyFontEdit['font'];

const rowKey = (row: FontRow) => row.index ?? row.description;

interface SymbolPropertyFontTableProps {
  symbols: dsnSymbol[];
  savedDefaults?: ReadonlyMap<string, SymbolPropertyFont>;
  drafts?: ReadonlyMap<string, FontDraft>;
  onEdit: (edit: PropertyFontEdit) => void;
}

export function SymbolPropertyFontTable({ symbols, savedDefaults, drafts, onEdit }: SymbolPropertyFontTableProps) {
  const { t } = useTranslation();
  const styles = useStyles();
  const rows = useMemo(() => propertyRows(symbols, savedDefaults), [symbols, savedDefaults]);
  const mixed = t('panel.symbol.mixedFonts');
  const defaultText = (value: string) => t('panel.symbol.inheritedFont', { value });
  const edit = ({ description, index }: FontRow, font: FontDraft) => onEdit({ description, index, font });

  if (!rows.length) return <p>{t('panel.symbol.noShownAttributes')}</p>;

  return (
    <Table size="small" className={styles.table}>
      <TableHeader>
        <TableRow>
          <TableHeaderCell>{t('panel.symbol.attribute')}</TableHeaderCell>
          <TableHeaderCell className={styles.fontColumn}>{t('panel.style.font')}</TableHeaderCell>
          <TableHeaderCell className={styles.sizeColumn}>{t('panel.style.size')}</TableHeaderCell>
          <TableHeaderCell className={styles.resetColumn} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const key = rowKey(row);
          const name = row.description;
          const draft = drafts?.get(row.description);
          const font = fontControlValue(row, 'font_name', draft?.font_name, mixed, defaultText);
          const size = fontControlValue(row, 'font_size', draft?.font_size, mixed, defaultText);
          return (
            <TableRow key={key}>
              <TableCell role="rowheader" className={styles.attribute}>{name}</TableCell>
              <TableCell>
                <FontDropdown
                  className={styles.font}
                  size="small"
                  aria-label={`${name} — ${t('panel.style.font')}`}
                  value={font.value ?? ''}
                  placeholder={font.placeholder}
                  onFontChange={(value) => edit(row, { font_name: value })}
                />
              </TableCell>
              <TableCell>
                <FontSizeSpinButton
                  className={styles.size}
                  size="small"
                  aria-label={`${name} — ${t('panel.style.size')}`}
                  value={size.value ?? null}
                  placeholder={size.placeholder}
                  onSizeChange={(value) => edit(row, { font_size: value })}
                  onClear={() => edit(row, { font_size: null })}
                />
              </TableCell>
              <TableCell>
                <Button size="small" appearance="subtle"
                  aria-label={`${t('panel.symbol.resetFont')} — ${name}`}
                  onClick={() => edit(row, { font_name: null, font_size: null })}
                >
                  {t('panel.symbol.resetFont')}
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
