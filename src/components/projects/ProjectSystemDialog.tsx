import React, { useState } from 'react';
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import type { BoardInstancePort, dsnSymbol } from '../../model/dsnItem';
import { boardInstancePorts } from '../../io/projectSystem';
import type { readBoardInterface, reviewProjectSystem } from '../../io/projectSystem';

export type SystemConnections = Awaited<ReturnType<typeof reviewProjectSystem>>;
export type BoardInterface = Awaited<ReturnType<typeof readBoardInterface>>;

export function BoardPortDialog({ item, board, onApply, onClose }: {
  item: dsnSymbol;
  board: BoardInterface;
  onApply(ports: readonly BoardInstancePort[]): void;
  onClose(): void;
}) {
  const [selected, setSelected] = useState(() => new Map(
    item.hierarchy.boardInstance.ports.map(({ portId, componentId, signalId }) =>
      [portId, componentId + ':' + signalId]),
  ));
  const ports = boardInstancePorts(item);
  const invalid = ports.some(({ id }) => selected.get(id) && !board.endpoints.has(selected.get(id)));
  return (
    <Dialog open onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Map board ports</DialogTitle>
          <DialogContent className="pcb-profile-fields" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
            <p>{board.board.path}</p>
            {!board.endpoints.size && <p>Assign a reviewed footprint to the connector on this PCB before mapping its pins.</p>}
            {ports.map(({ id, name }) => (
              <label key={id}>
                {name}
                <select aria-label={'Map ' + name} value={selected.get(id) ?? ''} onChange={(event) => {
                  setSelected(new Map(selected).set(id, event.target.value));
                }}>
                  <option value="">Unmapped</option>
                  {selected.get(id) && !board.endpoints.has(selected.get(id)) &&
                    <option value={selected.get(id)}>Current mapping unavailable</option>}
                  {[...board.endpoints].map(([key, endpoint]) =>
                    <option key={key} value={key}>
                      {endpoint.reference} · {endpoint.pin} · Pads {endpoint.pads.join(', ')}
                    </option>,
                  )}
                </select>
              </label>
            ))}
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>Cancel</Button>
            <Button appearance="primary" disabled={invalid} onClick={() => onApply(
              ports.flatMap(({ id }) => {
                const endpoint = board.endpoints.get(selected.get(id));
                return endpoint ? [{ portId: id, componentId: endpoint.componentId, signalId: endpoint.signalId }] : [];
              }),
            )}>Apply</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export function SystemConnectionsDialog({ connections, onClose }: {
  connections: SystemConnections;
  onClose(): void;
}) {
  return (
    <Dialog open onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>System connections</DialogTitle>
          <DialogContent style={{ maxHeight: '65vh', overflowY: 'auto' }}>
            {!!connections.problems.length && (
              <ul aria-label="System connection findings">
                {connections.problems.map((message, index) => <li key={index}>{message}</li>)}
              </ul>
            )}
            <ul aria-label="System nets">
              {connections.networks.map(({ id, name, members }) => (
                <li key={id}>
                  <strong>{name}</strong>{members.length === 1 && ' · One board port'}
                  <ul>
                    {members.map(({ instance, name, board, endpoint }, index) => (
                      <li key={index}>
                        {instance} · {name} · {board}
                        {endpoint ? ' · ' + endpoint.reference + ' · ' + endpoint.pin +
                          ' · Pads ' + endpoint.pads.join(', ') + ' · ' + (endpoint.net ?? 'Unassigned on PCB') : ' · Unmapped'}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </DialogContent>
          <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
