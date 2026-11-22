import React, { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from '@fluentui/react-components';
import type { BoardDocument, CopperLayer } from '../../pcb/board';
import type {
  BoardZone,
  ZoneConnection,
  ZoneIslands,
} from '../../pcb/boardZones';
import type { Polygon } from '../../pcb/contours';
import { boardInputLength } from './boardNumberInput';
import { outlineText, outlineVertices } from './boardOutlineInput';

const mm = (value: number) => String(value / 1_000_000);
const nm = (value: string) => boardInputLength(value, 'mm');
export default function BoardZoneDialog({
  board,
  zone,
  defaultOutline,
  selectedNet,
  onApply,
  onClose,
}: {
  board: BoardDocument;
  zone?: BoardZone;
  defaultOutline: Polygon;
  selectedNet: string;
  onApply(zone: BoardZone): void;
  onClose(): void;
}) {
  const netId = zone?.netId || selectedNet || board.nets?.[0]?.id || '';
  const [error, setError] = useState('');
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => form.get(name) as string;
    try {
      const clearance = value('clearance').trim();
      const cutouts = value('cutouts').trim();
      onApply({
        id: zone?.id ?? crypto.randomUUID(),
        netId: value('net'),
        layerId: value('layer') as CopperLayer['id'],
        priority: Number(value('priority')),
        outline: outlineVertices(value('outline')),
        cutouts: cutouts
          ? cutouts
              .split(/\r?\n\s*\r?\n/)
              .map((text) => ({ outline: outlineVertices(text) }))
          : [],
        ...(clearance ? { clearanceNm: nm(clearance) } : {}),
        padConnection: value('pads') as ZoneConnection,
        viaConnection: value('vias') as ZoneConnection,
        spokeWidthNm: nm(value('spokes')),
        thermalGapNm: nm(value('gap')),
        islands: value('islands') as ZoneIslands,
      });
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }
  const connections = (
    <>
      <option value="direct">Direct</option>
      <option value="thermal">Thermal relief</option>
      <option value="none">No connection</option>
    </>
  );
  return (
    <Dialog open onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface>
        <form onSubmit={submit}>
          <DialogBody>
            <DialogTitle>
              {zone ? 'Edit copper zone' : 'Add copper zone'}
            </DialogTitle>
            <DialogContent className="pcb-profile-fields">
              <label>
                Net
                <select aria-label="Net" name="net" required defaultValue={netId}>
                  {!board.nets?.some(({ id }) => id === netId) && (
                    <option value="">Choose a current board net</option>
                  )}
                  {board.nets?.map(({ id, name }) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Layer
                <select aria-label="Layer" name="layer" defaultValue={zone?.layerId ?? 'top'}>
                  {board.copperLayers.map(({ id }) => (
                    <option key={id} value={id}>
                      {id === 'top' ? 'Top' : 'Bottom'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priority{' '}
                <input
                  type="number"
                  name="priority"
                  defaultValue={zone?.priority ?? 0}
                  required
                />
              </label>
              <label>
                Outline (X, Y in mm)
                <textarea
                  aria-label="Outline (X, Y in mm)"
                  name="outline"
                  rows={4}
                  defaultValue={outlineText(zone?.outline ?? defaultOutline)}
                  required
                />
              </label>
              <label>
                Cutouts (X, Y in mm, blank line between cutouts)
                <textarea
                  name="cutouts"
                  rows={3}
                  defaultValue={zone?.cutouts
                    .map(({ outline }) => outlineText(outline))
                    .join('\n\n')}
                />
              </label>
              <label>
                Clearance override (mm)
                <input
                  name="clearance"
                  defaultValue={
                    zone?.clearanceNm === undefined ? '' : mm(zone.clearanceNm)
                  }
                />
              </label>
              <label>
                Pads{' '}
                <select
                  aria-label="Pads"
                  name="pads"
                  defaultValue={zone?.padConnection ?? 'direct'}
                >
                  {connections}
                </select>
              </label>
              <label>
                Vias{' '}
                <select
                  aria-label="Vias"
                  name="vias"
                  defaultValue={zone?.viaConnection ?? 'direct'}
                >
                  {connections}
                </select>
              </label>
              <label>
                Thermal spoke width (mm){' '}
                <input
                  name="spokes"
                  defaultValue={mm(zone?.spokeWidthNm ?? 250_000)}
                  required
                />
              </label>
              <label>
                Thermal gap (mm){' '}
                <input
                  name="gap"
                  defaultValue={mm(zone?.thermalGapNm ?? 250_000)}
                  required
                />
              </label>
              <label>
                Disconnected copper
                <select
                  aria-label="Disconnected copper"
                  name="islands"
                  defaultValue={zone?.islands ?? 'remove'}
                >
                  <option value="remove">Remove islands</option>
                  <option value="retain">Retain islands</option>
                  <option value="flag">Retain and flag islands</option>
                </select>
              </label>
              {error && <p role="alert">{error}</p>}
            </DialogContent>
            <DialogActions>
              <Button onClick={onClose}>Cancel</Button>
              <Button appearance="primary" type="submit">
                Apply
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
