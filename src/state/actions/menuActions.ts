import {
  ContextMenuList,
  MergedStyle,
} from '../../manipulators/updateInterfaces';
import { IPoint } from '../dispatcher/AppDispatcher';
import { Coordinate } from '../../model/dsnItem';
import { CurrentFile } from '../stores/altStoreReducer';

// Simple interface for toolbar menu item (key is the command)
export interface ToolbarMenuItem {
  key: string;
  iconProps?: {
    imageProps?: {
      src: string;
    };
  };
}

export enum MenuActionTypes {
  MenuCommand = '[Menu] Command',
  MenuCommandWithDefault = '[Menu] MenuCommandWithDefault',
  MenuDefaultCommand = '[Menu] MenuDefaultCommand',
  MenuSetStyle = '[Menu] SetStyle',
  MenuAdd = '[Menu] Add',
  MenuEditor = '[Menu] Editor',
  MenuUnfocus = '[Menu] Unfocus',
  MenuPaste = '[Menu] Paste',
  MenuCopy = '[Menu] MenuCopy',
  MenuCut = '[Menu] MenuCut',
  MenuSheetSelect = '[Menu] SheetSelect',
  MenuSheetLeft = '[Menu] SheetLeft',
  MenuSheetRight = '[Menu] SheetRight',
  MenuSheetMove = '[Menu] SheetMove',
  MenuSheetAdd = '[Menu] SheetAdd',
  MenuSheetRename = '[Menu] SheetRename',
  MenuSheetRemove = '[Menu] SheetRemove',
  MenuSetContextMenu = '[Menu] MenuSetContextMenu',
  MenuSetRecentFileList = '[Menu] MenuSetRecentFileList',
  BrowserClose = '[Menu] BrowserClose',
  BrowserOpen = '[Menu] BrowserOpen',
}

export interface MenuCommand {
  type: MenuActionTypes.MenuCommand;
  command: string;
  dx?: number;
  dy?: number;
}

export interface MenuCommandWithDefault {
  type: MenuActionTypes.MenuCommandWithDefault;
  context: string;
  item: ToolbarMenuItem;
  command: string;
  dx?: number;
  dy?: number;
}

export interface MenuDefaultCommand {
  type: MenuActionTypes.MenuDefaultCommand;
  context: string;
}

export interface MenuSetStyle {
  type: MenuActionTypes.MenuSetStyle;
  style: MergedStyle;
}

export interface MenuEditor {
  type: MenuActionTypes.MenuEditor;

  event_name: string;
  p: Coordinate;
  r: Coordinate;
  event_pos: Coordinate;
  target: IPoint;
  key: number;
}

export interface MenuUnfocus {
  type: MenuActionTypes.MenuUnfocus;
}

export interface MenuPaste {
  type: MenuActionTypes.MenuPaste;
  pos: Coordinate;
  text: string;
}

export interface MenuCopy {
  type: MenuActionTypes.MenuCopy;
}

export interface MenuCut {
  type: MenuActionTypes.MenuCut;
}

export interface MenuSheetSelect {
  type: MenuActionTypes.MenuSheetSelect;
  sheet_index: number;
}

export interface MenuSheetLeft {
  type: MenuActionTypes.MenuSheetLeft;
}

export interface MenuSheetRight {
  type: MenuActionTypes.MenuSheetRight;
}

export interface MenuSheetMove {
  type: MenuActionTypes.MenuSheetMove;
  fromIndex: number;
  toIndex: number;
}

export interface MenuSheetAdd {
  type: MenuActionTypes.MenuSheetAdd;
  sheet_name: string;
}

export interface MenuSheetRename {
  type: MenuActionTypes.MenuSheetRename;
  sheet_name: string;
}

export interface MenuSheetRemove {
  type: MenuActionTypes.MenuSheetRemove;
}

export interface MenuSetContextMenu {
  type: MenuActionTypes.MenuSetContextMenu;
  position: Coordinate;
  items: ContextMenuList;
}

export interface MenuSetRecentFileList {
  type: MenuActionTypes.MenuSetRecentFileList;
  files: CurrentFile[];
}

export interface BrowserClose {
  type: MenuActionTypes.BrowserClose;
  index: number;
}

export interface BrowserOpen {
  type: MenuActionTypes.BrowserOpen;
  url: string;
  name: string;
}


export type MenuActions =
  | MenuCommand
  | MenuCommandWithDefault
  | MenuDefaultCommand
  | MenuSetStyle
  | MenuEditor
  | MenuUnfocus
  | MenuPaste
  | MenuCopy
  | MenuCut
  | MenuSheetSelect
  | MenuSheetLeft
  | MenuSheetRight
  | MenuSheetMove
  | MenuSheetAdd
  | MenuSheetRename
  | MenuSheetRemove
  | MenuSetContextMenu
  | MenuSetRecentFileList
  | BrowserClose
  | BrowserOpen;
