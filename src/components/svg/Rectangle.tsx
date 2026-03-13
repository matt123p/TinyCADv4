import React, { FunctionComponent, memo } from 'react';

import { UtilityService } from '../../util/utilityService';
import { dsnRectangle } from '../../model/dsnItem';
import { updateRectangle } from '../../manipulators/updateRectangle';

interface TRectangleProps {
  dx: number;
  dy: number;
  dr: number;
  scale_x: number;
  scale_y: number;
  data: dsnRectangle;
  hover: boolean;
  selected: boolean;
  selected_handle: number;
}

const TRectangle: FunctionComponent<TRectangleProps> = (
  props: TRectangleProps,
) => {
  var scope = UtilityService.simpleRefreshPoints(props);
  let r = 0;
  if (props.data.rounded_rect) {
    r = 10;
  }

  let highlight = props.selected ? (
    <rect
      x={scope.x}
      y={scope.y}
      rx={r}
      ry={r}
      width={scope.width}
      height={scope.height}
      className="selectedLineHighlight"
      strokeWidth={(props.data.line_width + 1.0) * 2}
      strokeLinecap="round"
    />
  ) : null;

  let selectable = props.hover ? (
    <rect
      x={scope.x}
      y={scope.y}
      rx={r}
      ry={r}
      width={scope.width}
      height={scope.height}
      className="selectableLineHighlight"
      strokeWidth={(props.data.line_width + 1.0) * 2}
      strokeLinecap="round"
    />
  ) : null;

  const update_item = new updateRectangle(props.data);
  return (
    <>
      <rect
        x={scope.x}
        y={scope.y}
        rx={r}
        ry={r}
        width={scope.width}
        height={scope.height}
        style={update_item.style()}
      />
      {selectable} {highlight}
    </>
  );
};

export default memo(TRectangle);
