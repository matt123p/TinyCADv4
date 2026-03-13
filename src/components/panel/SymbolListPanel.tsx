import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Menu,
  MenuItemCheckbox,
  MenuList,
  MenuPopover,
  MenuTrigger,
  TableCellLayout,
  TableColumnDefinition,
  Input,
  makeStyles,
  Checkbox,
} from '@fluentui/react-components';
import { ChevronDownRegular } from '@fluentui/react-icons';
import { dsnDrawing } from '../../model/dsnDrawing';
import { DocItemTypes, dsnSymbol, dsnPower, dsnLabel, dsnText } from '../../model/dsnItem';
import { Dispatch } from 'react';
import { actionFindSelection } from '../../state/dispatcher/AppDispatcher';
import { PersistentDataGrid } from '../controls/PersistentDataGrid';
import { ListModeMenuButton } from './ListModeMenuButton';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    padding: '8px',
    boxSizing: 'border-box',
    gap: '4px',
  },
  controlsGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'nowrap',
    width: '100%',
    minWidth: 0,
  },
  controlsHeaderWrap: {
    width: '100%',
  },
  filtersMenuButton: {
    minWidth: '92px',
    fontWeight: 600,
  },
  listModeMenuButton: {
    marginLeft: 'auto',
    minWidth: '130px',
  },
  hiddenSizerRow: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    whiteSpace: 'nowrap',
  },
  listModeSizerButton: {
    minWidth: '130px',
  },
  checkboxLabel: {
    fontSize: '12px',
    fontWeight: 'normal' as const,
    textTransform: 'none' as const,
    letterSpacing: 'normal',
  },
  searchInput: {
    minWidth: '120px',
    maxWidth: '160px',
  },
  hiddenSizer: {
    position: 'absolute',
    visibility: 'hidden',
    pointerEvents: 'none',
    height: 0,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
  },
});

interface SymbolListPanelProps {
  drawing: dsnDrawing;
  dispatch: Dispatch<any>;
  listMode: 'symbols' | 'netlist';
  onListModeChange: (mode: 'symbols' | 'netlist') => void;
}

interface SymbolItem {
  id: number;
  sheetName: string;
  reference: string;
  symbolName: string;
  sheetIndex: number;
  type: DocItemTypes;
}

// Persistent state
const persistentState = {
  searchQuery: '',
  showSymbols: true,
  showPower: true,
  showLabels: true,
  showText: false,
};

const getSymbolRef = (symbol: dsnSymbol): string => {
  const refText = symbol.text.find((t) => t.description === 'Ref');
  let ref = refText ? refText.value : '';
  if (symbol._symbol && symbol._symbol.parts > 1) {
    ref += String.fromCharCode(65 + symbol.part);
  }
  return ref;
};

const getSymbolName = (symbol: dsnSymbol): string => {
  // Attempt to get name from text or library definition
  const nameText = symbol.text.find((t) => t.description === 'Name');
  if (nameText && nameText.value) return nameText.value;
  return symbol._symbol?.name?.value || '';
};

export const SymbolListPanel: React.FC<SymbolListPanelProps> = ({
  drawing,
  dispatch,
  listMode,
  onListModeChange,
}) => {
  const HYSTERESIS_PX = 28;
  const styles = useStyles();
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState(persistentState.searchQuery);
  const [showSymbols, setShowSymbols] = useState(persistentState.showSymbols);
  const [showPower, setShowPower] = useState(persistentState.showPower);
  const [showLabels, setShowLabels] = useState(persistentState.showLabels);
  const [showText, setShowText] = useState(persistentState.showText);
  const [compactFilters, setCompactFilters] = useState(false);
  const controlsHostRef = useRef<HTMLDivElement | null>(null);
  const expandedSizerRef = useRef<HTMLDivElement | null>(null);

  const updateCompactState = useCallback(() => {
    const controlsHost = controlsHostRef.current;
    const expandedSizer = expandedSizerRef.current;
    if (!controlsHost || !expandedSizer) {
      return;
    }

    const expandedWidth = expandedSizer.scrollWidth;
    const availableWidth = controlsHost.clientWidth;

    setCompactFilters((previous) => {
      if (!previous && expandedWidth > availableWidth) {
        return true;
      }
      if (previous && expandedWidth + HYSTERESIS_PX < availableWidth) {
        return false;
      }
      return previous;
    });
  }, []);

  useEffect(() => {
    const controlsHost = controlsHostRef.current;
    if (!controlsHost) {
      return;
    }

    updateCompactState();

    const observer = new ResizeObserver(() => {
      updateCompactState();
    });
    observer.observe(controlsHost);
    window.addEventListener('resize', updateCompactState);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateCompactState);
    };
  }, [updateCompactState]);

  const updateShowSymbols = (checked: boolean) => {
    setShowSymbols(checked);
    persistentState.showSymbols = checked;
  };

  const updateShowPower = (checked: boolean) => {
    setShowPower(checked);
    persistentState.showPower = checked;
  };

  const updateShowLabels = (checked: boolean) => {
    setShowLabels(checked);
    persistentState.showLabels = checked;
  };

  const updateShowText = (checked: boolean) => {
    setShowText(checked);
    persistentState.showText = checked;
  };

  const listModeLabel =
    listMode === 'symbols'
      ? t('panel.listMode.symbols')
      : t('panel.listMode.netlist');
  const filterCheckedValues = {
    symbols: showSymbols ? ['on'] : [],
    power: showPower ? ['on'] : [],
    labels: showLabels ? ['on'] : [],
    text: showText ? ['on'] : [],
  };

  const handleSearchChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    data: { value: string }
  ) => {
    setSearchQuery(data.value);
    persistentState.searchQuery = data.value;
  };

  // Transform drawing data into flat list of symbols
  const items: SymbolItem[] = useMemo(() => {
    const symbols: SymbolItem[] = [];
    if (!drawing || !drawing.sheets) return symbols;

    drawing.sheets.forEach((sheet, sheetIndex) => {
      sheet.items.forEach((item) => {
        if (item.NodeName === DocItemTypes.Symbol) {
          const sym = item as dsnSymbol;
          symbols.push({
            id: sym._id,
            sheetName: sheet.name,
            reference: getSymbolRef(sym),
            symbolName: getSymbolName(sym),
            sheetIndex: sheetIndex,
            type: DocItemTypes.Symbol,
          });
        } else if (item.NodeName === DocItemTypes.Power) {
          const pow = item as dsnPower;
          symbols.push({
            id: pow._id,
            sheetName: sheet.name,
            reference: '',
            symbolName: pow.text,
            sheetIndex: sheetIndex,
            type: DocItemTypes.Power,
          });
        } else if (item.NodeName === DocItemTypes.Label) {
          const lbl = item as dsnLabel;
          symbols.push({
            id: lbl._id,
            sheetName: sheet.name,
            reference: '',
            symbolName: lbl.text,
            sheetIndex: sheetIndex,
            type: DocItemTypes.Label,
          });
        } else if (item.NodeName === DocItemTypes.Text) {
          const txt = item as dsnText;
          symbols.push({
            id: txt._id,
            sheetName: sheet.name,
            reference: '',
            symbolName: txt.text,
            sheetIndex: sheetIndex,
            type: DocItemTypes.Text,
          });
        }
      });
    });
    return symbols;
  }, [drawing]);

  const filteredItems = useMemo(() => {
    let result = items.filter((item) => {
      if (!showSymbols && item.type === DocItemTypes.Symbol) return false;
      if (!showPower && item.type === DocItemTypes.Power) return false;
      if (!showLabels && item.type === DocItemTypes.Label) return false;
      if (!showText && item.type === DocItemTypes.Text) return false;
      return true;
    });

    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      result = result.filter(
        (item) =>
          item.reference.toLowerCase().includes(lowerQuery) ||
          item.symbolName.toLowerCase().includes(lowerQuery) ||
          item.sheetName.toLowerCase().includes(lowerQuery)
      );
    }
    
    return result;
  }, [items, searchQuery, showSymbols, showPower, showLabels, showText]);

  const columns: TableColumnDefinition<SymbolItem>[] = [
    {
      columnId: 'sheetName',
      compare: (a, b) => {
        const sheetCompare = a.sheetName.localeCompare(b.sheetName);
        if (sheetCompare !== 0) return sheetCompare;
        return a.reference.localeCompare(b.reference, undefined, { numeric: true, sensitivity: 'base' });
      },
      renderHeaderCell: () => t('panel.symbolList.sheetName'),
      renderCell: (item) => (
        <TableCellLayout>{item.sheetName}</TableCellLayout>
      ),
    },
    {
      columnId: 'type',
      compare: (a, b) => a.type.localeCompare(b.type),
      renderHeaderCell: () => t('panel.symbolList.type'),
      renderCell: (item) => {
        let typeText = t('panel.symbolList.typeSymbol');
        if (item.type === DocItemTypes.Power) typeText = t('panel.symbolList.typePower');
        if (item.type === DocItemTypes.Label) typeText = t('panel.symbolList.typeLabel');
        if (item.type === DocItemTypes.Text) typeText = t('panel.symbolList.typeText');
        return <TableCellLayout>{typeText}</TableCellLayout>;
      },
    },
    {
      columnId: 'reference',
      compare: (a, b) => a.reference.localeCompare(b.reference),
      renderHeaderCell: () => t('panel.symbolList.reference'),
      renderCell: (item) => (
        <TableCellLayout>{item.reference}</TableCellLayout>
      ),
    },
    {
      columnId: 'symbolName',
      compare: (a, b) => a.symbolName.localeCompare(b.symbolName),
      renderHeaderCell: () => t('panel.symbolList.name'),
      renderCell: (item) => (
        <TableCellLayout truncate>{item.symbolName}</TableCellLayout>
      ),
    },
    {
      columnId: 'controls',
      compare: () => 0,
      renderHeaderCell: () => (
        <div className={styles.controlsHeaderWrap} onClick={(e) => e.stopPropagation()}>
          <div
            ref={controlsHostRef}
            className={styles.controlsGroup}
          >
            {compactFilters ? (
              <Menu
                checkedValues={filterCheckedValues}
                onCheckedValueChange={(_, data) => {
                  const isChecked = data.checkedItems.length > 0;
                  if (data.name === 'symbols') {
                    updateShowSymbols(isChecked);
                  } else if (data.name === 'power') {
                    updateShowPower(isChecked);
                  } else if (data.name === 'labels') {
                    updateShowLabels(isChecked);
                  } else if (data.name === 'text') {
                    updateShowText(isChecked);
                  }
                }}
              >
                <MenuTrigger disableButtonEnhancement>
                  <Button
                    type="button"
                    size="small"
                    appearance="subtle"
                    icon={<ChevronDownRegular />}
                    iconPosition="after"
                    className={styles.filtersMenuButton}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t('panel.symbolList.filters')}
                  </Button>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItemCheckbox
                      name="symbols"
                      value="on"
                    >
                      {t('panel.symbolList.symbols')}
                    </MenuItemCheckbox>
                    <MenuItemCheckbox
                      name="power"
                      value="on"
                    >
                      {t('panel.symbolList.power')}
                    </MenuItemCheckbox>
                    <MenuItemCheckbox
                      name="labels"
                      value="on"
                    >
                      {t('panel.symbolList.labels')}
                    </MenuItemCheckbox>
                    <MenuItemCheckbox
                      name="text"
                      value="on"
                    >
                      {t('panel.symbolList.text')}
                    </MenuItemCheckbox>
                  </MenuList>
                </MenuPopover>
              </Menu>
            ) : (
              <>
                <Checkbox
                  label={<span className={styles.checkboxLabel}>{t('panel.symbolList.symbols')}</span>}
                  checked={showSymbols}
                  onChange={(_, data) => updateShowSymbols(!!data.checked)}
                />
                <Checkbox
                  label={<span className={styles.checkboxLabel}>{t('panel.symbolList.power')}</span>}
                  checked={showPower}
                  onChange={(_, data) => updateShowPower(!!data.checked)}
                />
                <Checkbox
                  label={<span className={styles.checkboxLabel}>{t('panel.symbolList.labels')}</span>}
                  checked={showLabels}
                  onChange={(_, data) => updateShowLabels(!!data.checked)}
                />
                <Checkbox
                  label={<span className={styles.checkboxLabel}>{t('panel.symbolList.text')}</span>}
                  checked={showText}
                  onChange={(_, data) => updateShowText(!!data.checked)}
                />
              </>
            )}
            <Input
              placeholder={t('panel.common.search')}
              value={searchQuery}
              onChange={handleSearchChange}
              className={styles.searchInput}
              size="small"
            />
            <ListModeMenuButton
              listMode={listMode}
              onListModeChange={onListModeChange}
              className={styles.listModeMenuButton}
              stopPropagation
            />
          </div>
          <div ref={expandedSizerRef} className={styles.hiddenSizer}>
            <div className={styles.hiddenSizerRow}>
              <Checkbox
                label={<span className={styles.checkboxLabel}>{t('panel.symbolList.symbols')}</span>}
                checked={showSymbols}
              />
              <Checkbox
                label={<span className={styles.checkboxLabel}>{t('panel.symbolList.power')}</span>}
                checked={showPower}
              />
              <Checkbox
                label={<span className={styles.checkboxLabel}>{t('panel.symbolList.labels')}</span>}
                checked={showLabels}
              />
              <Checkbox
                label={<span className={styles.checkboxLabel}>{t('panel.symbolList.text')}</span>}
                checked={showText}
              />
              <Input
                value={searchQuery}
                className={styles.searchInput}
                size="small"
              />
              <Button
                type="button"
                size="small"
                appearance="subtle"
                icon={<ChevronDownRegular />}
                iconPosition="after"
                className={styles.listModeSizerButton}
              >
                {listModeLabel}
              </Button>
            </div>
          </div>
        </div>
      ),
      renderCell: () => null,
    },
  ];

  const createFindResult = (item: SymbolItem) => ({
    symbol: item.reference,
    text: item.symbolName,
    id: item.id,
    sheet: item.sheetName,
    a: [0, 0] as [number, number], // Dummy coordinate, the reducer handles finding the object by ID
  });

  const handleRowClick = (item: SymbolItem) => {
    // Mode 3: Center without selecting - switch to sheet and center the item
    dispatch(actionFindSelection(3, createFindResult(item)));
  };

  const handleMouseEnter = (item: SymbolItem) => {
    // Mode 1: Hovering - highlight the item in the drawing
    dispatch(actionFindSelection(1, createFindResult(item)));
  };

  const handleMouseLeave = (item: SymbolItem) => {
    // Mode 0: Not hovering - clear the highlight
    dispatch(actionFindSelection(0, createFindResult(item)));
  };

  return (
    <div className={styles.container}>
      <PersistentDataGrid<SymbolItem>
          items={filteredItems}
          columns={columns}
          stateKey="SymbolListPanel"
          getRowId={(item) => item.id}
          onRowClick={handleRowClick}
          onRowMouseEnter={handleMouseEnter}
          onRowMouseLeave={handleMouseLeave}
          selectionMode={undefined}
          defaultSortColumn="sheetName"
        />
    </div>
  );
};
