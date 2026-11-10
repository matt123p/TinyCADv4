import React, { memo, useMemo } from 'react';
import { dsnText } from '../../model/dsnItem';
import { layoutMarkdown } from '../../util/markdown';
interface MarkdownTextProps {
  item: dsnText;
  x: number;
  y: number;
  width: number;
  height: number;
  rotated: boolean;
}
/** Canvas, SVG export and PDF all use these same SVG text and shape elements. */
function MarkdownText({
  item,
  x,
  y,
  width,
  height,
  rotated,
}: MarkdownTextProps) {
  const contentWidth = Math.max(0, rotated ? height : width);
  const contentHeight = Math.max(0, rotated ? width : height);
  const shapes = useMemo(
    () => layoutMarkdown(item.text, item, contentWidth),
    [item, contentWidth],
  );
  const colour = item.font_colour || 'black';
  return (
    <g
      transform={
        rotated
          ? `translate(${x} ${y + height}) rotate(270)`
          : `translate(${x} ${y})`
      }
      style={{ pointerEvents: 'none' }}
    >
      <svg
        width={contentWidth}
        height={contentHeight}
        overflow="hidden"
        data-markdown="true"
      >
        {shapes.map((shape, index) => {
          switch (shape.kind) {
            case 'text':
              return (
                <text
                  key={index}
                  x={shape.x}
                  y={shape.y}
                  fill={colour}
                  fontFamily={item.font_name}
                  fontSize={shape.size}
                  fontWeight={shape.bold ? 'bold' : 'normal'}
                  fontStyle={shape.italic ? 'italic' : 'normal'}
                  xmlSpace="preserve"
                  style={{ whiteSpace: 'pre' }}
                >
                  {shape.value}
                </text>
              );
            case 'line':
              return (
                <line
                  key={index}
                  x1={shape.x1}
                  y1={shape.y1}
                  x2={shape.x2}
                  y2={shape.y2}
                  stroke={colour}
                  strokeWidth={shape.weight}
                />
              );
            case 'bullet':
              return (
                <circle
                  key={index}
                  cx={shape.x}
                  cy={shape.y}
                  r={shape.radius}
                  fill={colour}
                />
              );
            case 'rect':
              return (
                <rect
                  key={index}
                  x={shape.x}
                  y={shape.y}
                  width={shape.width}
                  height={shape.height}
                  fill={shape.shaded ? colour : 'none'}
                  fillOpacity={shape.shaded ? 0.08 : 1}
                  stroke={shape.shaded ? 'none' : colour}
                  strokeWidth={1}
                />
              );
          }
        })}
      </svg>
    </g>
  );
}
export default memo(MarkdownText);
