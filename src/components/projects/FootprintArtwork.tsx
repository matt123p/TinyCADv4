import React from 'react';
import type { FootprintGraphic } from '../../pcb/footprintDetails';
import { footprintArc } from '../../pcb/footprintArc';
import { footprintTextStrokes } from '../../pcb/footprintText';
import type { BoardPoint } from '../../pcb/geometry';

export function artworkBounds(item: FootprintGraphic): readonly BoardPoint[] {
  switch (item.kind) {
    case 'polygon':
      return item.points;
    case 'line':
    case 'rect':
      return [item.start, item.end];
    case 'text': {
      try {
        const half = item.strokeNm / 2;
        return footprintTextStrokes(item).flatMap((stroke) =>
          stroke.flatMap(({ x, y }) => [
            { x: x - half, y: y - half },
            { x: x + half, y: y + half },
          ]),
        );
      } catch {
        return [item.at];
      }
    }
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
      const shape = footprintArc(item);
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

export function FootprintArtwork({ item, highlighted }: { item: FootprintGraphic; highlighted?: boolean }) {
  const color = highlighted
    ? '#b34b27'
    : item.layer.endsWith('CrtYd')
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
      const shape = footprintArc(item);
      const path = shape
        ? `M ${item.start.x} ${-item.start.y} A ${shape.radius} ${
            shape.radius
          } 0 ${shape.large} ${shape.clockwise} ${item.end.x} ${-item.end.y}`
        : `M ${item.start.x} ${-item.start.y} L ${item.mid.x} ${-item.mid
            .y} L ${item.end.x} ${-item.end.y}`;
      return <path d={path} {...style} fill="none" />;
    }
    case 'text': {
      try {
        const strokes = footprintTextStrokes(item);
        if (!strokes.length) return null;
        const path = strokes
          .map(
            (stroke) =>
              'M ' + stroke.map(({ x, y }) => x + ',' + -y).join(' L '),
          )
          .join(' ');
        return (
          <path
            d={path}
            stroke={color}
            strokeWidth={item.strokeNm}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <title>{item.text}</title>
          </path>
        );
      } catch (error) {
        return (
          <g>
            <title>
              {error instanceof Error ? error.message : String(error)}
            </title>
          </g>
        );
      }
    }
  }
}
