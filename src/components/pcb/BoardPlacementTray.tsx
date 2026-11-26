import React, { useState } from 'react';
import { Button, Checkbox, Input } from '@fluentui/react-components';
import { LibraryDragPreview } from '../libraryPanel/LibraryDragPreview';
import type {
  BoardComponent,
  EmbeddedDevice,
  EmbeddedFootprint,
} from '../../pcb/boardAssets';
import { DeviceFootprintPreview } from '../projects/DeviceFootprintPreview';
import { boardPlacementDragType } from './BoardCanvas';

export default function BoardPlacementTray({
  parts,
  searchInput,
  devices,
  definitions,
  selected,
  queued,
  sequential,
  disabled,
  hasComponents,
  sourceAction,
  sourceDisabled,
  onSource,
  onGuide,
  onSelect,
  onPlace,
  onToggle,
  onStart,
  onStop,
}: {
  parts: readonly BoardComponent[];
  searchInput?: React.Ref<HTMLInputElement>;
  devices: readonly EmbeddedDevice[];
  definitions: readonly EmbeddedFootprint[];
  selected: string;
  queued: readonly string[];
  sequential: boolean;
  disabled: boolean;
  hasComponents: boolean;
  sourceAction: string;
  sourceDisabled: boolean;
  onSource(): void;
  onGuide(button: HTMLButtonElement): void;
  onSelect(id: string): void;
  onPlace(id: string): void;
  onToggle(id: string): void;
  onStart(): void;
  onStop(): void;
}) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const devicesById = new Map(devices.map((part) => [part.id, part]));
  const definitionsById = new Map(definitions.map((part) => [part.id, part]));
  const footprintFor = (part: BoardComponent) =>
    definitionsById.get(devicesById.get(part.deviceId)?.footprintId);
  const results = parts.filter(
    (part) =>
      [
        part.reference,
        part.value,
        devicesById.get(part.deviceId)?.packageName,
        footprintFor(part)?.name,
      ].some((field) => field?.toLowerCase().includes(query) ?? false) ||
      !query,
  );
  const highlighted = parts.find(({ id }) => id === selected);
  const footprint = highlighted && footprintFor(highlighted);
  const first = results.find(footprintFor);
  const missing = parts.some((part) => !footprintFor(part));
  const [showQueue, setShowQueue] = useState(false);
  const showQueueControls = showQueue || sequential;
  return (
    <section className="pcb-placement-tray" aria-labelledby="unplaced-components-heading">
      <h3 id="unplaced-components-heading">
        Unplaced components{parts.length ? ' (' + parts.length + ')' : ''}
      </h3>
      {parts.length ? (
        <>
          <div className="pcb-placement-search">
            <Input
              ref={searchInput}
              value={search}
              size="small"
              placeholder="Search components"
              aria-label="Search unplaced components"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {results.length ? (
            <ul className="pcb-part-list" aria-label="Unplaced components">
              {results.map((part) => {
                const label = part.reference ?? part.id;
                const definition = footprintFor(part);
                return (
                  <li key={part.id}>
                    {showQueueControls && <Checkbox
                      aria-label={'Queue ' + label + ' for placement'}
                      checked={queued.includes(part.id)}
                      disabled={disabled || sequential || !definition}
                      onChange={() => onToggle(part.id)}
                    />}
                    <Button
                      size="small"
                      appearance={part.id === selected ? 'secondary' : 'subtle'}
                      aria-pressed={part.id === selected}
                      disabled={disabled || sequential || !definition}
                      onClick={() => onSelect(part.id)}
                    >
                      <span className="pcb-part-row">
                        <span><strong>{label}</strong>{part.value ? ' · ' + part.value : ''}</span>
                        <small>{definition?.name ?? 'Footprint mapping needed'}</small>
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>No components match this search.</p>
          )}
          {sequential ? (
            <>
              <p role="status">
                {queued.length} remaining · Place{' '}
                {highlighted?.reference ?? 'the selected component'}
              </p>
              <Button disabled={disabled} onClick={onStop}>
                Stop sequential placement
              </Button>
            </>
          ) : (
            <div className="pcb-placement-actions">
              <Button size="small" appearance="subtle" aria-expanded={showQueue}
                disabled={disabled} onClick={() => setShowQueue(!showQueue)}>Batch placement</Button>
              {showQueue && <Button size="small" disabled={disabled || !queued.length} onClick={onStart}>
                Start sequential placement
              </Button>}
            </div>
          )}
          {missing && <Button size="small" disabled={sourceDisabled} onClick={onSource}>Review footprint mappings…</Button>}
          <div className="pcb-placement-preview">
          {footprint ? (
            <>
              <LibraryDragPreview enabled={!disabled && !sequential}
                dataType={boardPlacementDragType} getData={() => highlighted.id} effectAllowed="copy">
                <DeviceFootprintPreview footprint={footprint} selected="" />
              </LibraryDragPreview>
              {!sequential && <Button appearance="primary" disabled={disabled} onClick={() => onPlace(highlighted.id)}>
                Place on board
              </Button>}
            </>
          ) : first && !sequential ? (
            <Button appearance="primary" disabled={disabled} onClick={() => onPlace(first.id)}>Place first component</Button>
          ) : null}
          </div>
        </>
      ) : hasComponents ? (
        <p>All board components are placed.</p>
      ) : (
        <div className="pcb-placement-empty">
          <p>No components yet.</p>
          <Button size="small" appearance="primary" disabled={sourceDisabled} onClick={onSource}>{sourceAction}</Button>
          <Button size="small" appearance="subtle" onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
            onGuide(event.currentTarget)}>First board guide</Button>
        </div>
      )}
    </section>
  );
}
