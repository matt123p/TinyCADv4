import React, { FunctionComponent, memo } from 'react';

import { UtilityService } from '../../util/utilityService';
import { dsnWire } from '../../model/dsnItem';

interface TWireProps {
  dx: number;
  dy: number;
  dr: number;
  scale_x: number;
  scale_y: number;
  data: dsnWire;
  color: string;
  lineWidth?: number;
  hover: boolean;
  selected: boolean;
  selected_handle: number;
}

const TWire: FunctionComponent<TWireProps> = (props: TWireProps) => {
  let r = '';

  let item = props.data;
  let d = props.data.d_points;
  for (let i = 0; i < d.length; ++i) {
    let dp = UtilityService.rotateSymCordinate(props.dr, d[i]);
    let p = [
      dp[0] * props.scale_x + props.dx,
      dp[1] * props.scale_y + props.dy,
    ];
    if (i === 0) {
      r = r + 'M';
    } else {
      r = r + ' L';
    }

    r = r + p[0] + ' ' + p[1];
  }

  let highlight = props.selected ? (
    <path
      d={r}
      className="selectedLineHighlight"
      strokeWidth={2.0 * 2}
      strokeLinecap="round"
    />
  ) : null;

  let selectable = props.hover ? (
    <path
      d={r}
      className="selectableLineHighlight"
      strokeWidth={2.0 * 2}
      strokeLinecap="round"
    />
  ) : null;

  let magnetic = item._magnetic ? (
    <circle
      cx={item._magnetic.point[0]}
      cy={item._magnetic.point[1]}
      r="10"
      style={{
        stroke: 'red',
        strokeWidth: 1,
        fill: 'none',
      }}
    />
  ) : null;

  return (
    <>
      {selectable} {highlight}
      <path
        d={r}
        style={{
          fill: 'none',
          stroke: props.color,
          strokeWidth: props.lineWidth || 1,
        }}
        strokeLinecap="round"
      />
      {magnetic}
    </>
  );
};

export default memo(TWire);
