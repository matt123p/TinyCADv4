import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Combobox,
  Input,
  Option,
  TableCellLayout,
  TableColumnDefinition,
  makeStyles,
} from '@fluentui/react-components';
import { Dispatch } from 'react';
import { subscribeNetlist } from '../../io/netlists/netlistSync';
import { NetlistData, NetListNode } from '../../io/netlists/netlistGenerator';
import { DocItemTypes } from '../../model/dsnItem';
import {
  DEFAULT_NETLIST_TYPE_NAME,
  NetlistTypes,
  dsnDrawing,
  ensureNetlistTypes,
} from '../../model/dsnDrawing';
import {
  actionFindSelection,
  actionSelectDialog,
  actionUnfocus,
  actionUpdateNetlistTypes,
} from '../../state/dispatcher/AppDispatcher';
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
    gap: '6px',
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
  listModeMenuButton: {
    marginLeft: 'auto',
    minWidth: '130px',
    flexShrink: 0,
  },
  searchInput: {
    minWidth: '120px',
    maxWidth: '160px',
  },
  netlistTypesButton: {
    flexShrink: 0,
  },
  typeCell: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
  },
  typeCombo: {
    flex: '1 1 0',
    boxSizing: 'border-box',
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
  },
  typeInput: {
    minWidth: 0,
    width: '100%',
    paddingRight: '28px',
    '& .fui-Combobox__input': {
      width: '100%',
      minWidth: 0,
    },
  },
});

interface NetlistListPanelProps {
  dispatch: Dispatch<any>;
  focusedParentId?: number;
  drawing: dsnDrawing;
  listMode: 'symbols' | 'netlist';
  onListModeChange: (mode: 'symbols' | 'netlist') => void;
}

interface NetItem {
  id: string;
  net: string;
  sheet: string;
  labels: string;
  connections: number;
  symbols: string;
  type: string;
  parentIds: number[];
  hoverIds: number[];
  hoverPins: string[];
  targetId: number | null;
  firstNode: NetListNode;
  targetNode: NetListNode;
}

const persistentState = {
  searchQuery: '',
};

const emptyNetlist: NetlistData = {
  nets: {},
  nodes: {},
  eprops: {},
  labels: {},
  symbols: [],
};

function buildRows(
  netlist: NetlistData | null,
  netTypeAssignments: { [net: string]: string },
): NetItem[] {
  if (!netlist) {
    return [];
  }

  const rows: NetItem[] = [];

  const resolveNodeParentId = (node: NetListNode): number | null => {
    if (!node.parent) {
      return null;
    }
    const id = (node.parent as any)?._id;
    return typeof id === 'number' ? id : null;
  };

  const resolveNodeTargetId = (node: NetListNode): number | null => {
    if (!node.parent) {
      return null;
    }

    if (node.parent.NodeName === DocItemTypes.Pin) {
      return node.symbol?._id ?? null;
    }

    return resolveNodeParentId(node);
  };

  const resolveNodePinKey = (node: NetListNode): string | null => {
    if (!node.parent || node.parent.NodeName !== DocItemTypes.Pin) {
      return null;
    }
    const symbolId = node.symbol?._id;
    const pinNumber = node.pin || (node.parent as any)?.number;
    if (typeof symbolId !== 'number' || !pinNumber) {
      return null;
    }
    return `${symbolId}:${pinNumber}`;
  };

  const allowedHoverTypes = new Set<DocItemTypes>([
    DocItemTypes.Label,
    DocItemTypes.Power,
    DocItemTypes.Wire,
  ]);

  const nodePriority = [
    DocItemTypes.Label,
    DocItemTypes.Power,
    DocItemTypes.Wire,
    DocItemTypes.Pin,
  ];

  const pickTargetNode = (nodes: NetListNode[]): NetListNode => {
    for (let i = 0; i < nodePriority.length; ++i) {
      const wanted = nodePriority[i];
      const hit = nodes.find(
        (node) => node.parent?.NodeName === wanted && !!(node.parent as any)?._id,
      );
      if (hit) {
        return hit;
      }
    }

    return (
      nodes.find((node) => !!node.parent && !!(node.parent as any)?._id) ||
      nodes[0]
    );
  };

  for (const net in netlist.nets) {
    if (!netlist.nets.hasOwnProperty(net)) {
      continue;
    }

    const nodes = netlist.nets[net] || [];
    if (nodes.length === 0) {
      continue;
    }

    const labels = Array.from(
      new Set(nodes.map((node) => node.label).filter((label) => !!label)),
    ) as string[];
    const pinConnections = nodes.filter(
      (node) => node.parent?.NodeName === DocItemTypes.Pin,
    ).length;
    const symbols = Array.from(
      new Set(
        nodes
          .map((node) => (node.reference ? `${node.reference}${node.pin ? '.' + node.pin : ''}` : ''))
          .filter((x) => !!x),
      ),
    );
    const parentIds = Array.from(
      new Set(
        nodes
          .map((node) => resolveNodeTargetId(node))
          .filter((id) => typeof id === 'number'),
      ),
    ) as number[];
    const hoverIds = Array.from(
      new Set(
        nodes
          .filter((node) => !!node.parent && allowedHoverTypes.has(node.parent.NodeName))
          .map((node) => resolveNodeParentId(node))
          .filter((id) => typeof id === 'number'),
      ),
    ) as number[];
    const hoverPins = Array.from(
      new Set(
        nodes
          .map((node) => resolveNodePinKey(node))
          .filter((pinKey) => !!pinKey),
      ),
    ) as string[];
    const targetNode = pickTargetNode(nodes);
    const primaryNode = targetNode;
    const targetId = resolveNodeTargetId(targetNode);

    rows.push({
      id: `${net}:${primaryNode.sheet}:${(primaryNode.parent as any)?._id ?? 0}`,
      net,
      sheet: primaryNode.sheet || '',
      labels: labels.join(', '),
      connections: pinConnections,
      symbols: symbols.join(', '),
      type: netTypeAssignments[net] || DEFAULT_NETLIST_TYPE_NAME,
      parentIds,
      hoverIds,
      hoverPins,
      targetId,
      firstNode: primaryNode,
      targetNode,
    });
  }

  return rows;
}

export const NetlistListPanel: React.FC<NetlistListPanelProps> = ({
  dispatch,
  focusedParentId,
  drawing,
  listMode,
  onListModeChange,
}) => {
    const { t } = useTranslation();
  const styles = useStyles();
  const [searchQuery, setSearchQuery] = useState(persistentState.searchQuery);
  const [netlist, setNetlist] = useState<NetlistData | null>(null);

  const netlistTypes = useMemo(
    () => ensureNetlistTypes(drawing?.netlistTypes),
    [drawing?.netlistTypes],
  );
  const netTypeAssignments = drawing?.netTypeAssignments || {};
  const typeNames = useMemo(() => Object.keys(netlistTypes).sort(), [netlistTypes]);

  useEffect(() => {
    return subscribeNetlist((value) => {
      setNetlist(value);
    });
  }, []);

  const handleSearchChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    data: { value: string },
  ) => {
    setSearchQuery(data.value);
    persistentState.searchQuery = data.value;
  };

  const applyTypeState = (
    nextTypes: NetlistTypes,
    nextAssignments: { [net: string]: string },
  ) => {
    dispatch(
      actionUpdateNetlistTypes(netlist || emptyNetlist, nextTypes, nextAssignments),
    );
  };

  const ensureTypeExists = (typeName: string, sourceTypes: NetlistTypes) => {
    const name = typeName.trim();
    if (!name) {
      return sourceTypes;
    }
    if (sourceTypes[name]) {
      return sourceTypes;
    }
    const base =
      sourceTypes[DEFAULT_NETLIST_TYPE_NAME] ||
      netlistTypes[DEFAULT_NETLIST_TYPE_NAME];
    return {
      ...sourceTypes,
      [name]: {
        ...base,
        name,
        attributes: { ...(base.attributes || {}) },
      },
    };
  };

  const commitNetType = (net: string, rawTypeName: string) => {
    const typeName = rawTypeName.trim();
    if (!typeName) {
      return;
    }
    const nextTypes = ensureTypeExists(typeName, netlistTypes);
    const nextAssignments = {
      ...netTypeAssignments,
      [net]: typeName,
    };
    applyTypeState(nextTypes, nextAssignments);
  };

  const items = useMemo(() => {
    const rows = buildRows(netlist, netTypeAssignments);
    if (!searchQuery) {
      return rows;
    }

    const q = searchQuery.toLowerCase();
    return rows.filter(
      (row) =>
        row.net.toLowerCase().includes(q) ||
        row.sheet.toLowerCase().includes(q) ||
        row.labels.toLowerCase().includes(q) ||
        row.symbols.toLowerCase().includes(q) ||
        row.type.toLowerCase().includes(q),
    );
  }, [netlist, netTypeAssignments, searchQuery]);

  const columns: TableColumnDefinition<NetItem>[] = [
    {
      columnId: 'net',
      compare: (a, b) => a.net.localeCompare(b.net, undefined, { numeric: true }),
      renderHeaderCell: () => t('panel.netlistList.net'),
      renderCell: (item) => <TableCellLayout>{item.net}</TableCellLayout>,
    },
    {
      columnId: 'sheet',
      compare: (a, b) => a.sheet.localeCompare(b.sheet),
      renderHeaderCell: () => t('panel.netlistList.sheet'),
      renderCell: (item) => <TableCellLayout>{item.sheet}</TableCellLayout>,
    },
    {
      columnId: 'connections',
      compare: (a, b) => a.connections - b.connections,
      renderHeaderCell: () => t('panel.netlistList.connections'),
      renderCell: (item) => <TableCellLayout>{item.connections}</TableCellLayout>,
    },
    {
      columnId: 'labels',
      compare: (a, b) => a.labels.localeCompare(b.labels),
      renderHeaderCell: () => t('panel.netlistList.labels'),
      renderCell: (item) => <TableCellLayout truncate>{item.labels}</TableCellLayout>,
    },
    {
      columnId: 'type',
      compare: (a, b) => a.type.localeCompare(b.type),
      renderHeaderCell: () => t('panel.netlistList.type'),
      renderCell: (item) => (
        <div className={styles.typeCell} onClick={(e) => e.stopPropagation()}>
          <Combobox
            className={styles.typeCombo}
            input={{ className: styles.typeInput }}
            value={item.type}
            freeform
            size="small"
            onOptionSelect={(_, data) =>
              commitNetType(item.net, String(data.optionValue || ''))
            }
            onBlur={(event) =>
              commitNetType(
                item.net,
                (event.target as HTMLInputElement).value || item.type,
              )
            }
          >
            {typeNames.map((name) => (
              <Option key={name} value={name}>
                {name}
              </Option>
            ))}
          </Combobox>
        </div>
      ),
    },
    {
      columnId: 'symbols',
      compare: (a, b) => a.symbols.localeCompare(b.symbols),
      renderHeaderCell: () => (
        <div className={styles.controlsHeaderWrap} onClick={(e) => e.stopPropagation()}>
          <div className={styles.controlsGroup}>
            <span>{t('panel.netlistList.symbols')}</span>
            <Input
              placeholder={t('panel.common.search')}
              value={searchQuery}
              onChange={handleSearchChange}
              className={styles.searchInput}
              size="small"
            />
            <Button
              type="button"
              size="small"
              className={styles.netlistTypesButton}
              onClick={() =>
                dispatch(
                  actionSelectDialog('netlist_type_editor', {
                    drawing,
                    netlist: netlist || emptyNetlist,
                  }),
                )
              }
            >
              {t('dialogues.netlistTypeEditor.title')}
            </Button>
            <ListModeMenuButton
              listMode={listMode}
              onListModeChange={onListModeChange}
              className={styles.listModeMenuButton}
              stopPropagation
            />
          </div>
        </div>
      ),
      renderCell: (item) => <TableCellLayout truncate>{item.symbols}</TableCellLayout>,
    },
  ];

  const focusedRowId = useMemo(() => {
    if (!focusedParentId) {
      return null;
    }
    const row = items.find((item) => item.parentIds.includes(focusedParentId));
    return row ? row.id : null;
  }, [items, focusedParentId]);

  const handleRowClick = (item: NetItem) => {
    const id = item.targetId ?? item.hoverIds[0] ?? null;
    if (!id) {
      return;
    }

    dispatch(actionUnfocus());

    dispatch(
      actionFindSelection(3, {
        symbol: item.net,
        text: item.labels || item.symbols,
        id: id,
        sheet: item.targetNode.sheet,
        a: (item.targetNode.a || [0, 0]) as [number, number],
      }),
    );
  };

  const handleMouseEnter = (item: NetItem) => {
    const id = item.hoverIds[0] ?? null;
    if (!id && item.hoverPins.length === 0) {
      return;
    }

    dispatch(
      actionFindSelection(1, {
        symbol: item.net,
        text: item.labels || item.symbols,
        id: id,
        ids: item.hoverIds,
        pins: item.hoverPins,
        sheet: item.firstNode.sheet,
        a: (item.firstNode.a || [0, 0]) as [number, number],
      }),
    );
  };

  const handleMouseLeave = (item: NetItem) => {
    const id = item.hoverIds[0] ?? null;
    if (!id) {
      return;
    }

    dispatch(
      actionFindSelection(0, {
        symbol: item.net,
        text: item.labels || item.symbols,
        id: id,
        sheet: item.firstNode.sheet,
        a: (item.firstNode.a || [0, 0]) as [number, number],
      }),
    );
  };

  return (
    <div className={styles.container}>
      <PersistentDataGrid<NetItem>
        items={items}
        columns={columns}
        stateKey="NetlistListPanel"
        getRowId={(item) => item.id}
        focusedRowId={focusedRowId}
        onRowClick={handleRowClick}
        onRowMouseEnter={handleMouseEnter}
        onRowMouseLeave={handleMouseLeave}
        selectionMode={undefined}
        defaultSortColumn="net"
      />
    </div>
  );
};
