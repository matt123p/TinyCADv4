import React, { Dispatch, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import SheetTab, { MenuItemData } from './sheetTab';
import { makeStyles, tokens } from '@fluentui/react-components';
import { AddRegular, DismissRegular, SubtractRegular } from '@fluentui/react-icons';
import { dsnSheet } from '../../model/dsnDrawing';
import {
  actionBomClose,
  actionMenuBrowserClose,
  actionSelectDialog,
  actionSheetMove,
  actionSetPPP,
} from '../../state/dispatcher/AppDispatcher';
import { dsnBomEntry } from '../../model/dsnBomEntry';
import { tclibLibraryEntry } from '../../model/tclib';
import { BrowserSheetData } from '../../model/dsnView';
import { Coordinate } from '../../model/dsnItem';

const useStyles = makeStyles({
  sheetbar: {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: tokens.colorNeutralBackground3,
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
    padding: '0 4px',
    gap: '0',
    height: '26px',
    minHeight: '26px',
    flexShrink: 0,
  },
  sheetTabsContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    overflowX: 'auto',
    overflowY: 'hidden',
    flexShrink: 1,
    flexGrow: 0,
    maxWidth: 'calc(50% - 20px)',
    scrollbarWidth: 'none',
    '&::-webkit-scrollbar': {
      display: 'none',
    },
  },
  sheetAddButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    cursor: 'pointer',
    borderRadius: tokens.borderRadiusMedium,
    flexShrink: 0,
    marginLeft: '2px',
    color: tokens.colorNeutralForeground2,
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      color: tokens.colorNeutralForeground1,
    },
  },
  divider: {
    width: '1px',
    height: '16px',
    backgroundColor: tokens.colorNeutralStroke2,
    margin: '0 6px',
    flexShrink: 0,
  },
  scrollbarArea: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: '50px',
  },
});

interface SheetbarProps {
  sheets: dsnSheet[];
  selected_sheet: number;
  editSymbol: tclibLibraryEntry;
  bom: dsnBomEntry[];
  browserSheets: BrowserSheetData[];
  dispatch: Dispatch<any>;
  hover_point?: Coordinate;
}

export const Sheetbar: React.FC<SheetbarProps> = (props) => {
    const { t } = useTranslation();
  const styles = useStyles();
  const [dragSourceIndex, setDragSourceIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleAddClick = () => {
    if (props.editSymbol) {
      props.dispatch(actionSetPPP(Math.max(1, props.editSymbol.ppp) + 1));
    } else {
      props.dispatch(
        actionSelectDialog('sheet_add', {
          name: 'Sheet ' + (props.sheets.length + 1),
        }),
      );
    }
  };

  const handleDragStart = useCallback((index: number) => {
    setDragSourceIndex(index);
  }, []);

  const handleDragOver = useCallback((index: number) => {
    setDragOverIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragSourceIndex(null);
    setDragOverIndex(null);
  }, []);

  const handleDrop = useCallback((targetIndex: number) => {
    if (dragSourceIndex !== null && dragSourceIndex !== targetIndex) {
      props.dispatch(actionSheetMove(dragSourceIndex, targetIndex));
    }
    setDragSourceIndex(null);
    setDragOverIndex(null);
  }, [dragSourceIndex, props.dispatch]);

  let sheets: JSX.Element[] = [];

  if (props.editSymbol) {
    for (let i = 0; i < Math.max(1, props.editSymbol.ppp); i++) {
      sheets.push(
        <SheetTab
          name={`Part ${String.fromCharCode(65 + i)}`}
          selected={i === props.selected_sheet}
          index={i}
          key={i}
          menu={[]}
          canDelete={false}
          hierarchicalSymbol={false}
          draggable={false}
        />,
      );
    }
  } else {
    // Determine minimum draggable index (skip hierarchical symbol sheet)
    const minDraggableIndex = props.sheets[0]?.hierarchicalSymbol ? 1 : 0;
    
    sheets = props.sheets.map((sheet, index) => {
      const canDrag = index >= minDraggableIndex;
      return (
        <SheetTab
          name={sheet.name}
          selected={props.selected_sheet === index}
          index={index}
          key={index}
          canDelete={props.sheets.length > 1}
          hierarchicalSymbol={sheet.hierarchicalSymbol}
          draggable={canDrag}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDrop={handleDrop}
          isDragOver={dragOverIndex === index && dragSourceIndex !== index}
        />
      );
    });
  }

  const bomMenu: MenuItemData[] = [
    {
      key: 'close_bom',
      text: t('common.close'),
      iconName: 'Cancel',
      onClick: () => props.dispatch(actionBomClose()),
    },
  ];

  return (
    <div className={`${styles.sheetbar} sheetbar`}>
      <div className={styles.sheetTabsContainer}>
        {props.bom ? (
          <SheetTab
            name="BOM"
            index={-1}
            selected={props.selected_sheet === -1}
            menu={bomMenu}
            canDelete={false}
            hierarchicalSymbol={false}
            draggable={false}
          />
        ) : null}
        {sheets}
        {props.browserSheets.map((browserData, index) => {
          const browserMenu: MenuItemData[] = [
            {
              key: `close_sheet_${index}`,
              text: t('common.close'),
              iconName: 'Cancel',
              onClick: () => props.dispatch(actionMenuBrowserClose(index)),
            },
          ];
          return (
            <SheetTab
              name={browserData.name}
              index={-2 - index}
              key={`browser_${index}`}
              selected={props.selected_sheet === (-2 - index)}
              menu={browserMenu}
              canDelete={false}
              hierarchicalSymbol={false}
              draggable={false}
            />
          );
        })}
      </div>
      <div className={`${styles.sheetAddButton} sheet-add-button`} onClick={handleAddClick} title={props.editSymbol ? t('toolbar.sheetbar.addNewPart') : t('toolbar.sheetbar.addNewSheet')}>
        <AddRegular />
      </div>
      {props.editSymbol && props.editSymbol.ppp > 1 && (
        <div 
          className={`${styles.sheetAddButton} sheet-add-button`} 
          onClick={() => props.dispatch(actionSetPPP(props.editSymbol.ppp - 1))}
          title={t('toolbar.sheetbar.removeLastPart')}
        >
          <SubtractRegular />
        </div>
      )}
      <div className={styles.divider} />
      <div className={styles.scrollbarArea} />
      <div style={{ marginLeft: '10px', marginRight: '4px', fontSize: '11px', whiteSpace: 'nowrap', userSelect: 'none', color: tokens.colorNeutralForeground2, fontFamily: 'monospace' }}>
         {props.hover_point 
           ? `X: ${(props.hover_point[0] / 5).toFixed(2).padStart(7, '\u00A0')} mm  Y: ${(props.hover_point[1] / 5).toFixed(2).padStart(7, '\u00A0')} mm`
           : `X: ${'\u00A0'.repeat(7)}--- mm  Y: ${'\u00A0'.repeat(7)}--- mm`}
      </div>
    </div>
  );
};
