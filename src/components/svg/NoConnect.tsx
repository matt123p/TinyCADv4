import React, { FunctionComponent, memo } from 'react';

import { UtilityService } from '../../util/utilityService';
import { dsnNoConnect } from '../../model/dsnItem';
import { updateNoConnect } from '../../manipulators/updateNoConnect';

interface TNoConnectProps {
  dx: number;
  dy: number;
  dr: number;
  scale_x: number;
  scale_y: number;
  data: dsnNoConnect;
  color: string;
  hover: boolean;
  selected: boolean;
  selected_handle: number;
}

const TNoConnect: FunctionComponent<TNoConnectProps> = (
  props: TNoConnectProps,
) => {
  const item = props.data;
  const dx = props.dx ? props.dx : 0;
  const dy = props.dy ? props.dy : 0;
  const dr = props.dr ? props.dr : 0;
  const scale_x = props.scale_x;
  const scale_y = props.scale_y;

  const update_item = new updateNoConnect(item);
  const area_a = UtilityService.rotateSymCordinate(dr, update_item.area_a());
  const area_b = UtilityService.rotateSymCordinate(dr, update_item.area_b());

  const points =
    'M ' +
    (area_a[0] * scale_x + dx) +
    ' ' +
    (area_a[1] * scale_y + dy) +
    ' L ' +
    (area_b[0] * scale_x + dx) +
    ' ' +
    (area_b[1] * scale_y + dy) +
    ' M ' +
    (area_b[0] * scale_x + dx) +
    ' ' +
    (area_a[1] * scale_y + dy) +
    ' L ' +
    (area_a[0] * scale_x + dx) +
    ' ' +
    (area_b[1] * scale_y + dy);

  let highlight = props.selected ? (
    <path d={points} className="selectedLineHighlight" strokeWidth="4" />
  ) : null;

  let selectable = props.hover ? (
    <path d={points} className="selectableLineHighlight" strokeWidth="4" />
  ) : null;

  return (
    <>
      {selectable} {highlight}
      <path
        d={points}
        style={{ fill: 'none', stroke: props.color, strokeWidth: 1 }}
        strokeLinecap="round"
      />
    </>
  );
};

export default memo(TNoConnect);
