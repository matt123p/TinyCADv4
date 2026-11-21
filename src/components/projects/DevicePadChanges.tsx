import React from 'react';
import type { EmbeddedFootprint } from '../../pcb/boardAssets';
import type { DeviceReview } from '../../pcb/deviceReview';
import { samePoint } from '../../pcb/geometry';

type Pad = EmbeddedFootprint['pads'][number];
const mm = (nm: number) => String(nm / 1_000_000);
const position = ({ x, y }: Pad['positionNm']) => '(' + mm(x) + ', ' + mm(y) + ') mm';

function drill(pad?: Pad) {
  const shape = pad?.stack?.drill;
  if (!shape) return 'None';
  const plating = shape.plated ? 'plated' : 'non-plated';
  if (samePoint(shape.start, shape.end))
    return 'Ø' + mm(shape.widthNm) + ' mm ' + plating + ' hole' +
      (shape.start.x || shape.start.y ? ' at pad-local ' + position(shape.start) : '');
  const length = Math.round(Math.hypot(shape.end.x - shape.start.x, shape.end.y - shape.start.y)) +
    shape.widthNm;
  return mm(shape.widthNm) + ' × ' + mm(length) + ' mm ' + plating + ' slot, pad-local axis ' +
    position(shape.start) + ' to ' + position(shape.end);
}

export function DevicePadChanges({ pads }: { pads: DeviceReview['padChanges'] }) {
  return (
    <ul aria-label="Pad changes">
      {pads.map(({ id, label, changes, before, after, beforeSignal, afterSignal }) => (
        <li key={id}>
          {label} · {changes.join(', ')}
          {beforeSignal !== undefined && (
            <div>Schematic assignment · {beforeSignal} → {afterSignal}</div>
          )}
          {(!before || !after || changes.includes('Position')) && (
            <div>Footprint-local position · {before ? position(before.positionNm) : 'None'} → {after ? position(after.positionNm) : 'None'}</div>
          )}
          {(changes.includes('Drill') ||
            ((!before || !after) && (before?.stack?.drill || after?.stack?.drill))) && (
            <div>Finished opening · {drill(before)} → {drill(after)}</div>
          )}
        </li>
      ))}
    </ul>
  );
}
