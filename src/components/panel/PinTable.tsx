import React, { useState, useMemo, useCallback, useRef, useEffect, Dispatch } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  makeStyles,
  tokens,
  Text,
  Input,
} from '@fluentui/react-components';
import { Search24Regular, Add24Regular } from '@fluentui/react-icons';
import { dsnDrawing } from '../../model/dsnDrawing';
import { DocItemTypes, dsnPin } from '../../model/dsnItem';
import { actionFindSelection, actionCommand, actionSymbolEditPin } from '../../state/dispatcher/AppDispatcher';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    padding: '8px',
    boxSizing: 'border-box',
    gap: '4px',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '4px',
    flexShrink: 0,
  },
  titleSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  title: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
  },
  searchContainer: {
    display: 'flex',
    width: '180px',
  },
  tableContainer: {
    flexGrow: 1,
    overflow: 'auto',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '12px',
    tableLayout: 'auto',
  },
  thead: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  headerCell: {
    padding: '4px 6px',
    textAlign: 'left',
    fontWeight: 600,
    backgroundColor: tokens.colorNeutralBackground3,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    whiteSpace: 'nowrap',
    fontSize: '11px',
  },
  row: {
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  rowFocused: {
    backgroundColor: tokens.colorBrandBackground2,
  },
  cell: {
    padding: '1px 2px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    verticalAlign: 'middle',
    height: '24px',
  },
  cellFocused: {
    outline: `2px solid ${tokens.colorBrandStroke1}`,
    outlineOffset: '-2px',
  },
  cellReadOnly: {
    padding: '1px 6px',
    textAlign: 'center',
  },
  textInput: {
    width: '100%',
    border: 'none',
    background: 'transparent',
    padding: '2px 4px',
    fontSize: '12px',
    outline: 'none',
    '&:focus': {
      backgroundColor: tokens.colorNeutralBackground1,
    },
  },
  numberInput: {
    width: '50px',
    border: 'none',
    background: 'transparent',
    padding: '2px 4px',
    fontSize: '12px',
    textAlign: 'right',
    outline: 'none',
    '&:focus': {
      backgroundColor: tokens.colorNeutralBackground1,
    },
  },
  selectInput: {
    border: 'none',
    background: 'transparent',
    padding: '2px',
    fontSize: '12px',
    cursor: 'pointer',
    outline: 'none',
    '&:focus': {
      backgroundColor: tokens.colorNeutralBackground1,
    },
  },
  checkboxCell: {
    textAlign: 'center',
  },
  checkbox: {
    cursor: 'pointer',
    width: '14px',
    height: '14px',
  },
});

interface PinTableProps {
  drawing: dsnDrawing;
  dispatch: Dispatch<any>;
}

interface PinItem {
  id: number;
  pin: dsnPin;
  sheetName: string;
  sheetIndex: number;
}

const shapeOptions = [
  { key: 0, text: 'Normal' },
  { key: 1, text: 'Dot' },
  { key: 2, text: 'Clock' },
  { key: 3, text: 'Dot Clock' },
  { key: 4, text: 'Power' },
  { key: 5, text: 'Hidden' },
  { key: 6, text: 'Cross' },
];

const elecOptions = [
  { key: 0, text: 'Input' },
  { key: 1, text: 'Output' },
  { key: 2, text: 'Tristate' },
  { key: 3, text: 'Open Coll.' },
  { key: 4, text: 'Passive' },
  { key: 5, text: 'I/O' },
  { key: 6, text: 'N/C' },
];

// Column definitions for navigation
const columnCount = 8;

// Convert part number to display string: 0 -> "-", 1 -> "A", 2 -> "B", etc.
const formatPart = (part: number): string => {
  if (part === 0) return '-';
  return String.fromCharCode(64 + part); // 1->A, 2->B, etc.
};

// Persistent state
const persistentState = {
  searchQuery: '',
};

export const PinTable: React.FC<PinTableProps> = ({
  drawing,
  dispatch,
}) => {
  const styles = useStyles();
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState(persistentState.searchQuery);
  const [focusedCell, setFocusedCell] = useState<{ row: number; col: number } | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const handleSearchChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    data: { value: string }
  ) => {
    setSearchQuery(data.value);
    persistentState.searchQuery = data.value;
  };

  // Transform drawing data into flat list of pins
  const items: PinItem[] = useMemo(() => {
    const pins: PinItem[] = [];
    if (!drawing || !drawing.sheets) return pins;

    drawing.sheets.forEach((sheet, sheetIndex) => {
      sheet.items.forEach((item) => {
        if (item.NodeName === DocItemTypes.Pin) {
          const pin = item as dsnPin;
          pins.push({
            id: pin._id,
            pin: pin,
            sheetName: sheet.name,
            sheetIndex: sheetIndex,
          });
        }
      });
    });

    // Default sort by sheet name, then by pin number
    pins.sort((a, b) => {
      const sheetCompare = a.sheetName.localeCompare(b.sheetName);
      if (sheetCompare !== 0) return sheetCompare;
      return a.pin.number.localeCompare(b.pin.number, undefined, { numeric: true, sensitivity: 'base' });
    });

    return pins;
  }, [drawing]);

  const filteredItems = useMemo(() => {
    if (!searchQuery) {
      return items;
    }

    const lowerQuery = searchQuery.toLowerCase();
    return items.filter(
      (item) =>
        item.pin.name.toLowerCase().includes(lowerQuery) ||
        item.pin.number.toLowerCase().includes(lowerQuery) ||
        shapeOptions.find(o => o.key === item.pin.which)?.text.toLowerCase().includes(lowerQuery) ||
        elecOptions.find(o => o.key === item.pin.elec)?.text.toLowerCase().includes(lowerQuery)
    );
  }, [items, searchQuery]);

  const handlePinUpdate = useCallback((pin: dsnPin, updates: Partial<dsnPin>) => {
    dispatch(actionSymbolEditPin({ ...pin, ...updates }));
  }, [dispatch]);

  const handleAddPin = useCallback(() => {
    dispatch(actionCommand('add_pin'));
  }, [dispatch]);

  const createFindResult = (item: PinItem) => ({
    symbol: 'Pin',
    text: item.pin.name,
    id: item.id,
    sheet: item.sheetName,
    a: [0, 0] as [number, number],
  });

  const handleRowDoubleClick = (item: PinItem) => {
    dispatch(actionFindSelection(3, createFindResult(item)));
  };

  const handleMouseEnter = (item: PinItem) => {
    dispatch(actionFindSelection(1, createFindResult(item)));
  };

  const handleMouseLeave = (item: PinItem) => {
    dispatch(actionFindSelection(0, createFindResult(item)));
  };

  const navigateCell = useCallback((rowDelta: number, colDelta: number) => {
    setFocusedCell(prev => {
      if (!prev) return prev;
      const newRow = Math.max(0, Math.min(filteredItems.length - 1, prev.row + rowDelta));
      const newCol = Math.max(0, Math.min(columnCount - 1, prev.col + colDelta));
      return { row: newRow, col: newCol };
    });
  }, [filteredItems.length]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const target = e.target as HTMLInputElement;
    
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        navigateCell(-1, 0);
        break;
      case 'ArrowDown':
        e.preventDefault();
        navigateCell(1, 0);
        break;
      case 'ArrowLeft':
        // For text inputs, only navigate if at start; for checkboxes/selects always navigate
        if (target.type === 'checkbox' || target.tagName === 'SELECT' || 
            (target.tagName === 'INPUT' && target.selectionStart === 0)) {
          e.preventDefault();
          navigateCell(0, -1);
        }
        break;
      case 'ArrowRight':
        // For text inputs, only navigate if at end; for checkboxes/selects always navigate
        if (target.type === 'checkbox' || target.tagName === 'SELECT' || 
            (target.tagName === 'INPUT' && target.selectionStart === target.value?.length)) {
          e.preventDefault();
          navigateCell(0, 1);
        }
        break;
      case 'Tab':
        e.preventDefault();
        if (e.shiftKey) {
          navigateCell(0, -1);
        } else {
          navigateCell(0, 1);
        }
        break;
      case 'Enter':
        e.preventDefault();
        navigateCell(1, 0);
        break;
    }
  }, [navigateCell]);

  // Focus the cell when focusedCell changes
  useEffect(() => {
    if (focusedCell && tableRef.current) {
      const cellId = `pin-cell-${focusedCell.row}-${focusedCell.col}`;
      const cell = document.getElementById(cellId);
      if (cell) {
        const focusable = cell.querySelector('input, select') as HTMLElement;
        if (focusable) {
          focusable.focus();
          if ((focusable as HTMLInputElement).select) {
            (focusable as HTMLInputElement).select();
          }
        }
      }
    }
  }, [focusedCell]);

  const handleCellFocus = (rowIndex: number, colIndex: number, item: PinItem) => {
    // If moving to a different row, highlight that pin in the drawing
    if (focusedCell?.row !== rowIndex) {
      dispatch(actionFindSelection(1, createFindResult(item)));
    }
    setFocusedCell({ row: rowIndex, col: colIndex });
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleSection}>
          <Text className={styles.title}>{t('panel.pinList.pins')} ({filteredItems.length})</Text>
          <Button
            appearance="primary"
            size="small"
            icon={<Add24Regular />}
            onClick={handleAddPin}
          >
            {t('panel.pinTable.addPin')}
          </Button>
        </div>
        <div className={styles.searchContainer}>
          <Input
            placeholder={t('panel.common.search')}
            size="small"
            contentAfter={<Search24Regular />}
            value={searchQuery}
            onChange={handleSearchChange}
            style={{ width: '100%' }}
          />
        </div>
      </div>
      <div className={styles.tableContainer}>
        <table className={styles.table} ref={tableRef}>
          <thead className={styles.thead}>
            <tr>
              <th className={styles.headerCell}>{t('panel.common.part')}</th>
              <th className={styles.headerCell}>{t('panel.pin.name')}</th>
              <th className={styles.headerCell}>{t('panel.pin.number')}</th>
              <th className={styles.headerCell}>{t('panel.pin.shape')}</th>
              <th className={styles.headerCell}>{t('panel.pin.type')}</th>
              <th className={styles.headerCell}>{t('panel.pin.length')}</th>
              <th className={styles.headerCell}>{t('panel.pin.showName')}</th>
              <th className={styles.headerCell}>{t('panel.pin.showNum')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item, rowIndex) => {
              const pin = item.pin;
              const isFocusedRow = focusedCell?.row === rowIndex;
              
              return (
                <tr
                  key={item.id}
                  className={`${styles.row} ${isFocusedRow ? styles.rowFocused : ''}`}
                  onMouseEnter={() => handleMouseEnter(item)}
                  onMouseLeave={() => handleMouseLeave(item)}
                  onDoubleClick={() => handleRowDoubleClick(item)}
                >
                  {/* Part - read only */}
                  <td 
                    id={`pin-cell-${rowIndex}-0`}
                    className={`${styles.cell} ${styles.cellReadOnly} ${isFocusedRow && focusedCell?.col === 0 ? styles.cellFocused : ''}`}
                  >
                    {formatPart(pin.part)}
                  </td>
                  
                  {/* Name */}
                  <td 
                    id={`pin-cell-${rowIndex}-1`}
                    className={`${styles.cell} ${isFocusedRow && focusedCell?.col === 1 ? styles.cellFocused : ''}`}
                  >
                    <input
                      type="text"
                      className={styles.textInput}
                      value={pin.name}
                      onChange={(e) => handlePinUpdate(pin, { name: e.target.value })}
                      onFocus={() => handleCellFocus(rowIndex, 1, item)}
                      onKeyDown={handleKeyDown}
                    />
                  </td>
                  
                  {/* Number */}
                  <td 
                    id={`pin-cell-${rowIndex}-2`}
                    className={`${styles.cell} ${isFocusedRow && focusedCell?.col === 2 ? styles.cellFocused : ''}`}
                  >
                    <input
                      type="text"
                      className={styles.textInput}
                      value={pin.number}
                      onChange={(e) => handlePinUpdate(pin, { number: e.target.value })}
                      onFocus={() => handleCellFocus(rowIndex, 2, item)}
                      onKeyDown={handleKeyDown}
                    />
                  </td>
                  
                  {/* Shape */}
                  <td 
                    id={`pin-cell-${rowIndex}-3`}
                    className={`${styles.cell} ${isFocusedRow && focusedCell?.col === 3 ? styles.cellFocused : ''}`}
                  >
                    <select
                      className={styles.selectInput}
                      value={pin.which}
                      onChange={(e) => handlePinUpdate(pin, { which: Number(e.target.value) })}
                      onFocus={() => handleCellFocus(rowIndex, 3, item)}
                      onKeyDown={handleKeyDown}
                    >
                      {shapeOptions.map(o => (
                        <option key={o.key} value={o.key}>{o.text}</option>
                      ))}
                    </select>
                  </td>
                  
                  {/* Electrical Type */}
                  <td 
                    id={`pin-cell-${rowIndex}-4`}
                    className={`${styles.cell} ${isFocusedRow && focusedCell?.col === 4 ? styles.cellFocused : ''}`}
                  >
                    <select
                      className={styles.selectInput}
                      value={pin.elec}
                      onChange={(e) => handlePinUpdate(pin, { elec: Number(e.target.value) })}
                      onFocus={() => handleCellFocus(rowIndex, 4, item)}
                      onKeyDown={handleKeyDown}
                    >
                      {elecOptions.map(o => (
                        <option key={o.key} value={o.key}>{o.text}</option>
                      ))}
                    </select>
                  </td>
                  
                  {/* Length */}
                  <td 
                    id={`pin-cell-${rowIndex}-5`}
                    className={`${styles.cell} ${isFocusedRow && focusedCell?.col === 5 ? styles.cellFocused : ''}`}
                  >
                    <input
                      type="number"
                      className={styles.numberInput}
                      value={pin.length}
                      min={5}
                      max={50}
                      onChange={(e) => handlePinUpdate(pin, { length: Number(e.target.value) })}
                      onFocus={() => handleCellFocus(rowIndex, 5, item)}
                      onKeyDown={handleKeyDown}
                    />
                  </td>
                  
                  {/* Show Name */}
                  <td 
                    id={`pin-cell-${rowIndex}-6`}
                    className={`${styles.cell} ${styles.checkboxCell} ${isFocusedRow && focusedCell?.col === 6 ? styles.cellFocused : ''}`}
                  >
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={pin.show_name}
                      onChange={(e) => handlePinUpdate(pin, { show_name: e.target.checked })}
                      onFocus={() => handleCellFocus(rowIndex, 6, item)}
                      onKeyDown={handleKeyDown}
                    />
                  </td>
                  
                  {/* Show Number */}
                  <td 
                    id={`pin-cell-${rowIndex}-7`}
                    className={`${styles.cell} ${styles.checkboxCell} ${isFocusedRow && focusedCell?.col === 7 ? styles.cellFocused : ''}`}
                  >
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={pin.show_number}
                      onChange={(e) => handlePinUpdate(pin, { show_number: e.target.checked })}
                      onFocus={() => handleCellFocus(rowIndex, 7, item)}
                      onKeyDown={handleKeyDown}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
