import { DocItem } from '../../model/dsnItem';

export enum TextActionTypes {
  TextUpdateText = '[Text] UpdateText',
  TextKeyDown = '[Text] KeyDown',
  TextKeyPress = '[Text] KeyPress',
}

export interface TextUpdateText {
  type: TextActionTypes.TextUpdateText;

  item: DocItem;
  handle: number;
  new_text: string;
}

export interface TextKeyDown {
  type: TextActionTypes.TextKeyDown;

  keyCode: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface TextKeyPress {
  type: TextActionTypes.TextKeyPress;

  keyCode: number;
  shiftKey: boolean;
  ctrlKey: boolean;
}

export type TextActions = TextUpdateText | TextKeyDown | TextKeyPress;
