import React from 'react';
import type { ProjectDeviceReview } from '../../io/projectDevices';
import type { EmbeddedFootprint } from '../../pcb/boardAssets';
import { updateSymbol } from '../../manipulators/updateSymbol';
import { artworkBounds, FootprintArtwork } from './FootprintArtwork';
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

export function DeviceFootprintPreview({
  footprint,
  selected,
  ruler = false,
  actualSize = false,
}: {
  footprint: EmbeddedFootprint;
  selected: string;
  ruler?: boolean;
  actualSize?: boolean;
}) {
  // Include the actual pad geometry in the viewport, including asymmetric lands.
  const points = footprint.pads.flatMap(({ positionNm, stack }) => {
    const shape =
      stack?.copper.top ??
      stack?.copper.bottom ??
      (stack?.drill && { ...stack.drill, kind: 'capsule' as const });
    const corners =
      shape?.kind === 'polygon'
        ? shape.vertices
        : shape?.kind === 'capsule'
        ? [shape.start, shape.end].flatMap(({ x, y }) => [
            { x: x - shape.widthNm / 2, y: y - shape.widthNm / 2 },
            { x: x + shape.widthNm / 2, y: y + shape.widthNm / 2 },
          ])
        : [{ x: 0, y: 0 }];
    return corners.map(({ x, y }) => ({
      x: x + positionNm.x,
      y: -y - positionNm.y,
    }));
  });
  for (const item of footprint.graphics ?? []) {
    points.push(...artworkBounds(item).map(({ x, y }) => ({ x, y: -y })));
  }
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const { x, y } of points) {
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  const width = Math.max(right - left, ruler ? 10_000_000 : 0);
  const height = bottom - top;
  const margin = Math.max(width, height, 1_000_000) / 8;
  const viewWidth = width + 2 * margin;
  const viewHeight = height + 2 * margin + (ruler ? 2_500_000 : 0);
  return (
    <svg
      role="img"
      aria-label="Footprint pad preview"
      width={actualSize ? viewWidth / 1_000_000 + 'mm' : '100%'}
      height={actualSize ? viewHeight / 1_000_000 + 'mm' : '180'}
      viewBox={`${left - margin} ${top - margin} ${viewWidth} ${viewHeight}`}
    >
      {(footprint.graphics ?? []).map((item, index) => (
        <FootprintArtwork key={index} item={item} />
      ))}
      {footprint.pads.map(({ positionNm, id, label, stack }) => {
        const shape = stack?.copper.top ?? stack?.copper.bottom;
        const colour = selected === id ? '#c24611' : '#225f9d';
        return (
          <g
            key={id}
            transform={`translate(${positionNm.x} ${-positionNm.y})`}
            data-highlighted={selected === id}
          >
            {shape?.kind === 'polygon' ? (
              <polygon
                points={shape.vertices
                  .map(({ x, y }) => `${x},${-y}`)
                  .join(' ')}
                fill={colour}
              />
            ) : shape?.kind === 'capsule' &&
              shape.start.x === shape.end.x &&
              shape.start.y === shape.end.y ? (
              <circle
                cx={shape.start.x}
                cy={-shape.start.y}
                r={shape.widthNm / 2}
                fill={colour}
              />
            ) : shape?.kind === 'capsule' ? (
              <line
                x1={shape.start.x}
                y1={-shape.start.y}
                x2={shape.end.x}
                y2={-shape.end.y}
                stroke={colour}
                strokeWidth={shape.widthNm}
                strokeLinecap="round"
              />
            ) : stack?.drill ? null : (
              <circle r={margin / 4} fill={colour} />
            )}
            {stack?.drill && (
              <line
                x1={stack.drill.start.x}
                y1={-stack.drill.start.y}
                x2={
                  stack.drill.start.x === stack.drill.end.x &&
                  stack.drill.start.y === stack.drill.end.y
                    ? stack.drill.end.x + 1
                    : stack.drill.end.x
                }
                y2={-stack.drill.end.y}
                stroke={shape ? '#fff' : colour}
                strokeWidth={stack.drill.widthNm}
                strokeLinecap="round"
              />
            )}
            <text
              fill={stack?.drill && shape ? colour : '#fff'}
              fontSize={margin * 0.5}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {label}
            </text>
          </g>
        );
      })}
      {ruler && (
        <g transform={`translate(${left} ${bottom + margin / 2 + 550_000})`}>
          <path
            d="M 0 -250000 L 0 250000 M 0 0 L 10000000 0 M 10000000 -250000 L 10000000 250000"
            fill="none"
            stroke="#111"
            strokeWidth="65000"
          />
          <text x="5000000" y="850000" fontSize="450000" textAnchor="middle">
            10 mm
          </text>
        </g>
      )}
    </svg>
  );
}
