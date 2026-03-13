export interface KiTextEffects {
  sizeX: number;
  sizeY: number;
  bold: boolean;
  italic: boolean;
  hidden: boolean;
  color?: string;
  justify?: string[];
}

export interface KiProperty {
  key: string;
  value: string;
  effects: KiTextEffects;
}

export interface KiStroke {
  width: number;
  type: string;
  color?: string;
}

export interface KiFill {
  type: string;
  color?: string;
}

export interface KiPoint {
  x: number;
  y: number;
}

export interface KiPosition extends KiPoint {
  angle: number;
}

export interface KiRectangle {
  type: 'rectangle';
  start: KiPoint;
  end: KiPoint;
  stroke: KiStroke;
  fill: KiFill;
}

export interface KiCircle {
  type: 'circle';
  center: KiPoint;
  radius: number;
  stroke: KiStroke;
  fill: KiFill;
}

export interface KiPolyline {
  type: 'polyline';
  points: KiPoint[];
  stroke: KiStroke;
  fill: KiFill;
}

export interface KiArc {
  type: 'arc';
  start: KiPoint;
  mid: KiPoint;
  end: KiPoint;
  stroke: KiStroke;
  fill: KiFill;
}

export interface KiBezier {
  type: 'bezier';
  points: KiPoint[];
  stroke: KiStroke;
  fill: KiFill;
}

export interface KiText {
  type: 'text';
  text: string;
  position: KiPosition;
  effects: KiTextEffects;
}

export type KiGraphicItem =
  | KiRectangle
  | KiCircle
  | KiPolyline
  | KiArc
  | KiBezier
  | KiText;

export interface KiPin {
  electricalType: string;
  graphicStyle: string;
  position: KiPosition;
  length: number;
  name: string;
  nameEffects: KiTextEffects;
  number: string;
  numberEffects: KiTextEffects;
  hide: boolean;
}

export interface KiSubSymbol {
  unit: number;
  style: number;
  graphics: KiGraphicItem[];
  pins: KiPin[];
}

export interface KiSymbol {
  name: string;
  properties: KiProperty[];
  pinNamesOffset: number;
  showPinNames: boolean;
  showPinNumbers: boolean;
  power: boolean;
  extendsName?: string;
  subsymbols: KiSubSymbol[];
}

export interface KiCadLibrary {
  symbols: KiSymbol[];
}
