import React, { useId, useMemo, useState } from 'react';
import {
  Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
  makeStyles, tokens,
} from '@fluentui/react-components';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { DocItemTypes, dsnSymbol } from '../../model/dsnItem';
import { PropertyFontEdit, SymbolActionTypes } from '../../state/actions/symbolActions';
import { actionCancelDialog } from '../../state/dispatcher/AppDispatcher';
import type { docDrawing } from '../../state/undo/undo';
import { SymbolPropertyFontTable } from '../panel/SymbolPropertyFontTable';

const useStyles = makeStyles({
  surface: {
    maxWidth: 'min(520px, 100vw)',
    padding: tokens.spacingHorizontalL,
  },
  description: {
    marginTop: 0,
    marginBottom: tokens.spacingVerticalS,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
});

export function SymbolPropertyFontDefaultsDialog() {
  const { t } = useTranslation();
  const styles = useStyles();
  const descriptionId = useId();
  const dispatch = useDispatch();
  const drawing = useSelector((state: docDrawing) => state.docStore.present.drawing);
  const [documentId] = useState(drawing.documentId);
  const [drafts, setDrafts] = useState(() => new Map<string, PropertyFontEdit['font']>());
  const symbols = useMemo(() => drawing.sheets.flatMap((sheet) => sheet.items.filter(
    (item): item is dsnSymbol => item.NodeName === DocItemTypes.Symbol,
  )), [drawing.sheets]);
  const defaults = useMemo(() => new Map(drawing.settings.symbolPropertyFonts?.map(
    ({ description, ...font }) => [description, font],
  )), [drawing.settings.symbolPropertyFonts]);

  const close = () => dispatch(actionCancelDialog());
  const save = () => {
    if (drafts.size && drawing.documentId === documentId) {
      const edits = Array.from(drafts, ([description, font]) => ({ description, font }));
      dispatch({ type: SymbolActionTypes.SetPropertyFonts, target: null, edits });
    }
    close();
  };

  return (
    <Dialog open onOpenChange={(_, data) => { if (!data.open) close(); }}>
      <DialogSurface className={styles.surface} aria-describedby={descriptionId}>
        <DialogBody>
          <DialogTitle>{t('panel.symbol.fontDefaults')}</DialogTitle>
          <DialogContent>
            <p id={descriptionId} className={styles.description}>
              {t('panel.symbol.fontDefaultsDescription')}
            </p>
            <SymbolPropertyFontTable
              symbols={symbols}
              savedDefaults={defaults}
              drafts={drafts}
              onEdit={({ description, font }) => setDrafts((previous) =>
                new Map(previous).set(description, { ...previous.get(description), ...font }),
              )}
            />
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={save}>{t('common.ok')}</Button>
            <Button onClick={close}>{t('common.cancel')}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
