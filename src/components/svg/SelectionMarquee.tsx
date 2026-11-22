import React from 'react';

export function SelectionMarquee({ x, y, width, height }: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return <rect data-selection-marquee="" x={x} y={y} width={width} height={height}
    fill="blue" fillOpacity={0.25} stroke="black" strokeWidth={1}
    vectorEffect="non-scaling-stroke" pointerEvents="none" />;
}
