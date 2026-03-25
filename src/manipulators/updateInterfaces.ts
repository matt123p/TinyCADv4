import { Snap } from './snap';
import { Coordinate, DocItem } from '../model/dsnItem';
import { ViewTracker, FindResult } from '../model/dsnView';

export interface CopyData {
  item: DocItem;
  copy_data: string;
}

export interface UpdateText {
  updateText(handle: number, new_text: string): DocItem;
  handleKeyDown(
    handle: number,
    keyCode: number,
    shiftKey: boolean,
    ctrlKey: boolean,
    altKey: boolean,
    metaKey: boolean,
  ): DocItem;
  handleKeyPress(handle: number, keyCode: number): DocItem;
  on_mouse_click(
    handle: number,
    p: Coordinate,
    clear_selection: boolean,
  ): DocItem;
  handleTextPaste(handle: number, text: string): DocItem;
  handleTextCopy(handle: number, cut: boolean): CopyData;
  wantKeyPress(handle: number): boolean;
}

export interface MergedStyle {
  line: boolean;
  fill: boolean;
  text: boolean;
  text_colour: boolean;
  border_style: boolean;

  stroked?: boolean;
  line_colour?: string;
  line_width?: number;
  line_pattern?: number;

  filled?: boolean;
  fill_colour?: string;
  hatch?: number;
  rounded_rect?: boolean;

  font_name?: string;
  font_size?: number;
  font_bold?: boolean;
  font_italic?: boolean;
  font_colour?: string;
}

export interface CssStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string | number;
}

export enum ContextualMenuItemType {
  Normal,
  Divider,
}

export interface ContextMenuItem {
  key: string;
  text?: string;
  ariaLabel?: string;
  iconProps?: {
    iconName: string;
  };
  disabled?: boolean;
  itemType?: ContextualMenuItemType;
  subMenuProps?: {
    items: ContextMenuItem[];
  };
}

export type ContextMenuList = ContextMenuItem[];

export interface SimpleAdd {
  begin_add(
    p: Coordinate,
    tracker: ViewTracker,
    snap: Snap,
    items: DocItem[],
  ): { obj: DocItem; end: boolean; items: DocItem[] };

  complete_add(): DocItem;
  end_add(
    tracker: ViewTracker,
    items: DocItem[],
  ): { item: DocItem; end: boolean; items: DocItem[] };
  mouse_move(
    tracker: ViewTracker,
    p: Coordinate,
    handle: number,
    snap: Snap,
    items: DocItem[],
  ): { obj: DocItem; r: Coordinate };
}

export interface SimpleDrag {
  drag_handle(
    tracker: ViewTracker,
    items: DocItem[],
    handle: number,
  ): DocItem[];
  dragStart(
    tracker: ViewTracker,
    items: DocItem[],
    handle: number,
  ): { items: DocItem[]; obj: DocItem };
  dragEnd(
    tracker: ViewTracker,
    items: DocItem[],
    handle: number,
  ): { items: DocItem[]; obj: DocItem };
}

export interface MoveAdd {
  move_add(
    p: Coordinate,
    snap: Snap,
    tracker: ViewTracker,
    items: DocItem[],
  ): DocItem;

  mousemove_add(
    p: Coordinate,
    snap: Snap,
    tracker: ViewTracker,
    items: DocItem[],
  ): { item: DocItem; display: boolean };

  drag_add(
    p: Coordinate,
    snap: Snap,
    tracker: ViewTracker,
    items: DocItem[],
  ): DocItem;
}

export interface DrawingDelta {
  dx: number;
  dy: number;
  dr: number;
  scale_x: number;
  scale_y: number;
  part: number;
  show_power: boolean;
  editingLibrary: boolean;
  heterogeneous: boolean;
}

export interface IsInsideResult {
  item: DocItem;
  handle: number;
  distance?: number;
  search_marker?: FindResult;
  candidates?: IsInsideResult[];
}

export interface IsInside {
  is_inside(
    delta: DrawingDelta,
    p: Coordinate,
    is_selected: boolean,
  ): IsInsideResult;

  is_inside_rect(
    delta: DrawingDelta,
    a: Coordinate,
    b: Coordinate,
    items: DocItem[],
  ): DocItem[];
}
