import React, { FunctionComponent, memo } from 'react';

import { UtilityService } from '../../util/utilityService';
import { dsnBusSlash } from '../../model/dsnItem';
import { updateBusSlash } from '../../manipulators/updateBusSlash';

interface TBusSlashProps {
  dx: number;
  dy: number;
  dr: number;
  scale_x: number;
  scale_y: number;
  data: dsnBusSlash;
  hover: boolean;
  selected: boolean;
}

const TBusSlash: FunctionComponent<TBusSlashProps> = (
  props: TBusSlashProps,
) => {
  const item = props.data;
  const dx = props.dx ? props.dx : 0;
  const dy = props.dy ? props.dy : 0;
  const dr = props.dr ? props.dr : 0;

  const update_item = new updateBusSlash(item);
  const area_a = UtilityService.rotateSymCordinate(dr, update_item.area_a());
  const area_b = UtilityService.rotateSymCordinate(dr, update_item.area_b());

  const points =
    'M ' +
    (area_a[0] * props.scale_x + dx) +
    ' ' +
    (area_a[1] * props.scale_y + dy) +
    ' L ' +
    (area_b[0] * props.scale_x + dx) +
    ' ' +
    (area_b[1] * props.scale_y + dy);

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
        style={{
          stroke: 'black',
          strokeWidth: 1,
          fill: 'none',
        }}
      />
    </>
  );
};

export default memo(TBusSlash);
