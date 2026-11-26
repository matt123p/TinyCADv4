import React, { useId, useState } from 'react';
import {
  Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface,
  DialogTitle, Input, makeStyles,
} from '@fluentui/react-components';
import { useDispatch, useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  DocItemTypes, dsnSymbol, SymbolPropertyFont,
} from '../../model/dsnItem';
import { updateSymbol } from '../../manipulators/updateSymbol';
import { PropertyFontEdit, SymbolActionTypes } from '../../state/actions/symbolActions';
import { actionCancelDialog } from '../../state/dispatcher/AppDispatcher';
import { activeSelectedSheet } from '../../state/stores/docStoreReducer';
import type { docDrawing } from '../../state/undo/undo';
import { FONT_OPTIONS } from '../panel/styleFontOptions';

const useStyles = makeStyles({
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    '& th, & td': { padding: '4px', textAlign: 'left' },
    '& th[scope=row]': { overflowWrap: 'anywhere' },
  },
  input: { width: '100%' },
  size: { width: '90px' },
});

interface FontRow {
  description: string;
  index?: number;
  value?: string;
  fonts: Array<{ override?: SymbolPropertyFont; inherited: SymbolPropertyFont }>;
}

function propertyRows(symbols: dsnSymbol[], defaults: boolean, saved: Map<string, SymbolPropertyFont>) {
  const rows = new Map<string | number, FontRow>();
  const single = !defaults && symbols.length === 1;
  const add = (description: string, index?: number, value?: string) => {
    const key = single ? index : description;
    let row = rows.get(key);
    if (!row) {
      row = { description, index: single ? index : undefined, value, fonts: [] };
      rows.set(key, row);
    }
    return row;
  };
  if (defaults) {
    for (const description of ['Ref', 'Name', ...saved.keys()]) add(description);
  }
  for (const symbol of symbols) {
    const updater = new updateSymbol(symbol);
    symbol.text.forEach((field, index) => {
      if (field.description.startsWith('$$')) return;
      const row = add(field.description, index, single ? field.value : undefined);
      if (!defaults) {
        row.fonts.push({ override: field.font, inherited: updater.propertyFont({ ...field, font: undefined }) });
      }
    });
  }
  if (defaults) {
    for (const row of rows.values()) {
      row.fonts.push({ override: saved.get(row.description), inherited: { font_name: 'Arial', font_size: 10 } });
    }
  }
  const priority = (description: string) => description === 'Ref' ? 0 : description === 'Name' ? 1 : 2;
  return Array.from(rows.values()).sort((a, b) =>
    priority(a.description) - priority(b.description) || a.description.localeCompare(b.description),
  );
}

function inputText(
  row: FontRow, key: keyof SymbolPropertyFont, draft: string | undefined,
  mixed: string, defaultText: (value: string) => string,
) {
  const first = row.fonts[0];
  const value = first.override?.[key];
  const sameOverride = row.fonts.every(({ override }) => override?.[key] === value);
  const inherited = first.inherited[key];
  const sameDefault = row.fonts.every((style) => style.inherited[key] === inherited);
  return {
    value: draft ?? (sameOverride && value !== undefined ? String(value) : ''),
    placeholder: sameDefault && (sameOverride || draft !== undefined)
      ? defaultText(String(inherited))
      : mixed,
  };
}

export function SymbolPropertyFontsDialog({ defaults }: { defaults: boolean }) {
  const { t } = useTranslation();
  const styles = useStyles();
  const dispatch = useDispatch();
  const fontListId = useId();
  const store = useStore<docDrawing>();
  const [{ rows, target, documentId }] = useState(() => {
    const present = store.getState().docStore.present;
    const { drawing, view } = present;
    const sheetIndex = activeSelectedSheet(present);
    const ids = new Set(view._selected_array);
    const items = defaults
      ? drawing.sheets.flatMap((sheet) => sheet.items)
      : drawing.sheets[sheetIndex]?.items ?? [];
    const symbols = items.filter((item): item is dsnSymbol =>
      item.NodeName === DocItemTypes.Symbol && (defaults || ids.has(item._id)),
    );
    const saved = new Map(drawing.settings.symbolPropertyFonts?.map(
      ({ description, ...font }) => [description, font],
    ));
    return {
      rows: propertyRows(symbols, defaults, saved),
      target: defaults ? null : { sheetIndex, symbolIds: symbols.map((symbol) => symbol._id) },
      documentId: drawing.documentId,
    };
  });

  const [drafts, setDrafts] = useState<Record<number, Partial<Record<keyof SymbolPropertyFont, string>>>>({});
  const setDraft = (index: number, value: typeof drafts[number]) =>
    setDrafts((previous) => ({ ...previous, [index]: { ...previous[index], ...value } }));
  const invalidSize = (value?: string) => Boolean(value?.trim()) &&
    (!Number.isFinite(Number(value)) || Number(value) <= 0);
  const valid = Object.values(drafts).every(({ font_size }) => !invalidSize(font_size));

  const close = () => dispatch(actionCancelDialog());
  const save = () => {
    const edits: PropertyFontEdit[] = Object.entries(drafts).map(([key, draft]) => {
      const { description, index } = rows[Number(key)];
      const font: PropertyFontEdit['font'] = {};
      if (draft.font_name !== undefined) font.font_name = draft.font_name.trim() || null;
      if (draft.font_size !== undefined) font.font_size = draft.font_size.trim() ? Number(draft.font_size) : null;
      return { description, index, font };
    });
    if (edits.length && store.getState().docStore.present.drawing.documentId === documentId) {
      dispatch({ type: SymbolActionTypes.SetPropertyFonts, target, edits });
    }
    close();
  };

  const title = defaults ? t('panel.symbol.fontDefaults') : t('panel.symbol.propertyFonts');
  const mixed = t('panel.symbol.mixedFonts');
  return (
    <Dialog open onOpenChange={close}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>
            <datalist id={fontListId}>
              {FONT_OPTIONS.map((font) => <option key={font.key} value={font.key} />)}
            </datalist>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('panel.symbol.property')}</th>
                  <th scope="col">{t('panel.style.font')}</th>
                  <th scope="col">{t('panel.style.size')}</th>
                  <td />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const name = row.value ? `${row.description} (${row.value})` : row.description;
                  const draft = drafts[index];
                  const defaultText = (value: string) => t('panel.symbol.inheritedFont', { value });
                  const font = inputText(row, 'font_name', draft?.font_name, mixed, defaultText);
                  const size = inputText(row, 'font_size', draft?.font_size, mixed, defaultText);
                  return (
                    <tr key={row.index ?? row.description}>
                      <th scope="row">{name}</th>
                      <td>
                        <Input className={styles.input} size="small" list={fontListId}
                          aria-label={`${name} — ${t('panel.style.font')}`}
                          value={font.value}
                          placeholder={font.placeholder}
                          onChange={(_, data) => setDraft(index, { font_name: data.value })}
                        />
                      </td>
                      <td>
                        <Input className={styles.size} size="small" inputMode="decimal"
                          aria-label={`${name} — ${t('panel.style.size')}`}
                          aria-invalid={invalidSize(draft?.font_size)}
                          value={size.value}
                          placeholder={size.placeholder}
                          onChange={(_, data) => setDraft(index, { font_size: data.value })}
                        />
                      </td>
                      <td>
                        <Button size="small" appearance="subtle"
                          aria-label={`${t('panel.symbol.resetFont')} — ${name}`}
                          onClick={() => setDraft(index, { font_name: '', font_size: '' })}
                        >
                          {t('panel.symbol.resetFont')}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!valid && <p role="alert">{t('panel.symbol.invalidFontSize')}</p>}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={save} disabled={!valid}>{t('common.ok')}</Button>
            <Button onClick={close}>{t('common.cancel')}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
