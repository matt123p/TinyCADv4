import React, { FunctionComponent, memo } from 'react';
import { dsnJunction } from '../../model/dsnItem';
import { UtilityService } from '../../util/utilityService';

interface TEllipseProps {
  dx: number;
  dy: number;
  dr: number;
  scale_x: number;
  scale_y: number;
  color: string;
  data: dsnJunction;
}

const TJunction: FunctionComponent<TEllipseProps> = (props: TEllipseProps) => {
  const dx = props.dx ? props.dx : 0;
  const dy = props.dy ? props.dy : 0;
  const point = UtilityService.rotateSymCordinate(props.dr, props.data.point);

  return (
    <circle
      cx={point[0] * props.scale_x + dx}
      cy={point[1] * props.scale_y + dy}
      r="5"
      style={{ fill: props.color, stroke: 'none' }}
    />
  );
};

export default memo(TJunction);
