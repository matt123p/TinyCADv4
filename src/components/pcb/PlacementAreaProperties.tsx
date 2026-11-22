import { Button, Input, Select, Textarea } from '@fluentui/react-components';
import React, { useState } from 'react';
import type { PlacementArea } from '../../pcb/placementAreas';
import { outlineText, outlineVertices } from './boardOutlineInput';

export default function PlacementAreaProperties({
  area,
  onApply,
}: {
  area: PlacementArea;
  onApply(area: PlacementArea): void;
}) {
  const [error, setError] = useState('');

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      onApply({
        id: area.id,
        name: String(data.get('name')).trim(),
        kind: data.get('kind') as PlacementArea['kind'],
        side: data.get('side') as PlacementArea['side'],
        outline: outlineVertices(String(data.get('outline'))),
      });
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  return (
    <form className="pcb-profile-fields" aria-label="Placement area properties" onSubmit={submit}>
    <label>
      Name
      <Input
        name="name"
        required
        maxLength={128}
        defaultValue={area.name}
      />
    </label>
    <label>
      Rule
      <Select
        name="kind"
        aria-label="Rule"
        defaultValue={area.kind ?? 'keep-out'}
      >
        <option value="keep-out">Keep out</option>
        <option value="keep-in">Keep in</option>
      </Select>
    </label>
    <label>
      Assembly side
      <Select
        name="side"
        aria-label="Assembly side"
        defaultValue={area.side ?? 'both'}
      >
        <option value="both">Both sides</option>
        <option value="top">Top</option>
        <option value="bottom">Bottom</option>
      </Select>
    </label>
    <label>
      Outline (X, Y in mm)
      <Textarea
        name="outline"
        rows={5}
        required
        defaultValue={outlineText(area.outline)}
      />
    </label>
    {error && <p role="alert">{error}</p>}
      <Button appearance="primary" type="submit">Apply</Button>
    </form>
  );
}
