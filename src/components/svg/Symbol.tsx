import React, { FunctionComponent, memo } from 'react';

import { TDrawing } from './Drawing';
import { UtilityService } from '../../util/utilityService';
import TTextEditArea from './TextEditArea';
import { dsnSymbol } from '../../model/dsnItem';
import { updateSymbol } from '../../manipulators/updateSymbol';

interface TSymbolProps {
  dx: number;
  dy: number;
  dr: number;
  data: dsnSymbol;
  options: any;
  hover: boolean;
  hover_ids?: number[];
  hover_pins?: string[];
  selected: boolean;
  selected_handle: number;
}

const TSymbol: FunctionComponent<TSymbolProps> = (props: TSymbolProps) => {
  const item = props.data;

  var scope = {
    dx: item.point[0],
    dy: item.point[1],
    dr: item.rotation,
  };

  const update_item = new updateSymbol(item);
  update_item.calcRefDelta(scope);

  const text = item.textData
    .filter((t) => !!t)
    .map((t, index) => (
      <TTextEditArea
        key={t.textArea.dragHandle}
        dx={0}
        dy={0}
        dr={0}
        scale_x={1.0}
        scale_y={1.0}
        draw-item={item}
        draw-data={t}
        draw-colour={item.font_colour}
        move-handle={t.textArea.moveHandle}
        parent={item}
        hover={props.hover}
        selected={props.selected}
        selected_handle={props.selected_handle}
      />
    ));

  let dx = scope.dx;
  let dy = scope.dy;

  let outline = update_item.outline();
  const symbolPinPrefix = `${item._id}:`;
  const hoverPinNumbers = (props.hover_pins || [])
    .filter((key) => key.startsWith(symbolPinPrefix))
    .map((key) => key.slice(symbolPinPrefix.length));

  return (
    <>
      <TDrawing
        dx={dx}
        dy={dy}
        dr={scope.dr}
        editLibrary={false}
        heterogeneous={false}
        part={item._symbol.heterogeneous ? 0 : item.part}
        show_power={item.show_power}
        scale_x={item.scale_x}
        scale_y={item.scale_y}
        items={outline.items}
        parent={item}
        hover={props.hover}
        selected={props.selected}
        options={props.options}
        add={null}
        hover_obj={null}
        hover_ids={props.hover_ids}
        hover_pin_numbers={hoverPinNumbers}
        selected_handle={0}
        selection={[]}
      />
      {text}
    </>
  );
};

export default memo(TSymbol);
