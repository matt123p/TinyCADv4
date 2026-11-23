import { BoardAreaFields } from './BoardAreaFields';
import { Button, Input, Select, Textarea } from '@fluentui/react-components';
import React, { useState } from 'react';
import type { BoardDocument, CopperLayer } from '../../pcb/board';
import type {
  BoardZone,
  ZoneConnection,
  ZoneIslands,
} from '../../pcb/boardZones';
import { boardInputLength } from './boardNumberInput';
import { areaFields, outlineText, outlineVertices } from './boardOutlineInput';

const mm = (value: number) => String(value / 1_000_000);
const nm = (value: string) => boardInputLength(value, 'mm');
export default function BoardZoneProperties({
  board,
  zone,
  onApply,
}: {
  board: BoardDocument;
  zone: BoardZone;
  onApply(zone: BoardZone): void;
}) {
  const netId = zone.netId;
  const [error, setError] = useState('');
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => form.get(name) as string;
    try {
      const clearance = value('clearance').trim();
      const cutouts = value('cutouts').trim();
      onApply({
        id: zone.id,
        netId: value('net'),
        layerId: value('layer') as CopperLayer['id'],
        priority: Number(value('priority')),
        ...areaFields(form, zone.shape),
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
      setError('');
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
    <form className="pcb-profile-fields" aria-label="Copper zone properties" onSubmit={submit}>
    <label>
      Net
      <Select aria-label="Net" name="net" required defaultValue={netId}>
        {!board.nets?.some(({ id }) => id === netId) && (
          <option value="">Choose a current board net</option>
        )}
        {board.nets?.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </Select>
    </label>
    <label>
      Layer
      <Select aria-label="Layer" name="layer" defaultValue={zone.layerId ?? 'top'}>
        {board.copperLayers.map(({ id }) => (
          <option key={id} value={id}>
            {id === 'top' ? 'Top' : 'Bottom'}
          </option>
        ))}
      </Select>
    </label>
    <label>
      Priority{' '}
      <Input
        type="number"
        name="priority"
        defaultValue={String(zone.priority ?? 0)}
        required
      />
    </label>
    <BoardAreaFields shape={zone.shape} outline={zone.outline} />
    <label>
      Cutouts (X, Y in mm, blank line between cutouts)
      <Textarea
        name="cutouts"
        rows={3}
        defaultValue={zone.cutouts
          .map(({ outline }) => outlineText(outline))
          .join('\n\n')}
      />
    </label>
    <label>
      Clearance override (mm)
      <Input
        name="clearance"
        defaultValue={
          zone.clearanceNm === undefined ? '' : mm(zone.clearanceNm)
        }
      />
    </label>
    <label>
      Pads{' '}
      <Select
        aria-label="Pads"
        name="pads"
        defaultValue={zone.padConnection ?? 'direct'}
      >
        {connections}
      </Select>
    </label>
    <label>
      Vias{' '}
      <Select
        aria-label="Vias"
        name="vias"
        defaultValue={zone.viaConnection ?? 'direct'}
      >
        {connections}
      </Select>
    </label>
    <label>
      Thermal spoke width (mm){' '}
      <Input
        name="spokes"
        defaultValue={mm(zone.spokeWidthNm ?? 250_000)}
        required
      />
    </label>
    <label>
      Thermal gap (mm){' '}
      <Input
        name="gap"
        defaultValue={mm(zone.thermalGapNm ?? 250_000)}
        required
      />
    </label>
    <label>
      Disconnected copper
      <Select
        aria-label="Disconnected copper"
        name="islands"
        defaultValue={zone.islands ?? 'remove'}
      >
        <option value="remove">Remove islands</option>
        <option value="retain">Retain islands</option>
        <option value="flag">Retain and flag islands</option>
      </Select>
    </label>
    {error && <p role="alert">{error}</p>}
      <Button appearance="primary" type="submit">Apply</Button>
    </form>
  );
}
