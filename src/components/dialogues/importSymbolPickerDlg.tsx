import React, { FunctionComponent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useDispatch, useSelector } from 'react-redux';
import { actionCancelDialog, actionSelectLibrarySymbol } from '../../state/dispatcher/AppDispatcher';
import { ImportedSymbol } from '../../io/kicad/importer';
import { docDrawing } from '../../state/undo/undo';

interface ImportSymbolPickerDialogProps {
  symbols: ImportedSymbol[];
}

const useStyles = makeStyles({
  list: {
    maxHeight: '320px',
    overflowY: 'auto',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: '4px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  row: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusSmall,
    padding: '8px 10px',
    cursor: 'pointer',
    backgroundColor: tokens.colorNeutralBackground1,
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  rowSelected: {
    border: `1px solid ${tokens.colorBrandStroke1}`,
    backgroundColor: tokens.colorBrandBackground2,
  },
  symbolName: {
    fontWeight: 600,
  },
  symbolMeta: {
    color: tokens.colorNeutralForeground3,
    fontSize: '12px',
    marginTop: '2px',
  },
});

export const ImportSymbolPickerDialog: FunctionComponent<ImportSymbolPickerDialogProps> = (
  props: ImportSymbolPickerDialogProps,
) => {
  const dispatch = useDispatch();
  const styles = useStyles();
  const { t } = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const mousePosition = useSelector(
    (state: docDrawing) => state.altStore.mousePosition,
  );

  const selected = props.symbols[selectedIndex];

  return (
    <Dialog open={true} onOpenChange={() => dispatch(actionCancelDialog())}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('dialogues.importSymbol.title')}</DialogTitle>
          <DialogContent>
            <p>{t('dialogues.importSymbol.message')}</p>
            <div className={styles.list}>
              {props.symbols.map((item, index) => {
                const selectedRow = index === selectedIndex;
                return (
                  <div
                    key={`${item.name.Name}-${index}`}
                    className={`${styles.row} ${selectedRow ? styles.rowSelected : ''}`}
                    onClick={() => setSelectedIndex(index)}
                  >
                    <div className={styles.symbolName}>{item.name.Name}</div>
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
              onClick={() => {
                if (!selected) {
                  return;
                }
                dispatch(
                  actionSelectLibrarySymbol(
                    selected.name,
                    selected.symbolData,
                    mousePosition,
                  ),
                );
                dispatch(actionCancelDialog());
              }}
            >
              {t('common.insert')}
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
