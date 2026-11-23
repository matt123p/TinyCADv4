import React, { memo } from 'react';

import type { ShapeDrawingAttributes } from './ShapeDrawingAttributes';
import { UtilityService } from '../../util/utilityService';
import { dsnEllipse } from '../../model/dsnItem';
import { updateEllipse } from '../../manipulators/updateEllipse';

interface TEllipseProps {
  dx: number;
  dy: number;
  dr: number;
  scale_x: number;
  scale_y: number;
  data: dsnEllipse;
  hover?: boolean;
  selected?: boolean;
  selected_handle?: number;
  drawingAttributes?: ShapeDrawingAttributes;
  selectionAttributes?: ShapeDrawingAttributes;
}

function TEllipse(props: TEllipseProps) {
  const { x, y, width, height } = UtilityService.simpleRefreshPoints(props);
  const draw = (attributes: ShapeDrawingAttributes) =>
    <ellipse cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} {...attributes} />;
  const outline = (className: string) => draw({ className, strokeWidth: (props.data.line_width + 1) * 2, ...props.selectionAttributes });
  return <>
    {draw(props.drawingAttributes ?? { style: new updateEllipse(props.data).style() })}
    {props.hover && outline('selectableLineHighlight')}
    {props.selected && outline('selectedLineHighlight')}
  </>;
}

export default memo(TEllipse);
