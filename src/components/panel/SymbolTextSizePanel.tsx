import React, { useMemo } from 'react';
import { Button, makeStyles } from '@fluentui/react-components';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { DocItemTypes, dsnSymbol } from '../../model/dsnItem';
import { SymbolActionTypes } from '../../state/actions/symbolActions';
import { actionSelectDialog } from '../../state/dispatcher/AppDispatcher';
import { activeSelectedSheet, activeSheet } from '../../state/stores/docStoreReducer';
import type { docDrawing } from '../../state/undo/undo';
import { SymbolPropertyFontTable } from './SymbolPropertyFontTable';

const useStyles = makeStyles({
  table: {
    flex: '1 1 auto',
    minHeight: 0,
    minWidth: 0,
    overflow: 'auto',
  },
});

export function SymbolFontDefaultsButton() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  return (
    <Button
      size="small"
      title={t('panel.symbol.fontDefaults')}
      onClick={() => dispatch(actionSelectDialog('symbol_property_font_defaults', null))}
    >
      {t('panel.symbol.defaults')}
    </Button>
  );
}

export function SymbolTextSizePanel() {
  const styles = useStyles();
  const dispatch = useDispatch();
  const sheetIndex = useSelector((state: docDrawing) => activeSelectedSheet(state.docStore.present));
  const items = useSelector((state: docDrawing) => activeSheet(state.docStore.present)?.items);
  const selection = useSelector((state: docDrawing) => state.docStore.present.view._selected_array);
  const symbols = useMemo(() => {
    const ids = new Set(selection);
    return (items ?? []).filter(
      (item): item is dsnSymbol => item.NodeName === DocItemTypes.Symbol && ids.has(item._id),
    );
  }, [items, selection]);

  return (
    <div className={styles.table}>
      <SymbolPropertyFontTable
        symbols={symbols}
        onEdit={(edit) => dispatch({
          type: SymbolActionTypes.SetPropertyFonts,
          target: { sheetIndex, symbolIds: symbols.map((symbol) => symbol._id) },
          edits: [edit],
        })}
      />
    </div>
  );
}
