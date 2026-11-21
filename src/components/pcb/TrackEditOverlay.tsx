import React, { useRef } from 'react';
import type { BoardPoint } from '../../pcb/geometry';

export interface TrackEditPreview {
  readonly handle: BoardPoint;
  readonly pieces: readonly {
    start: BoardPoint;
    end: BoardPoint;
    widthNm: number;
  }[];
  readonly radius: number;
  move(x: number, y: number): void;
}

export default function TrackEditOverlay({
  handle,
  pieces,
  radius,
  move,
}: TrackEditPreview) {
  const dragging = useRef<number>();
  return (
    <g aria-label="Track edit preview">
      {pieces.map(({ start, end, widthNm }, index) => (
        <path
          key={index}
          data-track-edit-piece=""
          d={`M${start.x},${-start.y} L${end.x},${-end.y}`}
          fill="none"
          stroke="#335c9c"
          strokeWidth={widthNm}
          strokeLinecap="round"
          opacity={0.68}
          pointerEvents="none"
        />
      ))}
      <circle
        data-track-edit-handle=""
        cx={handle.x}
        cy={-handle.y}
        r={radius}
        fill="#f4f5ff"
        stroke="#335c9c"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        style={{ cursor: 'grab', touchAction: 'none' }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          dragging.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (dragging.current !== event.pointerId) return;
          const matrix = event.currentTarget.ownerSVGElement
            ?.getScreenCTM()
            ?.inverse();
          if (!matrix) return;
          const point = new DOMPoint(
            event.clientX,
            event.clientY,
          ).matrixTransform(matrix);
          move(point.x, point.y);
        }}
        onLostPointerCapture={() => {
          dragging.current = undefined;
        }}
        onClick={(event) => event.stopPropagation()}
      />
    </g>
  );
}
