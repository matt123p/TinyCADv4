import React, { useState } from 'react';
import { Button, Select, Textarea } from '@fluentui/react-components';
import { boardLayerById } from '../../pcb/boardLayers';
import type { BoardLayerId } from '../../pcb/boardLayers';
import type { FootprintGraphic } from '../../pcb/footprintDetails';

export type BoardText = Extract<FootprintGraphic, { kind: 'text' }>;
export const boardTextLayers = ['F.SilkS', 'B.SilkS', 'F.Cu', 'B.Cu'] as const;

export function BoardTextEditor({ item, onApply, ...fields }:
  Omit<React.ComponentProps<typeof BoardTextFields>, 'onChange'> & { onApply(item: BoardText): void }) {
  const [draft, setDraft] = useState(item);
  return <form aria-label="Board text properties" onSubmit={(event) => { event.preventDefault(); onApply(draft); }}>
    <BoardTextFields {...fields} item={draft} onChange={setDraft} />
    <Button type="submit" size="small" disabled={!draft.text.trim() || !fields.pickableLayers.has(draft.layer)}>Apply</Button>
  </form>;
}

export function BoardTextFields({ item, layers, pickableLayers, onChange, autoFocus }: {
  item: BoardText;
  layers: readonly BoardText['layer'][];
  pickableLayers: ReadonlySet<BoardLayerId>;
  onChange(next: BoardText): void;
  autoFocus?: boolean;
}) {
  return <div className="pcb-text-fields">
    <label>Text <Textarea size="small" value={item.text} maxLength={128} autoFocus={autoFocus}
      onChange={(_, { value }) => onChange({ ...item, text: value })} /></label>
    <label>Layer <Select size="small" value={item.layer}
      onChange={(event) => {
        const layer = event.target.value as BoardText['layer'];
        const align = item.align.filter((entry) => entry !== 'mirror');
        if (layer.startsWith('B.')) align.push('mirror');
        onChange({ ...item, layer, align });
      }}>
      {(layers.includes(item.layer) ? layers : [item.layer, ...layers]).map((layer) => <option key={layer} value={layer} disabled={!pickableLayers.has(layer)}>
        {boardLayerById.get(layer).label}
      </option>)}
    </Select></label>
  </div>;
}
