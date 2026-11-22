import { Button, Checkbox, Input, Select } from '@fluentui/react-components';
import React, { useState } from 'react';
import type { BoardDocument } from '../../pcb/board';
import type { BoardWireJumper } from '../../pcb/boardJumpers';
import type { BoardPoint } from '../../pcb/geometry';
import { boardInputLength } from './boardNumberInput';

export default function WireJumperProperties({
  board,
  jumper,
  onApply,
}: {
  board: BoardDocument;
  jumper: BoardWireJumper;
  onApply(jumper: BoardWireJumper): void;
}) {
  const [error, setError] = useState('');

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = (name: string) =>
      boardInputLength(String(form.get(name)), 'mm');
    try {
      onApply({
        id: jumper.id,
        reference: String(form.get('reference')).trim(),
        netId: String(form.get('net')),
        start: { x: read('ax'), y: read('ay') },
        end: { x: read('bx'), y: read('by') },
        landWidthNm: read('land'),
        drillNm: read('drill'),
        fitted: form.has('fitted'),
      });
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  function coordinates(label: 'a' | 'b', position?: BoardPoint) {
    return (['x', 'y'] as const).map((axis) => (
      <label key={label + axis}>
        {label.toUpperCase()} {axis.toUpperCase()} (mm)
        <Input
          name={label + axis}
          defaultValue={position ? String(position[axis] / 1e6) : ''}
          required
        />
      </label>
    ));
  }

  return (
    <form className="pcb-profile-fields" aria-label="Wire jumper properties" onSubmit={submit}>
    <p>
      Place two drilled lands on the selected net. Fit the wire on the
      opposite face after etching.
    </p>
    <label>
      Reference
      <Input
        name="reference"
        defaultValue={jumper.reference}
        maxLength={64}
        required
      />
    </label>
    <label>
      Net
      <Select
        name="net"
        aria-label="Jumper net"
        defaultValue={jumper.netId ?? ''}
        required
      >
        <option value="">Choose a board net</option>
        {board.nets?.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </Select>
    </label>
    {coordinates('a', jumper.start)}
    {coordinates('b', jumper.end)}
    <label>
      Land diameter (mm)
      <Input
        name="land"
        defaultValue={String((jumper.landWidthNm ?? 2e6) / 1e6)}
        required
      />
    </label>
    <label>
      Drill diameter (mm)
      <Input
        name="drill"
        defaultValue={String((jumper.drillNm ?? 800_000) / 1e6)}
        required
      />
    </label>
    <Checkbox label="Fit jumper" name="fitted" defaultChecked={jumper.fitted ?? true} />
    {error && <p role="alert">{error}</p>}
      <Button appearance="primary" type="submit">Apply</Button>
    </form>
  );
}
