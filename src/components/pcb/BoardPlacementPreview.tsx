import React from 'react';
import { ScaledSvgText } from '../svg/ScaledSvgText';
import type { BoardPoint } from '../../pcb/geometry';
import type { placementPadTemplates } from '../../pcb/boardPlacement';

type PreviewPad = ReturnType<typeof placementPadTemplates>[number];

export default function BoardPlacementPreview({
  origin,
  offsets,
  anchors,
  estimates,
  scale,
  children,
}: {
  origin: BoardPoint;
  offsets: readonly PreviewPad[];
  anchors: ReadonlyMap<string, BoardPoint[]>;
  estimates: boolean;
  scale: number;
  children: React.ReactNode;
}) {
  const pads = offsets.map(({ id, netId, position }) => ({
    id,
    netId,
    x: origin.x + position.x,
    y: origin.y + position.y,
  }));
  const guides = pads.flatMap((pad) => {
    if (!pad.netId) return [];
    let end: BoardPoint | undefined;
    let distanceSquared = Infinity;
    for (const anchor of anchors.get(pad.netId) ?? []) {
      const distance = (pad.x - anchor.x) ** 2 + (pad.y - anchor.y) ** 2;
      if (distance < distanceSquared) {
        end = anchor;
        distanceSquared = distance;
      }
    }
    return end ? [{ start: pad, end, distanceSquared }] : [];
  });

  return (
    <g data-placement-preview="true" pointerEvents="none">
      {guides.map(({ start, end, distanceSquared }) => (
        <g key={start.id}>
          <path
            data-placement-airwire={start.netId}
            d={`M${start.x},${-start.y} L${end.x},${-end.y}`}
            fill="none"
            stroke="#6e39a0"
            strokeWidth={2}
            strokeDasharray="2 5"
            vectorEffect="non-scaling-stroke"
          />
          {estimates && (
            <ScaledSvgText
              x={(start.x + end.x) / 2}
              y={-(start.y + end.y) / 2 - scale * 0.12}
              textAnchor="middle"
              fill="#522383"
              fontSize={scale * 0.24}
              stroke="#fff"
              strokeWidth={scale * 0.045}
              paintOrder="stroke"
            >
              {(Math.sqrt(distanceSquared) / 1_000_000).toFixed(2)} mm
            </ScaledSvgText>
          )}
        </g>
      ))}
      {children}
      <path
        d={`M${origin.x - scale * 0.09},${-origin.y} h${scale * 0.18} M${
          origin.x
        },${-origin.y - scale * 0.09} v${scale * 0.18}`}
        stroke="#6e39a0"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}
