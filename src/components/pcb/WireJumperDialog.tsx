import { Checkbox, Input, Select } from '@fluentui/react-components';
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
import type { BoardDocument } from '../../pcb/board';
import type { BoardWireJumper } from '../../pcb/boardJumpers';
import type { BoardPoint } from '../../pcb/geometry';
import { boardInputLength } from './boardNumberInput';

export default function WireJumperDialog({
  board,
  jumper,
  onApply,
  onClose,
}: {
  board: BoardDocument;
  jumper?: BoardWireJumper;
  onApply(jumper: BoardWireJumper): void;
  onClose(): void;
}) {
  const [error, setError] = useState('');
  const references = new Set([
    ...(board.components?.map(({ reference }) =>
      reference?.trim().toLowerCase(),
    ) ?? []),
    ...(board.jumpers?.map(({ reference }) => reference.trim().toLowerCase()) ??
      []),
  ]);
  let index = 1;
  while (references.has('jp' + index)) index++;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = (name: string) =>
      boardInputLength(String(form.get(name)), 'mm');
    try {
      onApply({
        id: jumper?.id ?? crypto.randomUUID(),
        reference: String(form.get('reference')).trim(),
        netId: String(form.get('net')),
        start: { x: read('ax'), y: read('ay') },
        end: { x: read('bx'), y: read('by') },
        landWidthNm: read('land'),
        drillNm: read('drill'),
        fitted: form.has('fitted'),
      });
      onClose();
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
    <Dialog open onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface className="pcb-dialog">
        <form onSubmit={submit}>
          <DialogBody>
            <DialogTitle>
              {jumper ? 'Edit wire jumper' : 'Add wire jumper'}
            </DialogTitle>
            <DialogContent className="pcb-profile-fields">
              <p>
                Place two drilled lands on the selected net. Fit the wire on the
                opposite face after etching.
              </p>
              <label>
                Reference
                <Input
                  name="reference"
                  defaultValue={jumper?.reference ?? 'JP' + index}
                  maxLength={64}
                  required
                />
              </label>
              <label>
                Net
                <Select
                  name="net"
                  aria-label="Jumper net"
                  defaultValue={jumper?.netId ?? ''}
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
              {coordinates('a', jumper?.start)}
              {coordinates('b', jumper?.end)}
              <label>
                Land diameter (mm)
                <Input
                  name="land"
                  defaultValue={String((jumper?.landWidthNm ?? 2e6) / 1e6)}
                  required
                />
              </label>
              <label>
                Drill diameter (mm)
                <Input
                  name="drill"
                  defaultValue={String((jumper?.drillNm ?? 800_000) / 1e6)}
                  required
                />
              </label>
              <Checkbox label="Fit jumper" name="fitted" defaultChecked={jumper?.fitted ?? true} />
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
