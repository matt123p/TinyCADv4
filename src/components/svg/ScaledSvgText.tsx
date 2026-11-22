import React from 'react';
import { svgTranslation } from './nanometreSvg';

interface ScaledSvgTextProps extends Omit<React.SVGProps<SVGTextElement>, 'x' | 'y' | 'fontSize' | 'strokeWidth'> {
  x?: number;
  y?: number;
  fontSize: number;
  strokeWidth?: number;
}

// PCB drawing coordinates are in nanometres. Keep SVG font sizes within
// the browser's practical glyph size range and apply the scale afterwards.
export function ScaledSvgText({ x = 0, y = 0, fontSize, strokeWidth, ...props }: ScaledSvgTextProps) {
  const scale = 10_000;
  return (
    <g transform={svgTranslation(x, y, scale)}>
      <text {...props} fontSize={fontSize / scale}
        strokeWidth={strokeWidth === undefined ? undefined : strokeWidth / scale} />
    </g>
  );
}
