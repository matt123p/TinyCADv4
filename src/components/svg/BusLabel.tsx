import React, { FunctionComponent, memo } from 'react';

import { measureText, getFont } from '../../util/measureText';
import TTextEditArea from './TextEditArea';
import { dsnBusLabel } from '../../model/dsnItem';

interface TBusLabelProps {
  dx: number;
  dy: number;
  dr: number;
  scale_x: number;
  scale_y: number;
  data: dsnBusLabel;
  hover: boolean;
  selected: boolean;
  selected_handle: number;
}

const TBusLabel: FunctionComponent<TBusLabelProps> = (
  props: TBusLabelProps,
) => {
  const item = props.data;

  let width = measureText(getFont(item), item.text);

  let active_point = null;
  if (item.rotation === 0) {
    active_point = (
      <line
        x1={(item.point[0] + width - 10) * props.scale_x + props.dx}
        y1={(item.point[1] + 10) * props.scale_y + props.dy}
        x2={(item.point[0] + width + 10) * props.scale_x + props.dx}
        y2={(item.point[1] - 10) * props.scale_y + props.dy}
        style={{
          stroke: 'black',
          strokeWidth: 1,
          fill: 'none',
        }}
      />
    );
  } else {
    active_point = (
      <line
        x1={(item.point[0] - 10) * props.scale_x + props.dx}
        y1={(item.point[1] - width - 10) * props.scale_y + props.dy}
        x2={(item.point[0] + 10) * props.scale_x + props.dx}
        y2={(item.point[1] - width + 10) * props.scale_y + props.dy}
        style={{
          stroke: 'black',
          strokeWidth: 1,
          fill: 'none',
        }}
      />
    );
  }

  return (
    <>
      <TTextEditArea
        dx={props.dx}
        dy={props.dy}
        dr={props.dr}
        scale_x={props.scale_x}
        scale_y={props.scale_y}
        draw-data={item.textData}
        draw-item={item}
        draw-colour={item.font_colour}
        hover={props.hover}
        parent={null}
        selected={props.selected}
        selected_handle={props.selected_handle}
      />
      {active_point}
    </>
  );
};

export default memo(TBusLabel);
