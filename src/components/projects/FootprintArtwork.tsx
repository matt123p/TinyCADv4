import React from 'react';
import type { FootprintGraphic } from '../../pcb/footprintDetails';
import { footprintArc } from '../../pcb/footprintArc';
import { footprintTextStrokes } from '../../pcb/footprintText';
import type { BoardPoint } from '../../pcb/geometry';
import { samePoint } from '../../pcb/geometry';
import type { PadShape } from '../../pcb/padstack';
import { svgCircle, svgLength, svgLengthTransform } from '../svg/nanometreSvg';

export function PadShapeDrawing({ shape, colour, attributes, hovered }: {
  shape: PadShape;
  colour: string;
  attributes?: Record<`data-${string}`, string | boolean | undefined>;
  hovered?: boolean;
}) {
  const draw = (outline: boolean) => {
    const props = outline ? { className: 'selectableLineHighlight', strokeWidth: 4, vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' } : attributes;
    if (shape.kind === 'polygon')
      return <polygon points={shape.vertices.map(({ x, y }) => `${x},${-y}`).join(' ')} fill={colour} fillRule="evenodd" {...props} />;
    const { start, end, widthNm } = shape;
    if (samePoint(start, end))
      return <circle {...svgCircle(start.x, -start.y, widthNm / 2)} fill={colour} {...props} />;
    return <line transform={svgLengthTransform}
      x1={svgLength(start.x)} y1={svgLength(-start.y)} x2={svgLength(end.x)} y2={svgLength(-end.y)}
      stroke={colour} strokeWidth={svgLength(widthNm)} strokeLinecap="round" {...props} />;
  };
  return hovered ? <>{draw(false)}{draw(true)}</> : draw(false);
}

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

export const FootprintArtwork = React.memo(function FootprintArtwork({ item, highlighted, layerColor, hoverOutline }: {
  item: FootprintGraphic;
  highlighted?: boolean;
  layerColor?: string;
  hoverOutline?: boolean;
}) {
  const color = highlighted
    ? '#b34b27'
    : layerColor ?? (item.layer.endsWith('CrtYd')
    ? '#8a3e8b'
    : item.layer.endsWith('Fab')
    ? '#686e75'
    : '#236c65');
  const style = {
    stroke: color,
    strokeWidth: item.strokeNm || 80_000,
    fill: item.filled ? color : 'none',
  };
  const outline = hoverOutline ? { className: 'selectableLineHighlight', strokeWidth: 4,
    vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' } : undefined;
  switch (item.kind) {
    case 'line':
      return (
        <line
          transform={svgLengthTransform}
          x1={svgLength(item.start.x)}
          y1={svgLength(-item.start.y)}
          x2={svgLength(item.end.x)}
          y2={svgLength(-item.end.y)}
          {...style}
          strokeWidth={svgLength(style.strokeWidth)}
          {...outline}
        />
      );
    case 'rect':
      return (
        <rect
          transform={svgLengthTransform}
          x={svgLength(Math.min(item.start.x, item.end.x))}
          y={svgLength(-Math.max(item.start.y, item.end.y))}
          width={svgLength(Math.abs(item.start.x - item.end.x))}
          height={svgLength(Math.abs(item.start.y - item.end.y))}
          {...style}
          strokeWidth={svgLength(style.strokeWidth)}
          {...outline}
        />
      );
    case 'circle':
      return (
        <circle
          {...svgCircle(item.center.x, -item.center.y, Math.hypot(item.end.x - item.center.x, item.end.y - item.center.y))}
          {...style}
          strokeWidth={svgLength(style.strokeWidth)}
          {...outline}
        />
      );
    case 'polygon':
      return (
        <polygon
          points={item.points.map(({ x, y }) => `${x},${-y}`).join(' ')}
          {...style}
          {...outline}
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
      return <path d={path} {...style} fill="none" {...outline} />;
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
            {...outline}
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
});
