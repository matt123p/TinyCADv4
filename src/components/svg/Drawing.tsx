import React from 'react';

import { UtilityService } from '../../util/utilityService';
import TBusLabel from './BusLabel';
import TBusSlash from './BusSlash';
import TBusWire from './BusWire';
import TEllipse from './Ellipse';
import TJunction from './Junction';
import TLabel from './Label';
import TLine from './Line';
import TNoConnect from './NoConnect';
import TPower from './Power';
import TPin from './Pin';
import TRectangle from './Rectangle';
import TSymbol from './Symbol';
import TText from './Text';
import TWire from './Wire';
import TImage from './Image';
import TDesignRuler from './DesignRuler';
import { dsnSymbol, DocItem } from '../../model/dsnItem';
import {
  DEFAULT_NETLIST_TYPE_NAME,
  NetlistTypes,
  SheetOptions,
} from '../../model/dsnDrawing';
import { updatePin } from '../../manipulators/updatePin';
import { NetlistData } from '../../io/netlists/netlistGenerator';

interface TDrawingProps {
  dx: number;
  dy: number;
  dr: number;
  part: number;
  show_power: boolean;
  editLibrary: boolean;
  heterogeneous: boolean;
  scale_x: number;
  scale_y: number;
  parent: dsnSymbol;
  items: DocItem[];
  selection: number[];
  selected_handle: number;
  options: SheetOptions;
  hover: boolean;
  hover_obj: DocItem | DocItem[];
  hover_ids?: number[];
  hover_pins?: string[];
  hover_pin_numbers?: string[];
  selected: boolean;
  add: DocItem;
  sheetName?: string;
  netlist?: NetlistData | null;
  netlistTypes?: NetlistTypes;
  netTypeAssignments?: { [net: string]: string };
}

export class TDrawing extends React.PureComponent<TDrawingProps> {
  constructor(props: TDrawingProps) {
    super(props);
  }

  render() {
    const dx = this.props.dx ? this.props.dx : 0;
    const dy = this.props.dy ? this.props.dy : 0;
    const dr = this.props.dr ? this.props.dr : 0;
    let scale_x = this.props.scale_x;
    let scale_y = this.props.scale_y;
    const parent = this.props.parent;

    if (dr == 1 || dr == 3) {
      let h = scale_x;
      scale_x = scale_y;
      scale_y = h;
    }

    const part = this.props.part ? this.props.part : 0;
    const show_power = this.props.show_power ? this.props.show_power : false;
    const editLibrary = this.props.editLibrary ? this.props.editLibrary : false;
    const singleItem = UtilityService.singleSelectedItem(
      this.props.items,
      this.props.selection,
    );

    const itemRenderStyle = new Map<
      number,
      {
        typeName: string;
        wireColor: string | null;
        labelColor: string | null;
        powerColor: string | null;
        wireThickness: number | null;
      }
    >();

    const netlist = this.props.netlist;
    const sheetName = this.props.sheetName;
    const netTypeAssignments = this.props.netTypeAssignments || {};
    const netlistTypes = this.props.netlistTypes || {};
    const getTypeStyle = (typeName: string) => {
      return netlistTypes[typeName] || null;
    };

    if (netlist && sheetName) {
      for (const net in netlist.nets) {
        if (!netlist.nets.hasOwnProperty(net)) {
          continue;
        }

        const assignedTypeName =
          netTypeAssignments[net] || DEFAULT_NETLIST_TYPE_NAME;
        if (assignedTypeName === DEFAULT_NETLIST_TYPE_NAME) {
          continue;
        }

        const style = getTypeStyle(assignedTypeName);
        if (!style) {
          continue;
        }

        const nodes = netlist.nets[net] || [];
        for (let i = 0; i < nodes.length; ++i) {
          const node = nodes[i];
          if (node.sheet !== sheetName || !node.parent) {
            continue;
          }

          const itemId = node.parent._id;
          if (typeof itemId !== 'number') {
            continue;
          }

          if (
            node.parent.NodeName !== 'wire' &&
            node.parent.NodeName !== 'label' &&
            node.parent.NodeName !== 'power'
          ) {
            continue;
          }

          itemRenderStyle.set(itemId, {
            typeName: assignedTypeName,
            wireColor: style.wireColor,
            labelColor: style.labelColor,
            powerColor: style.powerColor,
            wireThickness: style.wireThickness,
          });
        }
      }
    }

    let getItem = (item: DocItem, hover: boolean, selected: boolean) => {
      let selected_handle = null;
      if (singleItem === item) {
        selected_handle = this.props.selected_handle;
      }

      const renderStyle = itemRenderStyle.get(item._id) || null;

      switch (item.NodeName) {
        case 'buslabel':
          return (
            <TBusLabel
              key={item._id}
              data={item}
              dx={dx}
              dy={dy}
              dr={dr}
              scale_x={scale_x}
              scale_y={scale_y}
              hover={hover}
              selected={selected}
              selected_handle={selected_handle}
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
              scale_x={scale_x}
              scale_y={scale_y}
              hover={hover}
              selected={selected}
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
              scale_x={scale_x}
              scale_y={scale_y}
              color={this.props.options.color_bus}
              hover={hover}
              selected={selected}
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
              scale_x={scale_x}
              scale_y={scale_y}
              hover={hover}
              selected={selected}
              selected_handle={selected_handle}
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
              scale_x={scale_x}
              scale_y={scale_y}
              color={this.props.options.color_junction}
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
              scale_x={scale_x}
              scale_y={scale_y}
              hover={hover}
              selected={selected}
              selected_handle={selected_handle}
              showConnectionPointMarker={
                this.props.options.show_label_connection_point
              }
              renderOverride={
                renderStyle
                  ? {
                      ...(renderStyle.labelColor != null
                        ? { font_colour: renderStyle.labelColor }
                        : {}),
                    }
                  : undefined
              }
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
              scale_x={scale_x}
              scale_y={scale_y}
              hover={hover}
              selected={selected}
              selected_handle={selected_handle}
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
              scale_x={scale_x}
              scale_y={scale_y}
              color={this.props.options.color_noconnect}
              hover={hover}
              selected={selected}
              selected_handle={selected_handle}
            />
          );
        case 'pin':
          const update_pin = new updatePin(item);
          return item.part === part &&
            update_pin.shown(
              show_power,
              editLibrary,
              this.props.heterogeneous,
            ) ? (
            <TPin
              key={item._id}
              data={item}
              dx={dx}
              dy={dy}
              dr={dr}
              scale_x={scale_x}
              scale_y={scale_y}
              color={this.props.options.color_pin}
              parent={parent}
              hover={hover}
              selected={selected}
              selected_handle={selected_handle}
            />
          ) : null;
        case 'power':
          return (
            <TPower
              key={item._id}
              data={item}
              dx={dx}
              dy={dy}
              dr={dr}
              scale_x={scale_x}
              scale_y={scale_y}
              color={
                renderStyle && renderStyle.powerColor != null
                  ? renderStyle.powerColor
                  : this.props.options.color_power
              }
              parent={parent}
              hover={hover}
              selected={selected}
              selected_handle={selected_handle}
              renderOverride={
                renderStyle
                  ? {
                      ...(renderStyle.labelColor != null
                        ? { font_colour: renderStyle.labelColor }
                        : {}),
                    }
                  : undefined
              }
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
              scale_x={scale_x}
              scale_y={scale_y}
              hover={hover}
              selected={selected}
              selected_handle={selected_handle}
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
              scale_x={scale_x}
              scale_y={scale_y}
              hover={hover}
              selected={selected}
              selected_handle={selected_handle}
            />
          );
        case 'symbol':
          return (
            <TSymbol
              key={item._id}
              data={item}
              dx={dx}
              dy={dy}
              dr={dr}
              options={this.props.options}
              hover={hover}
              hover_ids={this.props.hover_ids}
              hover_pins={this.props.hover_pins}
              selected={selected}
              selected_handle={selected_handle}
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
              scale_x={scale_x}
              scale_y={scale_y}
              parent={parent}
              hover={hover}
              selected={selected}
              selected_handle={selected_handle}
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
              scale_x={scale_x}
              scale_y={scale_y}
              color={
                renderStyle && renderStyle.wireColor != null
                  ? renderStyle.wireColor
                  : this.props.options.color_wire
              }
              lineWidth={
                renderStyle && renderStyle.wireThickness != null
                  ? renderStyle.wireThickness
                  : 1
              }
              hover={hover}
              selected={selected}
              selected_handle={selected_handle}
            />
          );
        case 'ruler':
          return (
            <TDesignRuler
              key={item._id}
              data={item}
              dx={dx}
              dy={dy}
              dr={dr}
              scale_x={scale_x}
              scale_y={scale_y}
              hover={hover}
              selected={selected}
            />
          );
      }

      return null;
    };

    const hoverIds = new Set<number>();
    const hoverPinNumbers = new Set<string>();
    if (this.props.hover_pin_numbers && this.props.hover_pin_numbers.length > 0) {
      this.props.hover_pin_numbers.forEach((pinNo) => {
        if (pinNo) {
          hoverPinNumbers.add(pinNo);
        }
      });
    }
    if (this.props.hover_ids && this.props.hover_ids.length > 0) {
      this.props.hover_ids.forEach((id) => {
        if (typeof id === 'number') {
          hoverIds.add(id);
        }
      });
    }
    if (Array.isArray(this.props.hover_obj)) {
      this.props.hover_obj.forEach((obj) => {
        if (obj && typeof obj._id === 'number') {
          hoverIds.add(obj._id);
        }
      });
    } else if (this.props.hover_obj && typeof this.props.hover_obj._id === 'number') {
      hoverIds.add(this.props.hover_obj._id);
    }

    let items = this.props.items.map((item, index) => {
      const pinHover =
        item.NodeName === 'pin' && hoverPinNumbers.has((item as any).number);
      let hover = this.props.hover === true || hoverIds.has(item._id) || pinHover;
      let selected =
        this.props.selected ||
        UtilityService.isSelected(this.props.selection, item);
      return getItem(item, hover, selected);
    });

    if (this.props.add) {
      items.push(getItem(this.props.add, false, false));
    }

    const r = <>{items}</>;
    return r;
  }
}
