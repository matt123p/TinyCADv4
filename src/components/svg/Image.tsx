import React, { FunctionComponent, memo } from 'react';

import { UtilityService } from '../../util/utilityService';
import { dsnImage } from '../../model/dsnItem';
import { imageClip, imagePixelSize } from '../../model/imageProperties';

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
  const [width, height] = imagePixelSize(props.data.imageData);
  const clip = imageClip(props.data);

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
      <svg
        preserveAspectRatio="none"
        x={scope.x}
        y={scope.y}
        width={scope.width}
        height={scope.height}
        viewBox={`${clip.clip_left} ${clip.clip_top} ${width - clip.clip_left - clip.clip_right} ${height - clip.clip_top - clip.clip_bottom}`}
        overflow="hidden"
      >
        <image href={props.data.imageData.imageData} width={width} height={height} preserveAspectRatio="none" />
      </svg>
      {selectable} {highlight}
    </>
  );
};

export default memo(TImage);
