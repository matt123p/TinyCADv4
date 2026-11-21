import React, { useState } from 'react';
import { Button } from '@fluentui/react-components';
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
  return (
    <section aria-labelledby="unplaced-components-heading">
      <h3 id="unplaced-components-heading">Unplaced components</h3>
      {parts.length ? (
        <>
          <label>
            Search unplaced components{' '}
            <input
              ref={searchInput}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {results.length ? (
            <ul aria-label="Unplaced components">
              {results.map((part) => {
                const label = part.reference ?? part.id;
                const definition = footprintFor(part);
                return (
                  <li key={part.id}>
                    <input
                      type="checkbox"
                      aria-label={'Queue ' + label + ' for placement'}
                      checked={queued.includes(part.id)}
                      disabled={disabled || sequential || !definition}
                      onChange={() => onToggle(part.id)}
                    />
                    <Button
                      size="small"
                      appearance={part.id === selected ? 'primary' : 'subtle'}
                      aria-pressed={part.id === selected}
                      disabled={disabled || sequential || !definition}
                      onClick={() => onSelect(part.id)}
                    >
                      {label}
                      {part.value ? ' · ' + part.value : ''}
                    </Button>
                    {definition ? (
                      <small>{definition.name}</small>
                    ) : (
                      <small>Needs a reviewed device</small>
                    )}
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
            <Button disabled={disabled || !queued.length} onClick={onStart}>
              Start sequential placement
            </Button>
          )}
          {footprint && (
            <>
              <div className="pcb-footprint-drag" draggable={!disabled && !sequential}
                onDragStart={(event) => {
                  event.dataTransfer.setData(boardPlacementDragType, highlighted.id);
                  event.dataTransfer.effectAllowed = 'copy';
                }}>
                <DeviceFootprintPreview footprint={footprint} selected="" />
              </div>
              {!sequential && <Button disabled={disabled} onClick={() => onPlace(highlighted.id)}>
                Place on board
              </Button>}
            </>
          )}
        </>
      ) : (
        <p>All board components are placed.</p>
      )}
    </section>
  );
}
