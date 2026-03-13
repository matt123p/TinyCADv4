import React, { FunctionComponent, memo } from 'react';

import { UtilityService } from '../../util/utilityService';
import { dsnLine } from '../../model/dsnItem';
import { updateLine } from '../../manipulators/updateLine';

interface TLineProps {
  dx: number;
  dy: number;
  dr: number;
  scale_x: number;
  scale_y: number;
  data: dsnLine;
  hover: boolean;
  selected: boolean;
  selected_handle: number;
}

const TLine: FunctionComponent<TLineProps> = (props: TLineProps) => {
  const item = props.data;
  const dx = props.dx ? props.dx : 0;
  const dy = props.dy ? props.dy : 0;
  const dr = props.dr ? props.dr : 0;

  let r = '';
  let controlPoints: number[][] = [];

  const d = item.d_points;
  for (let i = 0; i < d.length; ++i) {
    const control_point = item.d_points[i].length > 2;
    const dp = UtilityService.rotateSymCordinate(dr, d[i]);
    const p = [dp[0] * props.scale_x + dx, dp[1] * props.scale_y + dy];

    if (i === 0) {
      r = r + 'M' + p[0] + ' ' + p[1];
    } else if (control_point) {
      // Accumulate control points
      controlPoints.push(p);
    } else {
      // This is an endpoint — flush any accumulated control points
      if (controlPoints.length === 2) {
        // Cubic Bézier: C cp1x cp1y, cp2x cp2y, ex ey
        r = r + ' C' + controlPoints[0][0] + ' ' + controlPoints[0][1] +
          ' ' + controlPoints[1][0] + ' ' + controlPoints[1][1] +
          ' ' + p[0] + ' ' + p[1];
      } else if (controlPoints.length === 1) {
        // Quadratic Bézier: Q cpx cpy, ex ey
        r = r + ' Q' + controlPoints[0][0] + ' ' + controlPoints[0][1] +
          ' ' + p[0] + ' ' + p[1];
      } else {
        // Straight line
        r = r + ' L' + p[0] + ' ' + p[1];
      }
      controlPoints = [];
    }
  }

  if (item.polygon) {
    // Close the polygon, handling any trailing control points
    const dp0 = UtilityService.rotateSymCordinate(dr, d[0]);
    const p2 = [dp0[0] * props.scale_x + dx, dp0[1] * props.scale_y + dy];
    if (controlPoints.length === 2) {
      r = r + ' C' + controlPoints[0][0] + ' ' + controlPoints[0][1] +
        ' ' + controlPoints[1][0] + ' ' + controlPoints[1][1] +
        ' ' + p2[0] + ' ' + p2[1];
    } else if (controlPoints.length === 1) {
      r = r + ' Q' + controlPoints[0][0] + ' ' + controlPoints[0][1] +
        ' ' + p2[0] + ' ' + p2[1];
    }
    r = r + ' Z';
  }

  const points = r;

  let highlight = props.selected ? (
    <path
      d={points}
      className="selectedLineHighlight"
      strokeWidth={(props.data.line_width + 1.0) * 2}
      strokeLinecap="round"
    />
  ) : null;

  let selectable = props.hover ? (
    <path
      d={points}
      className="selectableLineHighlight"
      strokeWidth={(props.data.line_width + 1.0) * 2}
      strokeLinecap="round"
    />
  ) : null;

  const update_item = new updateLine(item);
  return (
    <>
      <path d={points} style={update_item.style()} strokeLinecap="round" />
      {selectable} {highlight}
    </>
  );
};

export default memo(TLine);
