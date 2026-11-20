import React, { useState } from 'react';
import { Button } from '@fluentui/react-components';
import type { FootprintModel } from '../../pcb/footprintDetails';
import { validateFootprintDetails } from '../../pcb/footprintDetails';
import { lengthInNanometres } from '../../pcb/geometry';

export default function FootprintModelTransformEditor({
  model,
  onChange,
  run,
}: {
  model: FootprintModel;
  onChange(model: FootprintModel): void;
  run(task: () => void): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(
    model.offsetNm.map((n) => String(n / 1_000_000)).join(', '),
  );
  const [rotation, setRotation] = useState(
    model.rotationMicrodegree.map((n) => String(n / 1_000_000)).join(', '),
  );
  const [scale, setScale] = useState(model.scale.join(', '));
  function vector(
    text: string,
    parse: (value: string) => number,
  ): [number, number, number] {
    const parts = text.split(',').map((part) => part.trim());
    if (parts.length !== 3 || parts.some((part) => !part))
      throw new Error('Enter three comma-separated coordinates.');
    return [parse(parts[0]), parse(parts[1]), parse(parts[2])];
  }
  return (
    <div>
      <Button size="small" onClick={() => setOpen(!open)}>
        {open ? 'Hide model transform' : 'Edit model transform'}
      </Button>
      {open && (
        <div>
          <label>
            Offset X,Y,Z (mm){' '}
            <input
              value={offset}
              onChange={(event) => setOffset(event.target.value)}
            />
          </label>{' '}
          <label>
            Rotation X,Y,Z (°){' '}
            <input
              value={rotation}
              onChange={(event) => setRotation(event.target.value)}
            />
          </label>{' '}
          <label>
            Scale X,Y,Z{' '}
            <input
              value={scale}
              onChange={(event) => setScale(event.target.value)}
            />
          </label>{' '}
          <Button
            size="small"
            onClick={(): void => {
              void run(() => {
                const dimension = (value: string) =>
                  lengthInNanometres(value, 'mm');
                const next = {
                  ...model,
                  offsetNm: vector(offset, dimension),
                  rotationMicrodegree: vector(rotation, dimension),
                  scale: vector(scale, Number),
                };
                validateFootprintDetails([], [next]);
                onChange(next);
              });
            }}
          >
            Apply model transform
          </Button>
        </div>
      )}
    </div>
  );
}
