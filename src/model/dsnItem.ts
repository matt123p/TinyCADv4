import { libImage, libSymbol } from './dsnDrawing';
import { TextDisplayMethod } from './tclib';
import { TextAreaData } from './textArea';

export type Coordinate = any[];

export interface MagenticCoordinate {
  point: Coordinate;
  wire: dsnWire;
}

export enum DocItemTypes {
  Invalid = 'invalid',
  BusLabel = 'buslabel',
  BusSlash = 'busslash',
  BusWire = 'buswire',
  Ruler = 'ruler',
  Ellipse = 'ellipse',
  Junction = 'junction',
  Label = 'label',
  Line = 'line',
  NoConnect = 'noconnect',
  Pin = 'pin',
  Power = 'power',
  Rectangle = 'rectangle',
  Symbol = 'symbol',
  Text = 'text',
  Wire = 'wire',
  Image = 'image',
}

export interface Stroked {
  stroked: boolean;
  line_colour: string;
  line_width: number;
  line_pattern: number;
  style_id?: number;
}

export interface Filled {
  filled: boolean;
  fill_colour: string;
  hatch: number;
  rounded_rect?: boolean;
  fill_id?: number;
}

export interface Text {
  font_name: string;
  font_size: number;
  font_bold: boolean;
  font_italic: boolean;
  font_colour?: string;
  font_id?: number;
}

export interface SymbolTextItem {
  position: Coordinate;
  value: string;
  description: string;
  show: boolean;
  display: TextDisplayMethod;
}

export interface dsnBase {
  // What type of object is this?
  NodeName: DocItemTypes;

  // This item's id, this is used
  // to track it through the undo/redo list
  _id: number;
}

export interface dsnPointBase extends dsnBase {
  point: Coordinate;
}

export interface dsnRectBase extends dsnBase, Stroked, Filled {
  point: Coordinate;
  point_b: Coordinate;
}

export interface dsnPointTextBase extends dsnBase, Text {
  point: Coordinate;
  rotation: number;
  text: string;
  textData: TextAreaData;
}

export interface dsnBusLabel extends dsnPointTextBase {
  NodeName: DocItemTypes.BusLabel;
}

export interface dsnBusSlash extends dsnPointBase {
  NodeName: DocItemTypes.BusSlash;
  rotation: number;
}

export interface dsnBusWire extends dsnBase {
  NodeName: DocItemTypes.BusWire;
  d_points: Coordinate[];
}

export interface dsnDesignRuler extends dsnBase {
  NodeName: DocItemTypes.Ruler;
  point: Coordinate;
  rotation: number;
}

export interface dsnEllipse extends dsnRectBase {
  NodeName: DocItemTypes.Ellipse;
}

export interface dsnJunction extends dsnPointBase {
  NodeName: DocItemTypes.Junction;
}

export interface dsnLabel extends dsnPointTextBase {
  NodeName: DocItemTypes.Label;
  rotation: number;
  which: number;
  hints?: dsnSymbolHint[];
}

export interface dsnImage extends dsnRectBase {
  NodeName: DocItemTypes.Image;
  imageData: libImage;
}

export interface dsnLine extends dsnBase, Stroked, Filled {
  NodeName: DocItemTypes.Line;
  polygon: boolean;
  d_points: Coordinate[];
}

export interface dsnNoConnect extends dsnPointBase {
  NodeName: DocItemTypes.NoConnect;
}

export interface PinTextData {
  name: TextAreaData;
  number: TextAreaData;
}

export interface dsnPin extends dsnPointBase, Text {
  NodeName: DocItemTypes.Pin;

  rotation: number;
  name: string;
  number: string;
  length: number;
  number_pos: number;
  centre_name: boolean;
  /**
   * Pin visual shape:
   *  0 = Normal, 1 = Dot, 2 = Clock, 3 = Dot Clock,
   *  4 = Power, 5 = Hidden, 6 = Cross,
   *  7 = Input Low, 8 = Clock Low, 9 = Output Low, 10 = Falling Edge Clock
   */
  which: number;
  /**
   * Pin electrical type:
   *  0 = Input, 1 = Output, 2 = Tristate, 3 = Open Collector,
   *  4 = Passive, 5 = Input/Output, 6 = Not Connected,
   *  7 = Free, 8 = Unspecified, 9 = Power Input,
   *  10 = Power Output, 11 = Open Emitter
   */
  elec: number;
  show_name: boolean;
  show_number: boolean;
  part: number;
  textData: PinTextData;
}

export interface dsnPower extends dsnPointTextBase, Text {
  NodeName: DocItemTypes.Power;
  rotation: number;
  which: number;
  hints?: dsnSymbolHint[];
  line_colour?: string;

  _magnetic: MagenticCoordinate;
  _no_show: boolean;
}

export interface dsnRectangle extends dsnRectBase {
  NodeName: DocItemTypes.Rectangle;
}

export interface dsnSymbolHint {
  pin: string;
  net: string;
}

export interface dsnSymbol extends dsnPointBase, Text {
  NodeName: DocItemTypes.Symbol;
  show_power: boolean;
  allow_resize: boolean;
  scale_x: number;
  scale_y: number;
  part: number;
  rotation: number;
  _symbol: libSymbol;
  text: SymbolTextItem[];
  _active_points: Coordinate[];
  textData: TextAreaData[];
  hints: dsnSymbolHint[];
}

export interface dsnText extends dsnRectBase, Stroked, Filled, Text {
  NodeName: DocItemTypes.Text;
  text: string;
  rotation: number;
  textData: TextAreaData;
}

export interface dsnWire extends dsnBase {
  NodeName: DocItemTypes.Wire;
  d_points: Coordinate[];
  _magnetic: MagenticCoordinate;
  line_colour?: string;
  line_width?: number;
}

export type DocItem =
  | dsnBusLabel
  | dsnBusSlash
  | dsnBusWire
  | dsnDesignRuler
  | dsnEllipse
  | dsnJunction
  | dsnLabel
  | dsnLine
  | dsnNoConnect
  | dsnPin
  | dsnPower
  | dsnRectangle
  | dsnSymbol
  | dsnText
  | dsnWire
  | dsnImage;
