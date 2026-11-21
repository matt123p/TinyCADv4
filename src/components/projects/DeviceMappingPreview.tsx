import React from 'react';
import type { ProjectDeviceReview } from '../../io/projectDevices';
import { updateSymbol } from '../../manipulators/updateSymbol';
import { TDrawing } from '../svg/Drawing';

export function SchematicTerminalPreview({
  unit,
  pinId,
}: {
  unit: Awaited<ReturnType<ProjectDeviceReview['readUnit']>>;
  pinId: string;
}) {
  const { symbol, options } = unit;
  const { x1, x2, y1, y2 } = new updateSymbol(symbol).getBoundingRect();
  const width = Math.max(x2 - x1 + 60, 100);
  const height = Math.max(y2 - y1 + 60, 100);
  return (
    <svg
      role="img"
      aria-label="Highlighted schematic pin"
      viewBox={`${x1 - 30} ${y1 - 30} ${width} ${height}`}
      width="100%"
      height="180"
    >
      <TDrawing
        dx={0}
        dy={0}
        dr={0}
        part={0}
        show_power={false}
        scale_x={1}
        scale_y={1}
        parent={null}
        editLibrary={false}
        heterogeneous={false}
        items={[symbol]}
        selection={[]}
        selected_handle={-1}
        options={options}
        hover={false}
        hover_obj={null}
        hover_pins={[`${symbol._id}:@${pinId}`]}
        selected={false}
        add={null}
      />
    </svg>
  );
}

export { DeviceFootprintPreview } from './DeviceFootprintPreview';
