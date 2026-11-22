import React, { useState } from 'react';
import { Button } from '@fluentui/react-components';
import type { FootprintModel } from '../../pcb/footprintDetails';
import { validateFootprintDetails } from '../../pcb/footprintDetails';
import { boardCoordinateFields, boardInputLength, canonicalBoardDecimal } from '../pcb/boardNumberInput';

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
    const [x, y, z] = boardCoordinateFields(text, 3);
    return [parse(x), parse(y), parse(z)];
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
                  boardInputLength(value, 'mm');
                const next = {
                  ...model,
                  offsetNm: vector(offset, dimension),
                  rotationMicrodegree: vector(rotation, dimension),
                  scale: vector(scale, (value) => Number(canonicalBoardDecimal(value))),
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
