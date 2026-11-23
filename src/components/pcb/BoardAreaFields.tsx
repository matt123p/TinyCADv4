import React from 'react';
import { Input, Textarea } from '@fluentui/react-components';
import type { BoardAreaShape } from '../../pcb/boardAreaShape';
import type { Polygon } from '../../pcb/contours';
import { outlineText } from './boardOutlineInput';

export function BoardAreaFields({ shape, outline }: { shape?: BoardAreaShape; outline: Polygon }) {
  if (shape?.kind === 'rectangle') return <label>
    Corner radius (mm)
    <Input name="radius" required defaultValue={String(shape.radiusNm / 1_000_000)} />
  </label>;
  if (shape) return null;
  return <label>
    Outline (X, Y in mm)
    <Textarea name="outline" rows={5} required defaultValue={outlineText(outline)} />
  </label>;
}
