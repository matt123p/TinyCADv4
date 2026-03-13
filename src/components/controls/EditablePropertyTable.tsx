import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Button,
  makeStyles,
  tokens,
  Text,
} from '@fluentui/react-components';
import {
  CheckboxCheckedRegular,
  CheckboxUncheckedRegular,
  AddRegular,
  DeleteRegular,
} from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    boxSizing: 'border-box',
    gap: '4px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '4px',
    flexShrink: 0,
    padding: '0 4px',
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
  headerCellCenter: {
    padding: '4px 6px',
    textAlign: 'center',
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
  },
  cellCenter: {
    textAlign: 'center',
  },
  textInput: {
    width: '100%',
    border: 'none',
    background: 'transparent',
    padding: '2px 4px',
    fontSize: '12px',
    outline: 'none',
    boxSizing: 'border-box',
    '&:focus': {
      backgroundColor: tokens.colorNeutralBackground1,
    },
  },
  checkbox: {
    cursor: 'pointer',
    width: '14px',
    height: '14px',
    outline: 'none',
  },
  selectInput: {
    border: 'none',
    background: 'transparent',
    padding: '2px',
    fontSize: '12px',
    cursor: 'pointer',
    outline: 'none',
    width: '100%',
    '&:focus': {
      backgroundColor: tokens.colorNeutralBackground1,
    },
  },
  readOnlySpan: {
    outline: 'none',
  },
  deleteButton: {
    minWidth: '24px',
    width: '24px',
    height: '24px',
    padding: '0',
  },
});

export interface PropertyItem {
  id: string | number;
  name: string;
  value: string;
  show: boolean | number;
  editable: boolean;
  deletable: boolean;
  isRef?: boolean;
}

interface EditablePropertyTableProps {
  title: string;
  items: PropertyItem[];
  showOptions?: { key: number; text: string }[];
  showColumn?: boolean;
  onNameChange: (id: string | number, name: string) => void;
  onValueChange: (id: string | number, value: string) => void;
  onShowChange: (id: string | number, show: any) => void;
  onDelete: (id: string | number) => void;
  onAdd: () => void;
}

export const EditablePropertyTable: React.FC<EditablePropertyTableProps> = ({
  title,
  items,
  showOptions,
  showColumn = true,
  onNameChange,
  onValueChange,
  onShowChange,
  onDelete,
  onAdd,
}) => {
  const styles = useStyles();
  const { t } = useTranslation();
  const [focusedCell, setFocusedCell] = useState<{ row: number; col: number } | null>(null);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const COL_SHOW = showColumn ? 0 : -1;
  const COL_NAME = showColumn ? 1 : 0;
  const COL_VALUE = showColumn ? 2 : 1;
  const COL_DELETE = showColumn ? 3 : 2;
  const COLUMN_COUNT = showColumn ? 4 : 3;

  const navigateCell = useCallback((rowDelta: number, colDelta: number) => {
    setFocusedCell(prev => {
      if (!prev) return prev;
      let newRow = prev.row + rowDelta;
      let newCol = prev.col + colDelta;
      
      // Wrap around columns
      if (newCol < 0) {
        newCol = COLUMN_COUNT - 1;
        newRow = Math.max(0, newRow - 1);
      } else if (newCol >= COLUMN_COUNT) {
        newCol = 0;
        newRow = Math.min(items.length - 1, newRow + 1);
      }
      
      // Clamp rows
      newRow = Math.max(0, Math.min(items.length - 1, newRow));
      
      return { row: newRow, col: newCol };
    });
  }, [items.length]);

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
        // For text inputs, only navigate if at start; for buttons/checkboxes/spans always navigate
        if (target.type === 'checkbox' || target.tagName === 'BUTTON' || target.tagName === 'SPAN' ||
            (target.tagName === 'INPUT' && target.selectionStart === 0)) {
          e.preventDefault();
          navigateCell(0, -1);
        }
        break;
      case 'ArrowRight':
        // For text inputs, only navigate if at end; for buttons/checkboxes/spans always navigate
        if (target.type === 'checkbox' || target.tagName === 'BUTTON' || target.tagName === 'SPAN' ||
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
      const cellId = `prop-cell-${focusedCell.row}-${focusedCell.col}`;
      const cell = document.getElementById(cellId);
      if (cell) {
        const focusable = cell.querySelector('input, button, span[tabindex]') as HTMLElement;
        if (focusable) {
          focusable.focus();
          if ((focusable as HTMLInputElement).select) {
            (focusable as HTMLInputElement).select();
          }
        }
      }
    }
  }, [focusedCell]);

  const handleCellFocus = (rowIndex: number, colIndex: number) => {
    setFocusedCell({ row: rowIndex, col: colIndex });
  };

  return (
    <div className={styles.container}>
      <div className={styles.tableContainer}>
        <table className={styles.table} ref={tableRef}>
          <thead className={styles.thead}>
            <tr>
              {showColumn ? (
                <th className={styles.headerCellCenter} style={{ width: '120px' }}>Show</th>
              ) : null}
              <th className={styles.headerCell} style={{ minWidth: '100px' }}>Name</th>
              <th className={styles.headerCell}>Value</th>
              <th className={styles.headerCellCenter} style={{ width: '110px' }}>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<AddRegular />}
                  onClick={onAdd}
                >
                  {t('dialogues.netlistTypeEditor.addAttribute')}
                </Button>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, rowIndex) => {
              const isFocusedRow = focusedCell?.row === rowIndex;
              const isHoveredRow = hoveredRow === rowIndex;
              const showDelete = isFocusedRow || isHoveredRow;
              
              return (
                <tr
                  key={item.id}
                  className={`${styles.row} ${isFocusedRow ? styles.rowFocused : ''}`}
                  onMouseEnter={() => setHoveredRow(rowIndex)}
                  onMouseLeave={() => setHoveredRow(null)}
                >
                  {showColumn ? (
                    <td 
                      id={`prop-cell-${rowIndex}-${COL_SHOW}`}
                      className={`${styles.cell} ${styles.cellCenter} ${isFocusedRow && focusedCell?.col === COL_SHOW ? styles.cellFocused : ''}`}
                    >
                      {showOptions ? (
                        <select
                          className={styles.selectInput}
                          value={Number(item.show)}
                          onChange={(e) => onShowChange(item.id, Number(e.target.value))}
                          onFocus={() => handleCellFocus(rowIndex, COL_SHOW)}
                          onKeyDown={handleKeyDown}
                          title={t('controls.editableProperty.displayOptions')}
                        >
                          {showOptions.map(opt => (
                             <option key={opt.key} value={opt.key}>{opt.text}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="checkbox"
                          className={styles.checkbox}
                          checked={!!item.show}
                          onChange={(e) => onShowChange(item.id, e.target.checked)}
                          onFocus={() => handleCellFocus(rowIndex, COL_SHOW)}
                          onKeyDown={handleKeyDown}
                          title={
                            item.show
                              ? t('controls.editableProperty.hideProperty')
                              : t('controls.editableProperty.showProperty')
                          }
                        />
                      )}
                    </td>
                  ) : null}
                  
                  {/* Name */}
                  <td 
                    id={`prop-cell-${rowIndex}-${COL_NAME}`}
                    className={`${styles.cell} ${isFocusedRow && focusedCell?.col === COL_NAME ? styles.cellFocused : ''}`}
                  >
                    {item.editable ? (
                      <input
                        type="text"
                        className={styles.textInput}
                        value={item.name}
                        onChange={(e) => onNameChange(item.id, e.target.value)}
                        onFocus={() => handleCellFocus(rowIndex, COL_NAME)}
                        onKeyDown={handleKeyDown}
                      />
                    ) : (
                      <span 
                        className={`${styles.cellReadOnly} ${styles.readOnlySpan}`}
                        style={{ fontWeight: item.isRef ? 600 : 400 }}
                        tabIndex={0}
                        onFocus={() => handleCellFocus(rowIndex, COL_NAME)}
                        onKeyDown={handleKeyDown}
                      >
                        {item.name}
                      </span>
                    )}
                  </td>
                  
                  {/* Value */}
                  <td 
                    id={`prop-cell-${rowIndex}-${COL_VALUE}`}
                    className={`${styles.cell} ${isFocusedRow && focusedCell?.col === COL_VALUE ? styles.cellFocused : ''}`}
                  >
                    <input
                      type="text"
                      className={styles.textInput}
                      value={item.value}
                      onChange={(e) => onValueChange(item.id, e.target.value)}
                      onFocus={() => handleCellFocus(rowIndex, COL_VALUE)}
                      onKeyDown={handleKeyDown}
                    />
                  </td>
                  
                  {/* Delete button */}
                  <td 
                    id={`prop-cell-${rowIndex}-${COL_DELETE}`}
                    className={`${styles.cell} ${styles.cellCenter} ${isFocusedRow && focusedCell?.col === COL_DELETE ? styles.cellFocused : ''}`}
                  >
                    {item.deletable && showDelete && (
                      <Button
                        icon={<DeleteRegular />}
                        size="small"
                        appearance="subtle"
                        className={styles.deleteButton}
                        onClick={() => onDelete(item.id)}
                        onFocus={() => handleCellFocus(rowIndex, COL_DELETE)}
                        onKeyDown={handleKeyDown}
                        title={t('controls.editableProperty.deleteProperty')}
                      />
                    )}
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
