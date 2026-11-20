import React from 'react';
import type { FootprintGraphic } from '../../pcb/footprintDetails';
import type { BoardPoint } from '../../pcb/geometry';

function arc(item: Extract<FootprintGraphic, { kind: 'arc' }>) {
  const { start: a, mid: b, end: c } = item;
  const bx = b.x - a.x;
  const by = b.y - a.y;
  const cx = c.x - a.x;
  const cy = c.y - a.y;
  const cross = bx * cy - by * cx;
  if (cross === 0) return undefined;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const center = {
    x: a.x + (b2 * cy - c2 * by) / (2 * cross),
    y: a.y + (bx * c2 - cx * b2) / (2 * cross),
  };
  const angle = (p: BoardPoint) => Math.atan2(p.y - center.y, p.x - center.x);
  const tau = Math.PI * 2;
  const direction = cross > 0 ? 1 : -1;
  const sweep = (direction * (angle(c) - angle(a)) + tau) % tau;
  return {
    center,
    radius: Math.hypot(a.x - center.x, a.y - center.y),
    large: sweep > Math.PI ? 1 : 0,
    clockwise: direction < 0 ? 1 : 0,
  };
}

export function artworkBounds(item: FootprintGraphic): readonly BoardPoint[] {
  switch (item.kind) {
    case 'polygon':
      return item.points;
    case 'line':
    case 'rect':
      return [item.start, item.end];
    case 'text':
      return [item.at];
    case 'circle': {
      const radius = Math.hypot(
        item.end.x - item.center.x,
        item.end.y - item.center.y,
      );
      return [
        { x: item.center.x - radius, y: item.center.y - radius },
        { x: item.center.x + radius, y: item.center.y + radius },
      ];
    }
    case 'arc': {
      const shape = arc(item);
      return shape
        ? [
            {
              x: shape.center.x - shape.radius,
              y: shape.center.y - shape.radius,
            },
            {
              x: shape.center.x + shape.radius,
              y: shape.center.y + shape.radius,
            },
          ]
        : [item.start, item.mid, item.end];
    }
  }
}

export function FootprintArtwork({ item }: { item: FootprintGraphic }) {
  const color = item.layer.endsWith('CrtYd')
    ? '#8a3e8b'
    : item.layer.endsWith('Fab')
    ? '#686e75'
    : '#236c65';
  const style = {
    stroke: color,
    strokeWidth: item.strokeNm || 80_000,
    fill: item.filled ? color : 'none',
  };
  switch (item.kind) {
    case 'line':
      return (
        <line
          x1={item.start.x}
          y1={-item.start.y}
          x2={item.end.x}
          y2={-item.end.y}
          {...style}
        />
      );
    case 'rect':
      return (
        <rect
          x={Math.min(item.start.x, item.end.x)}
          y={-Math.max(item.start.y, item.end.y)}
          width={Math.abs(item.start.x - item.end.x)}
          height={Math.abs(item.start.y - item.end.y)}
          {...style}
        />
      );
    case 'circle':
      return (
        <circle
          cx={item.center.x}
          cy={-item.center.y}
          r={Math.hypot(item.end.x - item.center.x, item.end.y - item.center.y)}
          {...style}
        />
      );
    case 'polygon':
      return (
        <polygon
          points={item.points.map(({ x, y }) => `${x},${-y}`).join(' ')}
          {...style}
        />
      );
    case 'arc': {
      const shape = arc(item);
      const path = shape
        ? `M ${item.start.x} ${-item.start.y} A ${shape.radius} ${
            shape.radius
          } 0 ${shape.large} ${shape.clockwise} ${item.end.x} ${-item.end.y}`
        : `M ${item.start.x} ${-item.start.y} L ${item.mid.x} ${-item.mid
            .y} L ${item.end.x} ${-item.end.y}`;
      return <path d={path} {...style} fill="none" />;
    }
    case 'text':
      return item.visible ? (
        <text
          x={item.at.x}
          y={-item.at.y}
          fill={color}
          fontSize={item.sizeNm.y}
          textAnchor={
            item.align.includes('left')
              ? 'start'
              : item.align.includes('right')
              ? 'end'
              : 'middle'
          }
          transform={`rotate(${-item.rotationMicrodegree / 1_000_000} ${
            item.at.x
          } ${-item.at.y})`}
        >
          {item.text}
        </text>
      ) : null;
  }
}
