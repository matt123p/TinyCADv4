import React, { FunctionComponent, memo } from 'react';

import TTextEditArea from './TextEditArea';
import { UtilityService } from '../../util/utilityService';
import { DocItem, dsnText } from '../../model/dsnItem';
import { updateText } from '../../manipulators/updateText';

interface TTextProps {
  dx: number;
  dy: number;
  dr: number;
  scale_x: number;
  scale_y: number;
  parent: DocItem;
  data: dsnText;
  hover: boolean;
  selected: boolean;
  selected_handle: number;
}

const TText: FunctionComponent<TTextProps> = (props: TTextProps) => {
  const item = props.data;
  const scope = UtilityService.simpleRefreshPoints(props);

  let txt_width = scope.width - 6;
  let txt_height = scope.height - 6;
  let txt_point = [scope.x + 3, scope.y + 3];
  switch (scope.txt_rotation) {
    case 1:
    case 3:
      txt_point[1] -= scope.width - scope.height;
      txt_width = scope.width;
      txt_height = scope.height;
      break;
  }

  let r = 0;
  if (item.rounded_rect) {
    r = 10;
  }

  const update_item = new updateText(item);
  return (
    <>
      <rect
        x={scope.x}
        y={scope.y}
        rx={r}
        ry={r}
        width={scope.width}
        height={scope.height}
        style={update_item.style()}
        filter={props.selected ? 'url(#dropshadow)' : null}
      />

      <TTextEditArea
        dx={props.dx}
        dy={props.dy}
        dr={props.dr}
        scale_x={props.scale_x}
        scale_y={props.scale_y}
        draw-item={item}
        draw-data={item.textData}
        drag-handle={-2}
        draw-colour={item.font_colour}
        parent={props.parent}
        hover={props.hover}
        selected={props.selected}
        selected_handle={props.selected_handle}
      />
    </>
  );
  // draw-highlight="selected" draw-selectable="selectable" draw-selected="doc.singleSelectedItem() == item"
};

export default memo(TText);
