import React, { CSSProperties, FunctionComponent, memo } from 'react';

import TTextEditArea from './TextEditArea';
import { DocItem, dsnPower } from '../../model/dsnItem';

interface TPowerProps {
  dx: number;
  dy: number;
  dr: number;
  scale_x: number;
  scale_y: number;
  color: string;
  parent: DocItem;
  data: dsnPower;
  hover: boolean;
  selected: boolean;
  selected_handle: number;
  renderOverride?: {
    font_colour?: string;
    font_name?: string;
    font_size?: number;
    font_bold?: boolean;
  };
}

const TPower: FunctionComponent<TPowerProps> = (props: TPowerProps) => {
  const item = props.data;
  const effectiveItem = props.renderOverride
    ? {
        ...item,
        ...props.renderOverride,
      }
    : item;

  const POWER_SIZE = 14;
  let SPACING;
  if (effectiveItem.which !== 0) {
    SPACING = POWER_SIZE * 2 + POWER_SIZE / 4 + effectiveItem.font_size;
  } else {
    SPACING = POWER_SIZE + POWER_SIZE / 4 + effectiveItem.font_size;
  }

  const pa = [effectiveItem.point[0], effectiveItem.point[1] + POWER_SIZE];
  const pb = [effectiveItem.point[0] - POWER_SIZE / 2, effectiveItem.point[1] + POWER_SIZE];
  const pc = [effectiveItem.point[0] + POWER_SIZE / 2 + 1, effectiveItem.point[1] + POWER_SIZE];
  const pd = [effectiveItem.point[0], effectiveItem.point[1] + POWER_SIZE * 2];

  // Is this power item shown?
  if (effectiveItem._no_show) {
    return null;
  }

  let style: CSSProperties = {
    fill: 'none',
    stroke: props.color,
    strokeWidth: 1,
    strokeLinecap: 'round',
  };

  // Draw the main bar
  var main_bar = (
    <line
      x1={effectiveItem.point[0]}
      y1={effectiveItem.point[1]}
      x2={effectiveItem.point[0]}
      y2={effectiveItem.point[1] + POWER_SIZE}
      style={style}
    />
  );

  var end = null;
  switch (effectiveItem.which) {
    case 0: // Draw the bar
      end = <line x1={pb[0]} y1={pb[1]} x2={pc[0]} y2={pc[1]} style={style} />;
      break;
    case 1: // Draw the circle
      end = (
        <circle
          cx={pa[0]}
          cy={pa[1] + POWER_SIZE / 2}
          r={POWER_SIZE / 2}
          style={style}
        />
      );
      break;
    case 2: // Draw the Wave
      end = (
        <path
          d={`M${pb[0] + (pd[0] - pa[0]) / 2} ${pb[1] + (pd[1] - pa[1]) / 2} C${
            pd[0] + (pb[0] - pa[0]) / 2
          } ${pd[1] + (pb[1] - pa[1]) / 2} ${pa[0] + (pc[0] - pa[0]) / 2} ${
            pa[1] + (pc[1] - pa[1]) / 2
          } ${pc[0] - (pa[0] - pd[0]) / 2} ${pc[1] - (pa[1] - pd[1]) / 2}`}
          style={style}
        />
      );
      break;
    case 3: // Draw the Arrow
      end = (
        <path
          d={`M${pb[0]} ${pb[1]} L${pc[0]} ${pc[1]} M${pb[0]} ${pb[1]} L${pd[0]} ${pd[1]} L${pc[0]} ${pc[1]}`}
          style={style}
        />
      );
      break;
    case 4: // Draw the Earth
      end = (
        <path
          d={`M${pb[0]} ${pb[1]} L${pc[0]} ${pc[1]} M${
            pb[0] - (pb[0] - pd[0]) / 2
          } ${pb[1] - (pb[1] - pd[1]) / 2} L${pc[0] - (pc[0] - pd[0]) / 2} ${
            pc[1] - (pc[1] - pd[1]) / 2
          } M${pd[0] - (pb[0] - pa[0]) / 4} ${pd[1] - (pb[1] - pa[1]) / 4} L${
            pd[0] + (pb[0] - pa[0]) / 4
          } ${pd[1] + (pb[1] - pa[1]) / 4}`}
          style={style}
        />
      );
      break;
  }

  const transform =
    effectiveItem.rotation !== 0
      ? 'rotate(' +
        90 * effectiveItem.rotation +
        ' ' +
        effectiveItem.point[0] +
        ',' +
        effectiveItem.point[1] +
        ')'
      : '';
  let magnetic = effectiveItem._magnetic ? (
    <circle
      cx={effectiveItem._magnetic.point[0]}
      cy={effectiveItem._magnetic.point[1]}
      r="10"
      style={{
        stroke: 'red',
        strokeWidth: 1,
        fill: 'none',
      }}
    />
  ) : null;

  // Draw the power symbol
  var r = (
    <>
      <TTextEditArea
        dx={props.dx}
        dy={props.dy}
        dr={props.dr}
        scale_x={props.scale_x}
        scale_y={props.scale_y}
        draw-item={effectiveItem}
        draw-data={effectiveItem.textData}
        drag-handle={-2}
        draw-colour={effectiveItem.font_colour}
        parent={props.parent}
        hover={props.hover}
        selected={props.selected}
        selected_handle={props.selected_handle}
      />

      <g transform={transform}>
        {main_bar}
        {end}
      </g>
      {magnetic}
    </>
  );

  return r;
};

export default memo(TPower);
