import React, { useMemo, useRef, useLayoutEffect, useState } from 'react';
import {
  DataGrid,
  DataGridBody,
  DataGridRow,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridCell,
  TableColumnDefinition,
  DataGridProps,
  SortDirection,
  OnSelectionChangeData,
  makeStyles,
  tokens,
  TableColumnId,
} from '@fluentui/react-components';

const useStyles = makeStyles({
  gridContainer: {
    flexGrow: 1,
    overflow: 'auto',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0, 
  },
  compactGrid: {
    fontSize: '11px',
  },
  stickyHeader: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    backgroundColor: tokens.colorNeutralBackground1,
  },
});

interface PersistentTableState {
  sortState: { sortColumn: TableColumnId | undefined; sortDirection: SortDirection };
  scrollTop: number;
  columnWidths: Record<string, number>;
}

// Module-level cache for state persistence
const stateCache: Record<string, PersistentTableState> = {};

interface PersistentDataGridProps<T> {
  items: T[];
  columns: TableColumnDefinition<T>[];
  stateKey: string;
  getRowId?: (item: T) => string | number;
  onSelectionChange?: (item: T) => void;
  selectionMode?: DataGridProps['selectionMode'];
  className?: string;
  onRowClick?: (item: T) => void;
  onRowMouseEnter?: (item: T) => void;
  onRowMouseLeave?: (item: T) => void;
  defaultSortColumn?: TableColumnId;
  defaultSortDirection?: SortDirection;
  focusedRowId?: string | number | null;
}

export function PersistentDataGrid<T>({
  items,
  columns,
  stateKey,
  getRowId = (item: any) => item.id,
  onSelectionChange,
  selectionMode,
  className,
  onRowClick,
  onRowMouseEnter,
  onRowMouseLeave,
  defaultSortColumn,
  defaultSortDirection = 'ascending',
  focusedRowId = null,
}: PersistentDataGridProps<T>) {
  const styles = useStyles();

  // Initialize state from cache or defaults
  if (!stateCache[stateKey]) {
    stateCache[stateKey] = {
      sortState: { sortColumn: defaultSortColumn, sortDirection: defaultSortDirection },
      scrollTop: 0,
      columnWidths: {}, 
    };
  }

  const initialState = stateCache[stateKey];

  const [sortState, setSortState] = useState(initialState.sortState);
  const [columnSizingOptions, setColumnSizingOptions] = useState<Record<string, number>>(
    initialState.columnWidths
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = stateCache[stateKey].scrollTop;
    }
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    stateCache[stateKey].scrollTop = e.currentTarget.scrollTop;
  };

  const handleSortChange: DataGridProps['onSortChange'] = (
    e,
    nextSortState
  ) => {
    setSortState(nextSortState);
    stateCache[stateKey].sortState = nextSortState;
  };

  const handleColumnResize = (
    e: any,
    data: { columnId: TableColumnId; width: number }
  ) => {
    const newWidths = {
      ...columnSizingOptions,
      [data.columnId as string]: data.width,
    };
    setColumnSizingOptions(newWidths);
    stateCache[stateKey].columnWidths = newWidths;
  };

  const handleSelectionChange: DataGridProps['onSelectionChange'] = (
    e,
    data: OnSelectionChangeData
  ) => {
    if (onSelectionChange && selectionMode !== 'multiselect') {
      const selectedId = Array.from(data.selectedItems)[0];
      if (selectedId !== undefined) {
        // We need to find the item in the sorted/filtered list or original list?
        // Usually original list has all possible IDs
        const item = items.find((i) => getRowId(i) === selectedId);
        if (item) {
          onSelectionChange(item);
        }
      }
    }
  };

  // Internal sorting
  const sortedItems = useMemo(() => {
    if (sortState.sortColumn) {
      return [...items].sort((a, b) => {
        const column = columns.find(
          (c) => c.columnId === sortState.sortColumn
        );
        if (column && column.compare) {
          const comparison = column.compare(a, b);
          return sortState.sortDirection === 'ascending'
            ? comparison
            : -comparison;
        }
        return 0;
      });
    }
    return items;
  }, [items, sortState, columns]);

  useLayoutEffect(() => {
    if (!scrollRef.current || focusedRowId === null || focusedRowId === undefined) {
      return;
    }

    const selectorValue = String(focusedRowId).replace(/"/g, '\\"');
    const row = scrollRef.current.querySelector(
      `[data-rowid="${selectorValue}"]`,
    ) as HTMLElement | null;
    if (row) {
      row.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedRowId, sortedItems]);

  return (
    <div
      className={`${styles.gridContainer} ${styles.compactGrid} compact-data-grid ${className || ''}`}
      ref={scrollRef}
      onScroll={handleScroll}
    >
      <DataGrid
        items={sortedItems}
        columns={columns}
        sortable
        sortState={sortState}
        onSortChange={handleSortChange}
        resizableColumns
        columnSizingOptions={columnSizingOptions as any}
        onColumnResize={handleColumnResize}
        selectionMode={selectionMode}
        getRowId={getRowId}
        onSelectionChange={handleSelectionChange}
      >
        <DataGridHeader className={styles.stickyHeader}>
          <DataGridRow selectionCell={{ style: { display: 'none' } }}>
            {({ renderHeaderCell }) => (
              <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
            )}
          </DataGridRow>
        </DataGridHeader>
        <DataGridBody<T>>
          {({ item, rowId }) => (
            <DataGridRow<T>
              key={rowId}
              data-rowid={String(rowId)}
              selectionCell={{ style: { display: 'none' } }}
              style={
                focusedRowId !== null && focusedRowId !== undefined &&
                String(rowId) === String(focusedRowId)
                  ? {
                      backgroundColor: tokens.colorBrandBackground2,
                      boxShadow: `inset 3px 0 0 ${tokens.colorBrandStroke1}`,
                    }
                  : undefined
              }
              onClick={onRowClick ? () => onRowClick(item) : undefined}
              onMouseEnter={
                onRowMouseEnter ? () => onRowMouseEnter(item) : undefined
              }
              onMouseLeave={
                onRowMouseLeave ? () => onRowMouseLeave(item) : undefined
              }
            >
              {({ renderCell }) => (
                <DataGridCell>{renderCell(item)}</DataGridCell>
              )}
            </DataGridRow>
          )}
        </DataGridBody>
      </DataGrid>
    </div>
  );
}
