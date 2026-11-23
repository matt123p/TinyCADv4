import React, { memo } from 'react';
import { UtilityService } from '../../util/utilityService';
import type { dsnRectangle } from '../../model/dsnItem';
import { updateRectangle } from '../../manipulators/updateRectangle';
import type { ShapeDrawingAttributes } from './ShapeDrawingAttributes';

interface RectangleProps {
  dx: number;
  dy: number;
  dr: number;
  scale_x: number;
  scale_y: number;
  data: dsnRectangle;
  hover?: boolean;
  selected?: boolean;
  selected_handle?: number;
  cornerRadius?: number;
  drawingAttributes?: ShapeDrawingAttributes;
  selectionAttributes?: ShapeDrawingAttributes;
}

function Rectangle(props: RectangleProps) {
  const { x, y, width, height } = UtilityService.simpleRefreshPoints(props);
  const radius = props.cornerRadius ?? (props.data.rounded_rect ? 10 : 0);
  const draw = (attributes: ShapeDrawingAttributes) =>
    <rect x={x} y={y} width={width} height={height} rx={radius} ry={radius} {...attributes} />;
  const outline = (className: string) => draw({ className, strokeWidth: (props.data.line_width + 1) * 2, strokeLinecap: 'round', ...props.selectionAttributes });
  return <>
    {draw(props.drawingAttributes ?? { style: new updateRectangle(props.data).style() })}
    {props.hover && outline('selectableLineHighlight')}
    {props.selected && outline('selectedLineHighlight')}
  </>;
}

export default memo(Rectangle);
