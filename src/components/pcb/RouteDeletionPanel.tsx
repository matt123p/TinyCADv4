import React from 'react';
import { Button, Input, Select } from '@fluentui/react-components';
import type { CopperLayer } from '../../pcb/board';
import type {
  RouteDeletionPlan,
  RouteDeletionScope,
} from '../../pcb/routeDeletion';

export interface RouteRegionDraft {
  readonly kind: 'region';
  readonly start: { x: string; y: string };
  readonly end: { x: string; y: string };
  readonly layer: CopperLayer['id'] | 'all';
  readonly picking?: 'start' | 'end';
}

export type RouteDeletionDraft =
  | Exclude<RouteDeletionScope, { kind: 'region' }>
  | RouteRegionDraft;

const instructions: Record<RouteDeletionDraft['kind'], string> = {
  item: 'Delete the selected track or via.',
  connection: 'Delete the highlighted run between junctions or terminations.',
  net: 'Delete unlocked tracks and vias on the selected net.',
  region: 'Delete unlocked tracks and vias fully inside the rectangle.',
};

export default function RouteDeletionPanel({
  draft,
  layers,
  plan,
  error,
  busy,
  netName,
  onRegion,
  onCancel,
  onConfirm,
}: {
  draft: RouteDeletionDraft;
  layers: readonly CopperLayer[];
  plan?: RouteDeletionPlan;
  error?: string;
  busy: boolean;
  netName?: string;
  onRegion(draft: RouteRegionDraft): void;
  onCancel(): void;
  onConfirm(): void;
}) {
  const tracks = plan?.tracks.length ?? 0;
  const vias = plan?.vias.length ?? 0;
  return (
    <fieldset aria-label="Copper deletion preview" disabled={busy}>
      <legend>Copper deletion preview</legend>
      <p>
        {draft.kind === 'net' && netName
          ? 'Delete unlocked tracks and vias on ' + netName + '.'
          : instructions[draft.kind]}
      </p>
      {draft.kind === 'region' && (
        <>
          <label>
            Copper selection layer
            <Select
              aria-label="Copper selection layer"
              value={draft.layer}
              onChange={(event) =>
                onRegion({
                  ...draft,
                  layer: event.target.value as RouteRegionDraft['layer'],
                })
              }
            >
              <option value="all">All layers</option>
              {layers.map(({ id }) => (
                <option key={id} value={id}>
                  {id === 'top' ? 'Top' : 'Bottom'}
                </option>
              ))}
            </Select>
          </label>
          {(['start', 'end'] as const).map((corner) => (
            <fieldset key={corner}>
              <legend>
                {corner === 'start' ? 'First corner' : 'Opposite corner'}
              </legend>
              {(['x', 'y'] as const).map((axis) => (
                <label key={axis}>
                  {corner === 'start' ? 'First' : 'Opposite'}{' '}
                  {axis.toUpperCase()} (mm)
                  <Input
                    size="small"
                    value={draft[corner][axis]}
                    onChange={(event) =>
                      onRegion({
                        ...draft,
                        [corner]: {
                          ...draft[corner],
                          [axis]: event.target.value,
                        },
                        picking: undefined,
                      })
                    }
                  />
                </label>
              ))}
            </fieldset>
          ))}
          <Button
            size="small"
            onClick={() =>
              onRegion({
                ...draft,
                start: { x: '', y: '' },
                end: { x: '', y: '' },
                picking: 'start',
              })
            }
          >
            Pick corners on board
          </Button>
          {draft.picking && (
            <p role="status">
              Pick the {draft.picking === 'start' ? 'first' : 'opposite'}{' '}
              corner.
            </p>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {plan && (
        <p role="status">
          {tracks} track {tracks === 1 ? 'segment' : 'segments'} and {vias}{' '}
          {vias === 1 ? 'via' : 'vias'} selected.
          {vias > 0 &&
            draft.kind === 'region' &&
            ' Through-vias span both layers.'}
        </p>
      )}
      <Button onClick={onCancel}>Cancel deletion</Button>
      <Button
        appearance="primary"
        disabled={!tracks && !vias}
        onClick={onConfirm}
      >
        Confirm deletion
      </Button>
    </fieldset>
  );
}
