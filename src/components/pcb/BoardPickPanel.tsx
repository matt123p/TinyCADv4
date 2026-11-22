import { Button, Checkbox, Select } from '@fluentui/react-components';
import React, { useState } from 'react';
import { boardPickKinds } from './BoardCanvas';
import type { BoardPick, BoardPickTarget } from './BoardCanvas';

export default function BoardPickPanel({ pick, onHover, onSelect, onClose }: {
  pick: BoardPick;
  onHover(target?: BoardPickTarget): void;
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
    <section className="pcb-panel-scroll" aria-label="Pick overlapping objects">
      <div className="pcb-panel-actions"><Button onClick={onClose}>Back</Button></div>
      <label htmlFor="pcb-pick-type">
        Object type
        <Select id="pcb-pick-type" value={kind}
          onChange={(event) => setKind(event.target.value as typeof kind)}>
          <option value="all">All types</option>
          {Object.entries(boardPickKinds).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </Select>
      </label>
      <label htmlFor="pcb-pick-layer">
        Selectable layer
        <Select id="pcb-pick-layer" value={layer}
          onChange={(event) => setLayer(event.target.value as typeof layer)}>
          <option value="all">All visible layers</option>
          <option value="top">Top</option>
          <option value="bottom">Bottom</option>
        </Select>
      </label>
      <Checkbox label="Include locked objects" checked={includeLocked} onChange={(_, data) => setIncludeLocked(data.checked === true)} />
      <p role="status">{matches.length} matching objects</p>
      {!!matches.length && (
        <ul aria-label="Objects under pointer">
          {matches.map((target) => (
            <li key={[target.kind, target.componentId, target.id, target.layer].join(':')}>
              <Button appearance="subtle" onClick={() => onSelect(target)}
                onMouseEnter={() => onHover(target)} onMouseLeave={() => onHover()}
                onFocus={() => onHover(target)} onBlur={() => onHover()}>
                {boardPickKinds[target.kind]} · {target.label} · {target.layer}
                {target.locked ? ' · Locked' : ''}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
