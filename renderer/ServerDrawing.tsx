import React, { FunctionComponent, memo } from 'react';

import TBusLabel from '../src/components/svg/BusLabel';
import TBusSlash from '../src/components/svg/BusSlash';
import TBusWire from '../src/components/svg/BusWire';
import TEllipse from '../src/components/svg/Ellipse';
import TJunction from '../src/components/svg/Junction';
import TLabel from '../src/components/svg/Label';
import TLine from '../src/components/svg/Line';
import TNoConnect from '../src/components/svg/NoConnect';
import TPower from '../src/components/svg/Power';
import TPin from '../src/components/svg/Pin';
import TRectangle from '../src/components/svg/Rectangle';
import TText from '../src/components/svg/Text';
import TWire from '../src/components/svg/Wire';
import TImage from '../src/components/svg/Image';
import { DocItem, dsnSymbol } from '../src/model/dsnItem';
import { SheetOptions } from '../src/model/dsnDrawing';
import { updatePin } from '../src/manipulators/updatePin';
import ServerSymbol from './ServerSymbol';

interface ServerDrawingProps {
  dx: number;
  dy: number;
  dr: number;
  scale_x: number;
  scale_y: number;
  part: number;
  show_power: boolean;
  heterogeneous: boolean;
  parent: dsnSymbol | null;
  items: DocItem[];
  options: SheetOptions;
}

const ServerDrawing: FunctionComponent<ServerDrawingProps> = (
  props: ServerDrawingProps,
) => {
  const dx = props.dx || 0;
  const dy = props.dy || 0;
  const dr = props.dr || 0;
  let scaleX = props.scale_x;
  let scaleY = props.scale_y;

  if (dr === 1 || dr === 3) {
    const swap = scaleX;
    scaleX = scaleY;
    scaleY = swap;
  }

  const part = props.part || 0;
  const showPower = !!props.show_power;

  return (
    <>
      {props.items.map((item) => {
        switch (item.NodeName) {
          case 'buslabel':
            return (
              <TBusLabel
                key={item._id}
                data={item}
                dx={dx}
                dy={dy}
                dr={dr}
                scale_x={scaleX}
                scale_y={scaleY}
                hover={false}
                selected={false}
                selected_handle={-1}
              />
            );
          case 'busslash':
            return (
              <TBusSlash
                key={item._id}
                data={item}
                dx={dx}
                dy={dy}
                dr={dr}
                scale_x={scaleX}
                scale_y={scaleY}
                hover={false}
                selected={false}
              />
            );
          case 'buswire':
            return (
              <TBusWire
                key={item._id}
                data={item}
                dx={dx}
                dy={dy}
                dr={dr}
                scale_x={scaleX}
                scale_y={scaleY}
                color={props.options.color_bus}
                hover={false}
                selected={false}
              />
            );
          case 'ellipse':
            return (
              <TEllipse
                key={item._id}
                data={item}
                dx={dx}
                dy={dy}
                dr={dr}
                scale_x={scaleX}
                scale_y={scaleY}
                hover={false}
                selected={false}
                selected_handle={-1}
              />
            );
          case 'junction':
            return (
              <TJunction
                key={item._id}
                data={item}
                dx={dx}
                dy={dy}
                dr={dr}
                scale_x={scaleX}
                scale_y={scaleY}
                color={props.options.color_junction}
              />
            );
          case 'label':
            return (
              <TLabel
                key={item._id}
                data={item}
                dx={dx}
                dy={dy}
                dr={dr}
                scale_x={scaleX}
                scale_y={scaleY}
                hover={false}
                selected={false}
                selected_handle={-1}
                showConnectionPointMarker={props.options.show_label_connection_point}
              />
            );
          case 'line':
            return (
              <TLine
                key={item._id}
                data={item}
                dx={dx}
                dy={dy}
                dr={dr}
                scale_x={scaleX}
                scale_y={scaleY}
                hover={false}
                selected={false}
                selected_handle={-1}
              />
            );
          case 'noconnect':
            return (
              <TNoConnect
                key={item._id}
                data={item}
                dx={dx}
                dy={dy}
                dr={dr}
                scale_x={scaleX}
                scale_y={scaleY}
                color={props.options.color_noconnect}
                hover={false}
                selected={false}
                selected_handle={-1}
              />
            );
          case 'pin': {
            const updateItem = new updatePin(item);
            return item.part === part &&
              updateItem.shown(showPower, false, props.heterogeneous) ? (
              <TPin
                key={item._id}
                data={item}
                dx={dx}
                dy={dy}
                dr={dr}
                scale_x={scaleX}
                scale_y={scaleY}
                color={props.options.color_pin}
                parent={props.parent ?? item}
                hover={false}
                selected={false}
                selected_handle={-1}
              />
            ) : null;
          }
          case 'power':
            return (
              <TPower
                key={item._id}
                data={item}
                dx={dx}
                dy={dy}
                dr={dr}
                scale_x={scaleX}
                scale_y={scaleY}
                color={props.options.color_power}
                parent={props.parent ?? item}
                hover={false}
                selected={false}
                selected_handle={-1}
              />
            );
          case 'image':
            return (
              <TImage
                key={item._id}
                data={item}
                dx={dx}
                dy={dy}
                dr={dr}
                scale_x={scaleX}
                scale_y={scaleY}
                hover={false}
                selected={false}
                selected_handle={-1}
              />
            );
          case 'rectangle':
            return (
              <TRectangle
                key={item._id}
                data={item}
                dx={dx}
                dy={dy}
                dr={dr}
                scale_x={scaleX}
                scale_y={scaleY}
                hover={false}
                selected={false}
                selected_handle={-1}
              />
            );
          case 'symbol':
            return (
              <ServerSymbol
                key={item._id}
                data={item}
                dx={dx}
                dy={dy}
                dr={dr}
                options={props.options}
              />
            );
          case 'text':
            return (
              <TText
                key={item._id}
                data={item}
                dx={dx}
                dy={dy}
                dr={dr}
                scale_x={scaleX}
                scale_y={scaleY}
                parent={props.parent ?? item}
                hover={false}
                selected={false}
                selected_handle={-1}
              />
            );
          case 'wire':
            return (
              <TWire
                key={item._id}
                data={item}
                dx={dx}
                dy={dy}
                dr={dr}
                scale_x={scaleX}
                scale_y={scaleY}
                color={props.options.color_wire}
                lineWidth={1}
                hover={false}
                selected={false}
                selected_handle={-1}
              />
            );
          case 'ruler':
          default:
            return null;
        }
      })}
    </>
  );
};

export default memo(ServerDrawing);
