import React, { FunctionComponent, memo } from 'react';

import ServerDrawing from './ServerDrawing';
import TTextEditArea from '../src/components/svg/TextEditArea';
import { dsnSymbol } from '../src/model/dsnItem';
import { SheetOptions } from '../src/model/dsnDrawing';
import { updateSymbol } from '../src/manipulators/updateSymbol';

interface ServerSymbolProps {
  dx: number;
  dy: number;
  dr: number;
  data: dsnSymbol;
  options: SheetOptions;
}

const ServerSymbol: FunctionComponent<ServerSymbolProps> = (
  props: ServerSymbolProps,
) => {
  const item = props.data;

  const scope = {
    dx: item.point[0],
    dy: item.point[1],
    dr: item.rotation,
  };

  const updateItem = new updateSymbol(item);
  updateItem.calcRefDelta(scope);

  const text = item.textData
    .filter((entry) => !!entry)
    .map((entry) => (
      <TTextEditArea
        key={entry.textArea.dragHandle}
        dx={0}
        dy={0}
        dr={0}
        scale_x={1}
        scale_y={1}
        draw-item={item}
        draw-data={entry}
        draw-colour={item.font_colour}
        move-handle={entry.textArea.moveHandle}
        parent={item}
        hover={false}
        selected={false}
        selected_handle={-1}
      />
    ));

  const outline = updateItem.outline();

  return (
    <>
      <ServerDrawing
        dx={scope.dx}
        dy={scope.dy}
        dr={scope.dr}
        part={item._symbol.heterogeneous ? 0 : item.part}
        show_power={item.show_power}
        scale_x={item.scale_x}
        scale_y={item.scale_y}
        parent={item}
        heterogeneous={false}
        items={outline.items}
        options={props.options}
      />
      {text}
    </>
  );
};

export default memo(ServerSymbol);
