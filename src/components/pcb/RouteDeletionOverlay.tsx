import React from 'react';
import { routeDeletionBounds } from '../../pcb/routeDeletion';
import type { BoardTrack, BoardVia } from '../../pcb/boardRouting';
import type { BoardPoint } from '../../pcb/geometry';

export default function RouteDeletionOverlay({
  tracks,
  vias,
  corners,
}: {
  tracks?: readonly BoardTrack[];
  vias?: readonly BoardVia[];
  corners?: readonly [BoardPoint, BoardPoint];
}) {
  const region = corners && routeDeletionBounds(...corners);
  return (
    <g pointerEvents="none" aria-label="Copper deletion selection">
      {region && (
        <rect
          data-deletion-region=""
          x={region.minX}
          y={-region.maxY}
          width={region.maxX - region.minX}
          height={region.maxY - region.minY}
          fill="#9a3754"
          fillOpacity={0.08}
          stroke="#9a3754"
          strokeDasharray="5 4"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {tracks?.map(({ id, start, end, widthNm }, index) => (
        <path
          key={id + ':' + index}
          data-deletion-track={id}
          d={`M${start.x},${-start.y} L${end.x},${-end.y}`}
          fill="none"
          stroke="#bf2d38"
          strokeOpacity={0.82}
          strokeLinecap="round"
          strokeWidth={widthNm}
        />
      ))}
      {vias?.map(({ id, positionNm, diameterNm }) => (
        <circle
          key={id}
          data-deletion-via={id}
          cx={positionNm.x}
          cy={-positionNm.y}
          r={diameterNm / 2}
          fill="#bf2d38"
          fillOpacity={0.45}
          stroke="#bf2d38"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}
