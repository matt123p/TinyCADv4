import React, { FunctionComponent, memo } from 'react';

import { UtilityService } from '../../util/utilityService';
import { dsnBusWire } from '../../model/dsnItem';

interface TBusWireProps {
  dx: number;
  dy: number;
  dr: number;
  scale_x: number;
  scale_y: number;
  color: string;
  data: dsnBusWire;
  hover: boolean;
  selected: boolean;
}

const TBusWire: FunctionComponent<TBusWireProps> = (props: TBusWireProps) => {
  const item = props.data;
  const dx = props.dx ? props.dx : 0;
  const dy = props.dy ? props.dy : 0;
  const dr = props.dr ? props.dr : 0;

  var r = '';

  var d = item.d_points;
  for (var i = 0; i < d.length; ++i) {
    var dp = UtilityService.rotateSymCordinate(dr, d[i]);
    var p = [dp[0] * props.scale_x + dx, dp[1] * props.scale_y + dy];
    if (i === 0) {
      r = r + 'M';
    } else {
      r = r + ' L';
    }

    r = r + p[0] + ' ' + p[1];
  }

  var points = r;

  let highlight = props.selected ? (
    <path
      d={points}
      className="selectedLineHighlight"
      strokeWidth={(5 + 1.0) * 2}
      strokeLinecap="round"
    />
  ) : null;

  let selectable = props.hover ? (
    <path
      d={points}
      className="selectableLineHighlight"
      strokeWidth={(5 + 1.0) * 2}
      strokeLinecap="round"
    />
  ) : null;

  return (
    <>
      {selectable} {highlight}
      <path
        d={points}
        style={{ fill: 'none', stroke: props.color, strokeWidth: 5 }}
        strokeLinecap="round"
      />
    </>
  );
};

export default memo(TBusWire);
