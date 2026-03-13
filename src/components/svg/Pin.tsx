import React, { FunctionComponent, memo } from 'react';

import { UtilityService } from '../../util/utilityService';
import TTextEditArea from './TextEditArea';
import { DocItem, dsnPin } from '../../model/dsnItem';
import { updatePin } from '../../manipulators/updatePin';

interface TPinProps {
  dx: number;
  dy: number;
  dr: number;
  scale_x: number;
  scale_y: number;
  color: string;
  parent: DocItem;
  data: dsnPin;
  hover: boolean;
  selected: boolean;
  selected_handle: number;
}

const TPin: FunctionComponent<TPinProps> = (props: TPinProps) => {
  const item = props.data;

  const dx = props.dx ? props.dx : 0;
  const dy = props.dy ? props.dy : 0;
  const dr = props.dr ? props.dr : 0;
  const scale_x = props.scale_x;
  const scale_y = props.scale_y;

  const update_item = new updatePin(item);
  const dot_size = update_item.dot_size();
  const marker_size = dot_size * 0.8;
  let line_size = update_item.line_size();
  let length = item.length;
  let connect_size = 4;

  const point = UtilityService.rotateSymCordinate(dr, item.point);
  let rotation = UtilityService.rotateRotation(dr, item.rotation);
  let txt_rotation = 0;

  switch (rotation) {
    case 0:
      txt_rotation = 0;
      line_size = length * scale_x - marker_size * 2;
      length = length * scale_x;
      break;
    case 1:
      txt_rotation = 3;
      line_size = length * scale_y - marker_size * 2;
      length = length * scale_y;
      break;
    case 2:
      txt_rotation = 2;
      line_size = length * scale_x - marker_size * 2;
      length = length * scale_x;
      break;
    case 3:
      txt_rotation = 1;
      line_size = length * scale_y - marker_size * 2;
      length = length * scale_y;
      break;
  }

  const pa = [point[0] * scale_x + line_size + dx, point[1] * scale_y + dy];
  const pb = [
    point[0] * scale_x + length + dx,
    point[1] * scale_y - marker_size + dy,
  ];
  const pc = [
    point[0] * scale_x + length + dx,
    point[1] + marker_size * scale_y + 1 + dy,
  ];
  const pd = [point[0] * scale_x + length + dx, point[1] * scale_y + dy];

  let draw_dot = false;
  let draw_line = false;
  let draw_triangle = false;
  let draw_cross = false;
  let draw_no_connect = item.elec === 6;
  let hidden_colour = false;
  let draw_input_low = false;
  let draw_clock_low = false;
  let draw_output_low = false;


  if (draw_no_connect) {
    connect_size = 4;
  }

  switch (item.which) {
    case 1: // Dot
      draw_line = true;
      draw_dot = true;
      break;
    case 2: // Clock
      draw_line = true;
      draw_triangle = true;
      break;
    case 3: // Dot Clock
      draw_line = true;
      draw_dot = true;
      draw_triangle = true;
      break;
    case 4: // Power
      draw_line = true;
      hidden_colour = true;
      break;
    case 5: // Hidden
      draw_line = true;
      hidden_colour = true;
      break;
    case 6: // Cross
      draw_line = false;
      draw_cross = true;
      connect_size = 2;
      break;
    case 7: // Input Low
      draw_line = true;
      draw_input_low = true;
      break;
    case 8: // Clock Low
      draw_line = true;
      draw_triangle = true;
      draw_input_low = true;
      break;
    case 9: // Output Low
      draw_line = true;
      draw_output_low = true;
      break;
    case 10: // Falling Edge Clock
      draw_line = true;
      draw_triangle = true;
      draw_input_low = true;
      break;
    default:
      // Normal
      if (item.length !== 0) {
        draw_line = true;
      } else {
        // zero length pins don't draw a line, just the "hotspot"
        draw_line = false;
      }
      break;
  }

  const pn1 = [
    (point[0] + connect_size) * scale_x + dx,
    (point[1] + connect_size) * scale_y + dy,
  ];
  const pn2 = [
    (point[0] + connect_size) * scale_x + dx,
    (point[1] - connect_size) * scale_y + dy,
  ];
  const pe = draw_line && draw_dot ? pa : pd;

  // Draw the pin symbol
  let circle_x = null;
  if (draw_dot) {
    circle_x = <circle cx={pa[0] + marker_size} cy={pa[1]} r={marker_size} />;
  }

  // Draw the bits that all pins have in common
  let draw_line_x = null;
  if (draw_line) {
    draw_line_x = (
      <line
        x1={point[0] * scale_x + dx}
        y1={point[1] * scale_y + dy}
        x2={pe[0]}
        y2={pe[1]}
        strokeLinecap="round"
      />
    );
  }

  // Draw the clock (triangle)
  let draw_triangle_x = null;
  if (draw_triangle) {
    draw_triangle_x = (
      <polygon
        points={`${pc[0]},${pc[1]} ${pb[0]},${pb[1]} ${
          pd[0] - (pa[0] - pd[0])
        },${pd[1] - (pa[1] - pd[1])}`}
      />
    );
  }

  // If this pin is a cross then draw it!
  let draw_cross_x = null;
  if (draw_cross || draw_no_connect) {
    draw_cross_x = (
      <path
        d={`M${(point[0] - connect_size) * scale_x + dx} ${
          (point[1] - connect_size) * scale_y + dy
        } L${pn1[0]} ${pn1[1]} M${(point[0] - connect_size) * scale_x + dx} ${
          (point[1] + connect_size) * scale_y + dy
        } L${pn2[0]} ${pn2[1]}`}
      />
    );
  }

  // Draw Input Low / Falling Edge Clock indicator (arrow near pin head)
  let draw_input_low_x = null;
  if (draw_input_low) {
    draw_input_low_x = (
      <path
        d={`M${pd[0] - dot_size} ${pd[1]} L${pd[0] - dot_size} ${pd[1] + dot_size} L${pd[0]} ${pd[1]}`}
      />
    );
  }

  // Draw Output Low indicator (diagonal line going downward from pin end)
  let draw_output_low_x = null;
  if (draw_output_low) {
    const olSize = dot_size;
    draw_output_low_x = (
      <path
        d={`M${pd[0]} ${pd[1]} L${pd[0]} ${pd[1] + dot_size} L${pd[0] - dot_size} ${pd[1]}`}
      />
    );
  }


  // Draw Clock Low indicator (short vertical bar descending from triangle base at body boundary)
  let draw_clock_low_x = null;
  if (draw_clock_low) {
    const clSize = dot_size;
    draw_clock_low_x = (
      <line
        x1={pd[0]}
        y1={pd[1]}
        x2={pd[0]}
        y2={pd[1] + clSize}
      />
    );
  }




  let draw_txt1 = null;
  if (item.show_name && item.name !== '') {
    draw_txt1 = (
      <TTextEditArea
        dx={props.dx}
        dy={props.dy}
        dr={props.dr}
        scale_x={props.scale_x}
        scale_y={props.scale_y}
        draw-item={item}
        draw-data={item.textData.name}
        drag-handle={-2}
        draw-colour={item.font_colour}
        parent={props.parent}
        hover={props.hover}
        selected={props.selected}
        selected_handle={props.selected_handle}
      />
    );
  }

  let draw_txt2 = null;
  if (item.show_number && item.number !== '') {
    draw_txt2 = (
      <TTextEditArea
        dx={props.dx}
        dy={props.dy}
        dr={props.dr}
        scale_x={props.scale_x}
        scale_y={props.scale_y}
        draw-item={item}
        draw-data={item.textData.number}
        drag-handle={-2}
        draw-colour={item.font_colour}
        parent={props.parent}
        hover={props.hover}
        selected={props.selected}
        selected_handle={props.selected_handle}
      />
    );
  }

  const outline = (
    <>
      {circle_x}
      {draw_triangle_x}
      {draw_cross_x}
      {draw_input_low_x}
      {draw_clock_low_x}
      {draw_output_low_x}
    </>
  );

  let highlight = props.selected ? (
    <g className="selectedLineHighlight" strokeWidth="4">
      {draw_line_x}
      {outline}
    </g>
  ) : null;

  let selectable = props.hover ? (
    <g className="selectableLineHighlight" strokeWidth="4">
      {draw_line_x}
      {outline}
    </g>
  ) : null;

  return (
    <>
      {draw_txt1}
      {draw_txt2}
      <g
        transform={
          rotation !== 0
            ? 'rotate(' +
              90 * rotation +
              ' ' +
              (point[0] * scale_x + dx) +
              ',' +
              (point[1] * scale_y + dy) +
              ')'
            : ''
        }
      >
        {highlight}
        {selectable}
        {draw_line_x}
        <g style={{ fill: 'none', stroke: 'black', strokeWidth: 1 }}>
          <g style={{ stroke: hidden_colour ? 'blue' : props.color }}>
            {draw_line_x}
          </g>
          <g style={{ strokeWidth: 0.6 }}>
            {outline}
          </g>
        </g>
      </g>
    </>
  );
};

export default memo(TPin);
