import React, { FunctionComponent, memo } from 'react';

import { measureText, getFont } from '../../util/measureText';
import { UtilityService } from '../../util/utilityService';
import TTextEditArea from './TextEditArea';
import { dsnLabel } from '../../model/dsnItem';

const LABEL_TEXT_CLEARANCE = 3;

interface TLabelProps {
  dx: number;
  dy: number;
  dr: number;
  scale_x: number;
  scale_y: number;
  data: dsnLabel;
  hover: boolean;
  selected: boolean;
  selected_handle: number;
  showConnectionPointMarker: boolean;
  renderOverride?: {
    font_colour?: string;
    font_name?: string;
    font_size?: number;
    font_bold?: boolean;
  };
}

const TLabel: FunctionComponent<TLabelProps> = (props: TLabelProps) => {
  const item = props.data;
  const dx = props.dx ? props.dx : 0;
  const dy = props.dy ? props.dy : 0;
  const dr = props.dr ? props.dr : 0;
  const scale_x = props.scale_x;
  const scale_y = props.scale_y;
  const effectiveItem = props.renderOverride
    ? {
        ...item,
        ...props.renderOverride,
      }
    : item;

  let drawWidth = measureText(getFont(effectiveItem), effectiveItem.text);
  let height = effectiveItem.font_size * 1.5;
  let spacing = height / 5;
  let arrow_distance = height;
  let extra_width = 0;
  switch (effectiveItem.which) {
    case 1: // label_in
    case 2: // label_out
      extra_width += arrow_distance + spacing;
      break;
    case 3: // label_io
      extra_width += arrow_distance * 2;
      break;
  }
  let point = UtilityService.rotateSymCordinate(dr, effectiveItem.point);
  let point_a = [
    point[0] * scale_x + dx,
    (point[1] + height / 2) * scale_y + dy,
  ];
  let point_b = [
    (point[0] + drawWidth + extra_width) * scale_x + dx,
    (point[1] - height / 2) * scale_y + dy,
  ];

  let i_spacing =
    !(effectiveItem.which === 1 || effectiveItem.which === 3)
      ? 0
      : -arrow_distance;
  let o_spacing =
    !(effectiveItem.which === 2 || effectiveItem.which === 3)
      ? 0
      : -arrow_distance;

  let points = '';
  let rotation = UtilityService.rotateRotation(dr, effectiveItem.rotation);

  // Draw the outline
  if (effectiveItem.which !== 0) {
    // Top Line
    points += ' M ' + (point_b[0] + o_spacing) + ' ' + point_b[1];
    points += ' L ' + (point_a[0] - i_spacing) + ' ' + point_b[1];

    // Draw the "input" arrow if this is an input
    if (effectiveItem.which === 1 || effectiveItem.which === 3) {
      points += ' L ' + point_a[0] + ' ' + (point_a[1] - arrow_distance / 2);
      points += ' L ' + (point_a[0] + arrow_distance) + ' ' + point_a[1];
    } else {
      points += ' L ' + point_a[0] + ' ' + point_a[1];
    }

    // Bottom line
    points += ' L ' + (point_b[0] + o_spacing) + ' ' + point_a[1];

    // Draw the "ouput" arrow if this is an input
    if (effectiveItem.which === 2 || effectiveItem.which === 3) {
      points += ' L ' + point_b[0] + ' ' + (point_a[1] - arrow_distance / 2);
    }

    // Close the path
    points += ' Z';

    // We must rotate the rotation to match what TinyCAD.exe does
    switch (rotation) {
      case 0:
        rotation = 2;
        break;
      case 1:
        rotation = 3;
        break;
      case 2:
        rotation = 0;
        break;
      case 3:
        rotation = 1;
        break;
    }
  }

  let textAreaDx = props.dx;
  let textAreaDy = props.dy;
  if (effectiveItem.which === 0) {
    switch (rotation) {
      case 0:
      case 2:
        textAreaDy -= LABEL_TEXT_CLEARANCE;
        break;
      case 1:
        textAreaDx -= LABEL_TEXT_CLEARANCE;
        textAreaDy += LABEL_TEXT_CLEARANCE;
        break;
      case 3:
        textAreaDx -= LABEL_TEXT_CLEARANCE;
        break;
    }
  }

  let transform = '';
  if (rotation !== 0) {
    transform =
      'rotate(' + rotation * 90 + ' ' + point[0] + ' ' + point[1] + ' )';
  }

  return (
    <>
        <TTextEditArea
          dx={textAreaDx}
          dy={textAreaDy}
          dr={props.dr}
          scale_x={props.scale_x}
          scale_y={props.scale_y}
          draw-data={effectiveItem.textData}
          draw-item={effectiveItem}
          draw-colour={effectiveItem.font_colour}
          hover={props.hover}
          parent={null}
          selected={props.selected}
          selected_handle={props.selected_handle}
        />

      {effectiveItem.which !== 0 ? (
        <path
          d={points}
          transform={transform}
          style={{
            stroke: 'black',
            strokeWidth: 1,
            fill: 'none',
          }}
        />
      ) : null}

      {props.selected || !props.showConnectionPointMarker ? null : (
        <rect
          x={(point[0] - 2) * scale_x + dx}
          y={point[1] - 2 + dy}
          width="4"
          height="4"
          style={{
            stroke: 'red',
            strokeWidth: 1,
            fill: 'none',
          }}
        />
      )}
    </>
  );
};

export default memo(TLabel);
