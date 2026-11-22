import React, { useMemo, useState } from 'react';
import { Input, TableCellLayout } from '@fluentui/react-components';
import type { TableColumnDefinition, TableColumnSizingOptions } from '@fluentui/react-components';
import { NetlistGrid } from '../panel/NetlistGrid';
import type { BoardDocument } from '../../pcb/board';

interface BoardNetRow {
  id: string;
  name: string;
  aliases: string;
  netClass: string;
  connections: number;
  terminals: string;
}

const columns: TableColumnDefinition<BoardNetRow>[] = [
  {
    columnId: 'net',
    compare: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
    renderHeaderCell: () => 'Net',
    renderCell: ({ name }) => <TableCellLayout>{name}</TableCellLayout>,
  },
  {
    columnId: 'connections',
    compare: (a, b) => a.connections - b.connections,
    renderHeaderCell: () => 'Connections',
    renderCell: ({ connections }) => <TableCellLayout>{connections}</TableCellLayout>,
  },
  {
    columnId: 'labels',
    compare: (a, b) => a.aliases.localeCompare(b.aliases),
    renderHeaderCell: () => 'Labels',
    renderCell: ({ aliases }) => <TableCellLayout truncate>{aliases}</TableCellLayout>,
  },
  {
    columnId: 'type',
    compare: (a, b) => a.netClass.localeCompare(b.netClass),
    renderHeaderCell: () => 'Net class',
    renderCell: ({ netClass }) => <TableCellLayout truncate>{netClass}</TableCellLayout>,
  },
  {
    columnId: 'symbols',
    compare: (a, b) => a.terminals.localeCompare(b.terminals),
    renderHeaderCell: () => 'Component terminals',
    renderCell: ({ terminals }) => <TableCellLayout truncate>{terminals}</TableCellLayout>,
  },
];
const columnSizingOptions: TableColumnSizingOptions = {
  net: { minWidth: 72, idealWidth: 128 },
  connections: { minWidth: 82, idealWidth: 100 },
  labels: { minWidth: 62, idealWidth: 120 },
  type: { minWidth: 70, idealWidth: 96 },
  symbols: { minWidth: 320, idealWidth: 340 },
};

export function BoardNetlistPanel({ board, selectedNet, listModeMenu, onSelect, onHover, children }: {
  board: BoardDocument;
  selectedNet: string;
  listModeMenu: React.ReactNode;
  onSelect?: (id: string) => void;
  onHover?: (id: string) => void;
  children?: React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const items = useMemo(() => {
    const filter = query.trim().toLowerCase();
    const footprints = new Map(board.footprintDefinitions?.map((footprint) => [footprint.id, footprint]));
    const netClasses = new Map(board.netClasses?.map(({ id, name }) => [id, name]));
    const padLabelsByDevice = new Map((board.deviceDefinitions ?? []).map((device) => {
      const labels = new Map(footprints.get(device.footprintId)?.pads.map(({ id, label }) => [id, label]));
      const labelsBySignal = new Map<string, string[]>();
      for (const assignment of device.assignments) {
        if (assignment.kind !== 'signal') continue;
        const label = labels.get(assignment.padId);
        if (label === undefined) continue;
        if (!labelsBySignal.has(assignment.signalId)) labelsBySignal.set(assignment.signalId, []);
        labelsBySignal.get(assignment.signalId).push(label);
      }
      return [device.id, labelsBySignal] as const;
    }));
    const terminals = new Map<string, string[]>();
    const schematicSignals = new Map(board.appliedCircuit?.components.flatMap((component) =>
      component.signals.map((signal) => [signal.id, signal.number || signal.name] as const)));
    for (const component of board.components ?? []) {
      for (const { netId, signalId } of component.signals ?? []) {
        if (!terminals.has(netId)) terminals.set(netId, []);
        const reference = component.reference ?? component.id;
        const pads = padLabelsByDevice.get(component.deviceId)?.get(signalId);
        const labels = pads?.length ? pads.join('/') : schematicSignals.get(signalId);
        terminals.get(netId).push(labels ? reference + '.' + labels : reference);
      }
    }
    return (board.nets ?? []).map(({ id, name, aliases, classId }) => ({
      id, name, aliases: aliases?.join(', ') ?? '',
      netClass: netClasses.get(classId) ?? 'Default',
      connections: terminals.get(id)?.length ?? 0,
      terminals: terminals.get(id)?.join(', ') ?? '',
    })).filter((row) => [row.name, row.aliases, row.netClass, row.terminals].some((value) =>
      value.toLowerCase().includes(filter)));
  }, [board.appliedCircuit, board.components, board.deviceDefinitions, board.footprintDefinitions, board.netClasses, board.nets, query]);

  const netlistColumns = columns.map((column) => column.columnId === 'symbols' ? {
    ...column,
    renderHeaderCell: () => <div className="pcb-list-header" onClick={(event) => event.stopPropagation()}>
      <span>Component terminals</span>
      <Input aria-label="Search board netlist" placeholder="Search nets" size="small"
        value={query} onChange={(_, { value }) => setQuery(value)} />
      {listModeMenu}
    </div>,
  } : column);

  return <div className="pcb-navigation-grid">
    <NetlistGrid<BoardNetRow> ariaLabel="Board netlist" columnSizingOptions={columnSizingOptions}
      items={items} columns={netlistColumns} stateKey="BoardNetlistPanel" focusedRowId={selectedNet}
      onRowClick={onSelect && (({ id }) => onSelect(id))}
      onRowMouseEnter={onHover && (({ id }) => onHover(id))}
      onRowMouseLeave={onHover && (() => onHover(''))} />
    {selectedNet && children && <div className="pcb-netlist-details">{children}</div>}
  </div>;
}
