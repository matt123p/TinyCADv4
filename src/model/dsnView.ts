import { DocItem, Coordinate } from './dsnItem';
import { dragObject } from '../manipulators/dragObject';
import { ContextMenuList, MergedStyle } from '../manipulators/updateInterfaces';

interface PointToPointPreviewCache {
  start: Coordinate;
  end: Coordinate;
  route: Coordinate[];
  workspace: unknown;
  items: DocItem[];
  grid: number;
}

export interface ViewTracker {
  a: Coordinate;
  b: Coordinate;
  _dragArray: dragObject[];
  _drag: dragObject;
  _primary_horz: boolean;
  pointToPointPreview?: PointToPointPreviewCache;
}

export interface FindResult {
  symbol: string;
  text: string;
  pin?: string;
  a: Coordinate;
  id: number;
  ids?: number[];
  pins?: string[];
  sheet?: string;
}

export interface BrowserSheetData {
  name: string;
  url: string;
}


export interface dsnView {
  // Which sheet is visible?
  selected_sheet: number;

  // Here is the selectable item (that is the item that
  // the mouse is over)
  selectable: DocItem;

  // Used when dragging an element to determine
  // which handle the user is dragging the object by
  _drag_handle: number;
  drag: dragObject;

  _selected_handle: number;
  _in_select_rect: boolean;
  _select_rect_a: Coordinate;
  _select_rect_b: Coordinate;
  _selected_array: number[];
  cursor: string;
  hover_obj: DocItem | DocItem[];
  hover_ids: number[];
  hover_pins: string[];
  
  selection_candidates?: DocItem[];
  last_click_point?: Coordinate;

  contextMenuLastPoint: Coordinate;

  // For adding a new item
  add: DocItem;
  display_add: boolean;
  menu_command: string;

  // Used when dragging an element, the snap object
  // aids in snapping and moving the object
  in_add_rect: boolean;
  selectedStyle: MergedStyle;
  hover_point: Coordinate;
  tracker: ViewTracker;

  // Zoom (in percent)
  zoom: number;

  // List of browser sheets to display (e.g. help etc.)
  browserSheets: BrowserSheetData[];

}
