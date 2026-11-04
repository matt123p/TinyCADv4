import React, { FunctionComponent, memo } from 'react';

import { UtilityService } from '../../util/utilityService';
import { dsnImage } from '../../model/dsnItem';

interface TImageProps {
  dx: number;
  dy: number;
  dr: number;
  scale_x: number;
  scale_y: number;
  data: dsnImage;
  hover: boolean;
  selected: boolean;
  selected_handle: number;
}

const TImage: FunctionComponent<TImageProps> = (props: TImageProps) => {
  let scope = UtilityService.simpleRefreshPoints(props);

  let highlight = props.selected ? (
    <rect
      x={scope.x}
      y={scope.y}
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
      width={scope.width}
      height={scope.height}
      className="selectableLineHighlight"
      strokeWidth={(props.data.line_width + 1.0) * 2}
      strokeLinecap="round"
    />
  ) : null;

  return (
    <>
      <image
        href={props.data.imageData.imageData}
        preserveAspectRatio="none"
        x={scope.x}
        y={scope.y}
        width={scope.width}
        height={scope.height}
      />
      {selectable} {highlight}
    </>
  );
};

export default memo(TImage);
