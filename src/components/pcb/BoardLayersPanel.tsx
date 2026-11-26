import React from 'react';
import { Button, ToggleButton, Tooltip } from '@fluentui/react-components';
import { EyeRegular, EyeOffRegular, LockClosedRegular, LockOpenRegular } from '@fluentui/react-icons';
import { boardLayers } from '../../pcb/boardLayers';
import type { BoardLayerId } from '../../pcb/boardLayers';

export function LayerVisibilityIcon({ visible }: { visible: boolean }) {
  return visible ? <EyeRegular /> : <EyeOffRegular />;
}

export function LayerLockIcon({ locked }: { locked: boolean }) {
  return locked ? <LockClosedRegular /> : <LockOpenRegular />;
}

export function BoardLayersPanel({ layers, hidden, locked, routeLayer, artworkDisabled, onVisibility,
  onLock, onShowAll, onLockAll, onArtwork, onResetVisibility }: {
  layers: readonly (typeof boardLayers)[number][];
  hidden: ReadonlySet<BoardLayerId>;
  locked: ReadonlySet<BoardLayerId>;
  routeLayer?: BoardLayerId;
  artworkDisabled: boolean;
  onVisibility(layer: BoardLayerId, visible: boolean): void;
  onLock(layer: BoardLayerId, locked: boolean): void;
  onShowAll(): void;
  onLockAll(locked: boolean): void;
  onArtwork(): void;
  onResetVisibility(): void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const allLocked = layers.every(({ id }) => locked.has(id));
  const core = ['F.Cu', 'B.Cu', 'F.SilkS', 'B.SilkS', 'Edge.Cuts'];
  const coreLayers = core.flatMap((id) => layers.filter((layer) => layer.id === id));
  const manufacturingLayers = layers.filter(({ id }) => /\.(Adhes|Mask|Paste|Fab)$/.test(id));
  const auxiliaryLayers = layers.filter((layer) => !coreLayers.includes(layer) && !manufacturingLayers.includes(layer));
  function layerRow({ id, label, color }: (typeof boardLayers)[number]) {
    const visible = !hidden.has(id);
    const layerLocked = locked.has(id);
    return <div key={id} className="pcb-layer-row" data-routing-layer={routeLayer === id || undefined}>
      <ToggleButton size="small" appearance="subtle" aria-label={'Show ' + label} title={visible ? 'Hide ' + label : 'Show ' + label}
        checked={visible} icon={<LayerVisibilityIcon visible={visible} />} onClick={() => onVisibility(id, !visible)} />
      <span className="pcb-layer-name"><span className="pcb-layer-swatch" style={{ backgroundColor: color }} />
        {label}{routeLayer === id && <span className="pcb-route-layer-badge">Routing</span>}</span>
      <ToggleButton size="small" appearance="subtle" aria-label={'Lock ' + label} title={layerLocked ? 'Unlock ' + label : 'Lock ' + label}
        checked={layerLocked} icon={<LayerLockIcon locked={layerLocked} />} onClick={() => onLock(id, !layerLocked)} />
    </div>;
  }
  return <section className="pcb-layers-panel" aria-label="Layers" data-expanded={expanded || undefined}>
    <Button className="pcb-layer-toggle" size="small" appearance="subtle" aria-expanded={expanded}
      onClick={() => setExpanded(!expanded)}>Layers</Button>
    <div className="pcb-layer-controls">
    <header className="pcb-layers-heading">
      <h2>Layers</h2>
      <Tooltip content="Show all layers" relationship="description">
        <Button size="small" appearance="subtle" aria-label="Show all layers" icon={<EyeRegular />}
          onClick={onShowAll} disabled={layers.every(({ id }) => !hidden.has(id))} />
      </Tooltip>
      <Tooltip content="Lock all layers" relationship="description">
        <Button size="small" appearance="subtle" aria-label="Lock all layers" icon={<LockClosedRegular />}
          disabled={allLocked} onClick={() => onLockAll(true)} />
      </Tooltip>
      <Tooltip content="Unlock all layers" relationship="description">
        <Button size="small" appearance="subtle" aria-label="Unlock all layers" icon={<LockOpenRegular />}
          disabled={!layers.some(({ id }) => locked.has(id))} onClick={() => onLockAll(false)} />
      </Tooltip>
    </header>
    <div className="pcb-layer-list" role="group" aria-label="Board layers">
      {coreLayers.map(layerRow)}
      {!!manufacturingLayers.length && (
        <details><summary>Manufacturing layers</summary>{manufacturingLayers.map(layerRow)}</details>
      )}
      {!!auxiliaryLayers.length && (
        <details><summary>Auxiliary layers</summary>{auxiliaryLayers.map(layerRow)}</details>
      )}
    </div>
    <Button size="small" disabled={artworkDisabled} onClick={onArtwork}>Edit board artwork…</Button>
    <Button size="small" onClick={onResetVisibility}>Reset to defaults</Button>
    </div>
  </section>;
}
