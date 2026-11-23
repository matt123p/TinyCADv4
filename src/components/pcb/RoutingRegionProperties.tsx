import { BoardAreaFields } from './BoardAreaFields';
import { Button, Checkbox, Input, Select } from '@fluentui/react-components';
import React, { useState } from 'react';
import type { BoardDocument } from '../../pcb/board';
import { boardInputLength } from './boardNumberInput';
import { routingRegionKinds } from '../../pcb/routingRegions';
import type { RoutingRegion } from '../../pcb/routingRegions';
import { areaFields } from './boardOutlineInput';

export default function RoutingRegionProperties({ board, region, onApply }: {
  board: BoardDocument;
  region: RoutingRegion;
  onApply(region: RoutingRegion): void;
}) {
  const [error, setError] = useState('');

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? '').trim();
    const classId = value('classId');
    const minWidth = value('minWidth');
    const maxWidth = value('maxWidth');
    const clearance = value('clearance');
    try {
      onApply({
        id: region.id,
        name: value('name'),
        side: value('side') as RoutingRegion['side'],
        ...(classId ? { classId } : {}),
        ...areaFields(form, region.shape),
        exclusions: routingRegionKinds.filter((kind) => form.has(kind)),
        ...(minWidth ? { minWidthNm: boardInputLength(minWidth, 'mm') } : {}),
        ...(maxWidth ? { maxWidthNm: boardInputLength(maxWidth, 'mm') } : {}),
        ...(clearance ? { clearanceNm: boardInputLength(clearance, 'mm') } : {}),
      });
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  return (
    <form className="pcb-profile-fields" aria-label="Routing region properties" onSubmit={submit}>
    <label>Name <Input name="name" required maxLength={128} defaultValue={region.name} /></label>
    <label>
      Copper layers
      <Select name="side" aria-label="Copper layers" defaultValue={region.side ?? 'both'}>
        <option value="both">Both layers</option>
        <option value="top">Top</option>
        <option value="bottom">Bottom</option>
      </Select>
    </label>
    <label>
      Net class
      <Select name="classId" aria-label="Net class" defaultValue={region.classId ?? ''}>
        <option value="">Any class</option>
        <option value="default">No assigned class</option>
        {board.netClasses?.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
      </Select>
    </label>
    <BoardAreaFields shape={region.shape} outline={region.outline} />
    <fieldset>
      <legend>Exclude copper</legend>
      {routingRegionKinds.map((kind) => (
        <label key={kind}>
          <span>Exclude {kind}s</span>
          <Checkbox name={kind}  defaultChecked={region.exclusions.includes(kind)} />
        </label>
      ))}
    </fieldset>
    <label>
      Minimum track width (mm)
      <Input name="minWidth" defaultValue={region.minWidthNm === undefined ? '' : String(region.minWidthNm / 1e6)} />
    </label>
    <label>
      Maximum track width (mm)
      <Input name="maxWidth" defaultValue={region.maxWidthNm === undefined ? '' : String(region.maxWidthNm / 1e6)} />
    </label>
    <label>
      Copper clearance (mm)
      <Input name="clearance" defaultValue={region.clearanceNm === undefined ? '' : String(region.clearanceNm / 1e6)} />
    </label>
    {error && <p role="alert">{error}</p>}
      <Button appearance="primary" type="submit">Apply</Button>
    </form>
  );
}
