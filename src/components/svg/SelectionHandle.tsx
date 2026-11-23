import React from 'react';

export function SelectionHandle({ x, y, size = 5, offset = 2, ...attributes }:
  Omit<React.SVGProps<SVGRectElement>, 'x' | 'y'> & { x: number; y: number; size?: number; offset?: number }) {
  return <rect data-selection-handle="" x={x - offset} y={y - offset} width={size} height={size}
    fill="none" fillOpacity={0.75} stroke="black" strokeWidth={1} {...attributes} />;
}

export function TextMoveHandle({ size = 5, ...attributes }: React.ComponentProps<typeof SelectionHandle>) {
  return <SelectionHandle size={size} offset={size} {...attributes} />;
}
