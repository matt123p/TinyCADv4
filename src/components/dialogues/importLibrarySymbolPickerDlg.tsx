import React, { FunctionComponent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useDispatch } from 'react-redux';
import { actionCancelDialog } from '../../state/dispatcher/AppDispatcher';
import { ImportedSymbol } from '../../io/kicad/importer';
import { importSelectedSymbolsToCurrentLibrary } from '../../io/files';

interface ImportLibrarySymbolPickerDialogProps {
  symbols: ImportedSymbol[];
}

const useStyles = makeStyles({
  list: {
    maxHeight: '360px',
    overflowY: 'auto',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: '6px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  row: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusSmall,
    padding: '8px 10px',
    backgroundColor: tokens.colorNeutralBackground1,
  },
  symbolMeta: {
    color: tokens.colorNeutralForeground3,
    fontSize: '12px',
    marginTop: '2px',
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px',
    gap: '8px',
  },
});

export const ImportLibrarySymbolPickerDialog: FunctionComponent<ImportLibrarySymbolPickerDialogProps> = (
  props: ImportLibrarySymbolPickerDialogProps,
) => {
  const dispatch = useDispatch();
  const styles = useStyles();
  const { t } = useTranslation();
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(
    () => new Set(props.symbols.map((_, index) => index)),
  );

  const totalCount = props.symbols.length;
  const selectedCount = selectedIndexes.size;
  const selectAllState: boolean | 'mixed' =
    selectedCount === 0
      ? false
      : selectedCount === totalCount
        ? true
        : 'mixed';

  const selectedSymbols = useMemo(
    () => props.symbols.filter((_, index) => selectedIndexes.has(index)),
    [props.symbols, selectedIndexes],
  );

  return (
    <Dialog open={true} onOpenChange={() => dispatch(actionCancelDialog())}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('dialogues.importLibrarySymbols.title')}</DialogTitle>
          <DialogContent>
            <p>{t('dialogues.importLibrarySymbols.message')}</p>
            <div className={styles.controls}>
              <Checkbox
                checked={selectAllState}
                label={t('common.selectAll')}
                onChange={(_, data) => {
                  if (data.checked === true) {
                    setSelectedIndexes(new Set(props.symbols.map((_, index) => index)));
                  } else {
                    setSelectedIndexes(new Set());
                  }
                }}
              />
              <div>{t('common.selectedCount', { count: selectedSymbols.length })}</div>
            </div>
            <div className={styles.list}>
              {props.symbols.map((item, index) => {
                const selected = selectedIndexes.has(index);
                return (
                  <div key={`${item.name.Name}-${index}`} className={styles.row}>
                    <Checkbox
                      checked={selected}
                      label={item.name.Name}
                      onChange={(_, data) => {
                        const updated = new Set(selectedIndexes);
                        if (data.checked) {
                          updated.add(index);
                        } else {
                          updated.delete(index);
                        }
                        setSelectedIndexes(updated);
                      }}
                    />
                    <div className={styles.symbolMeta}>
                      {t('dialogues.importSymbol.meta', {
                        reference: item.name.Reference,
                        count: item.name.ppp,
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </DialogContent>
          <DialogActions>
            <Button
              appearance="primary"
              disabled={selectedSymbols.length === 0}
              onClick={() => {
                dispatch(importSelectedSymbolsToCurrentLibrary(selectedSymbols) as any);
                dispatch(actionCancelDialog());
              }}
            >
              {t('dialogues.importLibrarySymbols.importSelected')}
            </Button>
            <Button appearance="secondary" onClick={() => dispatch(actionCancelDialog())}>
              {t('common.cancel')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
