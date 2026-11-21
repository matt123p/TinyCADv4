import React, { useState } from 'react';
import {
  Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
} from '@fluentui/react-components';
import { boardPickKinds } from './BoardCanvas';
import type { BoardPick, BoardPickTarget } from './BoardCanvas';

export default function BoardPickDialog({ pick, onSelect, onClose }: {
  pick: BoardPick;
  onSelect(target: BoardPickTarget): void;
  onClose(): void;
}) {
  const [kind, setKind] = useState<BoardPickTarget['kind'] | 'all'>('all');
  const [layer, setLayer] = useState<'all' | 'top' | 'bottom'>('all');
  const [includeLocked, setIncludeLocked] = useState(false);
  const matches = pick.targets.filter((target) => (kind === 'all' || target.kind === kind) &&
    (layer === 'all' || target.layer === 'both' || target.layer === layer) &&
    (includeLocked || !target.locked));
  return (
    <Dialog open onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Pick overlapping objects</DialogTitle>
          <DialogContent className="pcb-profile-fields">
            <label htmlFor="pcb-pick-type">
              Object type
              <select id="pcb-pick-type" value={kind}
                onChange={(event) => setKind(event.target.value as typeof kind)}>
                <option value="all">All types</option>
                {Object.entries(boardPickKinds).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label htmlFor="pcb-pick-layer">
              Selectable layer
              <select id="pcb-pick-layer" value={layer}
                onChange={(event) => setLayer(event.target.value as typeof layer)}>
                <option value="all">All visible layers</option>
                <option value="top">Top</option>
                <option value="bottom">Bottom</option>
              </select>
            </label>
            <label>
              <input type="checkbox" checked={includeLocked} onChange={(event) => setIncludeLocked(event.target.checked)} />
              Include locked objects
            </label>
            <p role="status">{matches.length} matching objects</p>
            {!!matches.length && (
              <ul aria-label="Objects under pointer">
                {matches.map((target) => (
                  <li key={[target.kind, target.componentId, target.id, target.layer].join(':')}>
                    <Button appearance="subtle" onClick={() => onSelect(target)}>
                      {boardPickKinds[target.kind]} · {target.label} · {target.layer}
                      {target.locked ? ' · Locked' : ''}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </DialogContent>
          <DialogActions><Button onClick={onClose}>Cancel</Button></DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
