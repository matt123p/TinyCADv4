import React, { useState } from 'react';
import { Button } from '@fluentui/react-components';
import { footprintPadArray } from '../../pcb/footprintLibrary';
import { boardInputLength } from '../pcb/boardNumberInput';
import type { EmbeddedFootprint } from '../../pcb/boardAssets';

const mm = (nm: number) => (nm / 1_000_000).toFixed(4).replace(/\.?0+$/, '');

export default function FootprintLayoutTools({
  pads,
  selected,
  onChange,
  run,
  busy,
}: {
  pads: EmbeddedFootprint['pads'];
  selected: string;
  onChange(pads: EmbeddedFootprint['pads']): void;
  run(task: () => void): Promise<void>;
  busy: boolean;
}) {
  const [copies, setCopies] = useState('1');
  const [x, setX] = useState('2.54');
  const [y, setY] = useState('0');
  const [measure, setMeasure] = useState('');
  const seed = pads.find(({ id }) => id === selected);
  const other = pads.find(({ id }) => id === measure && id !== selected);
  const distance = other &&
    seed && {
      x: Math.abs(other.positionNm.x - seed.positionNm.x),
      y: Math.abs(other.positionNm.y - seed.positionNm.y),
    };
  if (!seed) return null;

  function align(axis: 'x' | 'y') {
    onChange(
      pads.map((pad) => ({
        ...pad,
        positionNm: { ...pad.positionNm, [axis]: seed.positionNm[axis] },
      })),
    );
  }
  return (
    <fieldset disabled={busy}>
      <legend>Pad layout</legend>
      <p>
        <label>
          Copies{' '}
          <input
            size={4}
            value={copies}
            onChange={(e) => setCopies(e.target.value)}
          />
        </label>{' '}
        <label>
          X spacing (mm){' '}
          <input size={5} value={x} onChange={(e) => setX(e.target.value)} />
        </label>{' '}
        <label>
          Y spacing (mm){' '}
          <input size={5} value={y} onChange={(e) => setY(e.target.value)} />
        </label>{' '}
        <Button
          onClick={(): void => {
            void run(() => {
              const array = footprintPadArray(seed, Number(copies), {
                x: boardInputLength(x, 'mm'),
                y: boardInputLength(y, 'mm'),
              });
              if (array.length + pads.length > 10000)
                throw new Error('Too many footprint pads.');
              onChange([...pads, ...array]);
            });
          }}
        >
          Create pad array
        </Button>
      </p>
      {pads.length > 1 && (
        <p>
          <Button onClick={() => align('y')}>Align pads horizontally</Button>{' '}
          <Button onClick={() => align('x')}>Align pads vertically</Button>{' '}
          <label>
            Measure to pad{' '}
            <select
              value={other?.id ?? ''}
              onChange={(e) => setMeasure(e.target.value)}
            >
              <option value="">Choose a pad</option>
              {pads.map(
                ({ id, label }, index) =>
                  id !== selected && (
                    <option key={id} value={id}>
                      {label} · {index + 1}
                    </option>
                  ),
              )}
            </select>
          </label>
          {distance && (
            <output aria-live="polite">
              {' '}
              X {mm(distance.x)} mm · Y {mm(distance.y)} mm · Distance{' '}
              {mm(Math.hypot(distance.x, distance.y))} mm
            </output>
          )}
        </p>
      )}
    </fieldset>
  );
}
