import { Coordinate, Text } from '../model/dsnItem';

export interface TextAreaBlock {
  x: number;
  y: number;
  width: number;
  height: number;
  value: string;
  sel_x: number;
  sel_y: number;
  sel_width: number;
  sel_height: number;
  start: number;
}

export interface TextAreaEdit {
  x: number;
  y: number;
  height: number;
}

export enum IsInsideTextResult {
  Inside_None,
  Inside_Text,
  Inside_Rect,
}

export interface TextArea {
  dragHandle: number;
  moveHandle: number;
  drawMultiline: boolean;
  drawRotation: number;
  drawWidth: number;
  drawHeight: number;
  drawCentre: boolean;
  font_size: number;
  drawItem: Text;
  drawPoint: Coordinate;
  drawX: number;
  drawY: number;
  allowMove: boolean;
}

export interface TextAreaData {
  textArea: TextArea;
  textBlocks: TextAreaBlock[];
  textEdit: TextAreaEdit;

  width: number;
  height: number;
  centre_x: number;

  drawText: string;

  sel_start: number;
  sel_end: number;

  sel_end_pos: number;
  sel_start_pos: number;
  edit_position: number;
}
