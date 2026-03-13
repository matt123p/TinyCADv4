import React, { Dispatch } from 'react';
import { useTranslation } from 'react-i18next';
import { FindResult } from '../../model/dsnView';
import { Coordinate, DocItem } from '../../model/dsnItem';
import {
  TableCellLayout,
  TableColumnDefinition,
  makeStyles,
  Button,
} from '@fluentui/react-components';
import { Dismiss20Regular } from '@fluentui/react-icons';
import { actionFindSelection, actionSelectPanel, Panels } from '../../state/dispatcher/AppDispatcher';
import { PersistentDataGrid } from '../controls/PersistentDataGrid';

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
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
  },
  headerLabel: {
    fontSize: '12px',
    fontWeight: 'normal' as const,
    textTransform: 'none' as const,
    letterSpacing: 'normal',
    marginLeft: 'auto',
  },
});

interface DrcPanelProps {
  selected: DocItem;
  drcTable: FindResult[];
  hover_point: Coordinate;
  dispatch: Dispatch<any>;
}

export const DrcPanel: React.FC<DrcPanelProps> = ({
  selected,
  drcTable,
  hover_point,
  dispatch,
}) => {
  const styles = useStyles();
  const { t } = useTranslation();

  const handleRowClick = (item: FindResult) => {
    // Mode 3: Center without selecting - switch to sheet and center the item
    dispatch(actionFindSelection(3, item));
  };

  const handleMouseEnter = (item: FindResult) => {
    dispatch(actionFindSelection(1, item));
  };

  const handleMouseLeave = (item: FindResult) => {
    dispatch(actionFindSelection(0, item));
  };

  const columns: TableColumnDefinition<FindResult>[] = [
    {
      columnId: 'sheet',
      compare: (a, b) => (a.sheet || '').localeCompare(b.sheet || ''),
      renderHeaderCell: () => t('panel.drc.sheet'),
      renderCell: (item) => <TableCellLayout>{item.sheet || ''}</TableCellLayout>,
    },
    {
      columnId: 'symbol',
      compare: (a, b) => a.symbol.localeCompare(b.symbol),
      renderHeaderCell: () => t('panel.drc.symbol'),
      renderCell: (item) => <TableCellLayout>{item.symbol}</TableCellLayout>,
    },
    {
      columnId: 'pin',
      compare: (a, b) => (a.pin || '').localeCompare(b.pin || ''),
      renderHeaderCell: () => t('panel.drc.pin'),
      renderCell: (item) => <TableCellLayout>{item.pin || ''}</TableCellLayout>,
    },
    {
      columnId: 'text',
      compare: (a, b) => a.text.localeCompare(b.text),
      renderHeaderCell: () => (
        <div className={styles.headerRow}>
          <span>{t('panel.drc.message')}</span>
          <span className={styles.headerLabel} onClick={(e) => e.stopPropagation()}>
            {t('panel.drc.resultsCount', { count: drcTable?.length || 0 })}
            <Button
              appearance="subtle"
              icon={<Dismiss20Regular />}
              size="small"
              onClick={() => dispatch(actionSelectPanel(Panels.LibrariesPanel))}
              aria-label={t('common.close')}
              style={{ marginLeft: '8px' }}
            />
          </span>
        </div>
      ),
      renderCell: (item) => <TableCellLayout>{item.text}</TableCellLayout>,
    },
  ];

  return (
    <div className={styles.container}>
      <PersistentDataGrid
        items={drcTable || []}
        columns={columns}
        stateKey="DrcPanel"
        getRowId={(item) => `${item.id}-${item.text}-${item.pin || ''}`}
        onRowClick={handleRowClick}
        onRowMouseEnter={handleMouseEnter}
        onRowMouseLeave={handleMouseLeave}
        selectionMode={undefined}
      />
    </div>
  );
};
