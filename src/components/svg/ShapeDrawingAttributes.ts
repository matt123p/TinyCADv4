import type { SVGProps } from 'react';

export type ShapeDrawingAttributes = Omit<SVGProps<SVGElement>, 'ref'> & {
  [attribute: `data-${string}`]: string | number;
};
