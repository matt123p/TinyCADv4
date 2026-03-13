import {
  SetDocument,
  DocActions,
  DocActionTypes,
  RenameDocument,
  SetFileData,
  BomClose,
  BomGenerate,
  RegisterTSheet,
  UnregisterTSheet,
  AddImage,
  SaveInProgress,
  UpdateNetlistHints,
  UpdateNetlistTypes,
} from '../actions/docActions';
import {
  MenuSetStyle,
  MenuCommand,
  MenuEditor,
  MenuPaste,
  MenuCopy,
  MenuCut,
  MenuSheetSelect,
  MenuSheetLeft,
  MenuSheetRight,
  MenuSheetMove,
  MenuSheetRemove,
  MenuSheetAdd,
  MenuSheetRename,
  MenuActions,
  MenuUnfocus,
  MenuActionTypes,
  MenuCommandWithDefault,
  MenuDefaultCommand,
  MenuSetContextMenu,
  MenuSetRecentFileList,
  BrowserClose,
  BrowserOpen,
} from '../actions/menuActions';
import {
  SetFindSelection,
  FindActions,
  FindActionTypes,
} from '../actions/findActions';
import {
  DialogSelect,
  SetPageSize,
  SetDetails,
  SetDetailsAllSheets,
  SetSettings,
  SetColours,
  SetColoursAllSheets,
  SetDRC,
  SetAnnotate,
  DialogActions,
  PanelSelect,
  DialogActionTypes,
  BottomPanelSelect,
  SetDisplaySymbol,
} from '../actions/dialogActions';
import { SearchSymbol } from '../../components/libraryPanel/Search';
import {
  SymbolShow,
  SetSymbolValue,
  SetSymbolPPP,
  SetSymbolName,
  SymbolDelete,
  SymbolActions,
  SymbolShowPower,
  SymbolAdd,
  SymbolActionTypes,
  SymbolAllowResize,
  SymbolResetResize,
  SymbolEditPin,
  SymbolEditSymbol,
  SymbolEditOutline,
} from '../actions/symbolActions';
import {
  ContextMenuList,
  MergedStyle,
} from '../../manipulators/updateInterfaces';
import {
  TextActions,
  TextUpdateText,
  TextKeyDown,
  TextKeyPress,
  TextActionTypes,
} from '../actions/menuText';
import {
  dsnDrawing,
  SheetDetails,
  DrcOptions,
  AnnotateOptions,
  NetlistTypes,
  Size,
} from '../../model/dsnDrawing';
import { FindResult } from '../../model/dsnView';
import { Coordinate, DocItem, dsnPin } from '../../model/dsnItem';
import { SheetColours } from '../../manipulators/updateView';
import { CurrentFile, CurrentUser, UserConfig } from '../stores/altStoreReducer';
import { NetlistData } from '../../io/netlists/netlistGenerator';
import {
  AddLibrarySymbol,
  DeleteLibrarySymbol,
  ViewLibrary,
  EditLibrarySymbol,
  LibraryActions,
  LibraryActionTypes,
  SelectLibrarySymbol,
  SetLibraryData,
  SetLibraryList,
  EditLibrary,
  SetPPP,
  DuplicateLibrarySymbol,
  UpdateCurrentLibrary,
} from '../actions/libraryActions';
import { tclib, tclibLibraryEntry, tclibSymbol } from '../../model/tclib';
import { TSheet } from '../../components/svg/Sheet';
import { ToolbarMenuItem } from '../actions/menuActions';
import {
  ConfigActionTypes,
  ConfigUpdateConfig,
} from '../actions/configActions';
import { FileIdType } from '../../io/files';
import { BrowserError, UserLoginActions, UserLoginActionTypes, UserLoginLoginError, UserLoginLoginOK } from '../actions/userLogin';
import { ToggleRulers } from '../actions/appActions';

export interface IPoint {
  x: number;
  y: number;
}

export type AppActionTypes =
  | UserLoginActions
  | DialogActions
  | DocActions
  | FindActions
  | MenuActions
  | SymbolActions
  | TextActions
  | LibraryActions
  | ConfigUpdateConfig
  | ToggleRulers;

export interface SetSettingModel {
  grid: number;
  grid_snap: boolean;
  show_grid: boolean;
  units: number;
}

export enum Panels {
  DrcPanel = 'drc',
  SymbolPanel = 'symbol',
  StylePanel = 'style',
  LibrariesPanel = 'libraries',
  EditSymbolPanel = 'editSymbol',
  EditSpicePanel = 'editSpice',
  PinPanel = 'pin',
  EditLibraryPanel = 'editLibrary',
}

export enum BottomPanels {
  StylePanel = 'style',
  SymbolPanel = 'symbol',
  PinPanel = 'pin',
}

export function actionSetDocument(
  doc: dsnDrawing,
  filename: string,
  id: FileIdType,
  folderId: string,
) {
  const action: SetDocument = {
    type: DocActionTypes.SetDocument,
    doc,
    filename,
    id,
    folderId,
  };
  return action;
}

export function actionBomClose() {
  const action: BomClose = {
    type: DocActionTypes.BomClose,
  };
  return action;
}

export function actionBomGenerate() {
  const action: BomGenerate = {
    type: DocActionTypes.BomGenerate,
  };
  return action;
}

export function actionRegisterTSheet(tsheet: TSheet) {
  const action: RegisterTSheet = {
    type: DocActionTypes.RegisterTSheet,
    tsheet: tsheet,
  };
  return action;
}

export function actionUnregisterTSheet(tsheet: TSheet) {
  const action: UnregisterTSheet = {
    type: DocActionTypes.UnregisterTSheet,
    tsheet: tsheet,
  };
  return action;
}

export function actionAddImage(
  data: string,
  type: string,
  dataSize: number,
  size: Size,
  pos: Coordinate,
) {
  const action: AddImage = {
    type: DocActionTypes.AddImage,
    data: data,
    imgType: type,
    dataSize: dataSize,
    size: size,
    pos: pos,
  };
  return action;
}

export function actionSetFileData(
  filename: string,
  id: FileIdType,
  folderId: string,
  drawingVersion: number,
) {
  const action: SetFileData = {
    type: DocActionTypes.SetFileData,
    filename,
    id,
    folderId,
    drawingVersion,
  };
  return action;
}

export function actionRename(filename: string) {
  const action: RenameDocument = {
    type: DocActionTypes.RenameDocument,
    filename,
  };
  return action;
}

export function actionSetSaveInProgress(
  saveInProgress: boolean,
  drawingVersion: number,
) {
  const action: SaveInProgress = {
    type: DocActionTypes.SaveInProgress,
    saveInProgress,
    drawingVersion,
  };
  return action;
}

export function actionUpdateNetlistHints(netlist: NetlistData) {
  const action: UpdateNetlistHints = {
    type: DocActionTypes.UpdateNetlistHints,
    netlist,
  };
  return action;
}

export function actionUpdateNetlistTypes(
  netlist: NetlistData,
  netlistTypes: NetlistTypes,
  netTypeAssignments: { [net: string]: string },
) {
  const action: UpdateNetlistTypes = {
    type: DocActionTypes.UpdateNetlistTypes,
    netlist,
    netlistTypes,
    netTypeAssignments,
  };
  return action;
}

export function actionCommand(command: string, dx?: number, dy?: number) {
  const action: MenuCommand = { type: MenuActionTypes.MenuCommand, command, dx, dy };
  return action;
}

export function actionCommandWithDefault(
  context: string,
  item: ToolbarMenuItem,
  command: string,
) {
  const action: MenuCommandWithDefault = {
    type: MenuActionTypes.MenuCommandWithDefault,
    context,
    item,
    command,
  };
  return action;
}

export function actionMenuDefaultCommand(context: string) {
  const action: MenuDefaultCommand = {
    type: MenuActionTypes.MenuDefaultCommand,
    context,
  };
  return action;
}

export function actionStyle(style: MergedStyle) {
  const action: MenuSetStyle = { type: MenuActionTypes.MenuSetStyle, style };
  return action;
}

export function actionFindSelection(mode: number, selection: FindResult) {
  const action: SetFindSelection = {
    type: FindActionTypes.SetFindSelection,
    mode,
    selection,
  };
  return action;
}

export function actionEditorEvent(
  event_name: string,
  p: Coordinate,
  r: Coordinate,
  event_pos: Coordinate,
  target: IPoint,
  key: number,
) {
  const action: MenuEditor = {
    type: MenuActionTypes.MenuEditor,
    event_name,
    p,
    r,
    event_pos,
    target,
    key,
  };
  return action;
}

export function actionUnfocus() {
  const action: MenuUnfocus = { type: MenuActionTypes.MenuUnfocus };
  return action;
}

//
// Text actions
//
export function actionUpdateText(
  item: DocItem,
  handle: number,
  new_text: string,
) {
  const action: TextUpdateText = {
    type: TextActionTypes.TextUpdateText,
    item,
    handle,
    new_text,
  };
  return action;
}

export function actionKeyDown(
  keyCode: number,
  shiftKey: boolean,
  ctrlKey: boolean,
) {
  const action: TextKeyDown = {
    type: TextActionTypes.TextKeyDown,
    keyCode,
    shiftKey,
    ctrlKey,
  };
  return action;
}

export function actionKeyPress(
  keyCode: number,
  shiftKey: boolean,
  ctrlKey: boolean,
) {
  const action: TextKeyPress = {
    type: TextActionTypes.TextKeyPress,
    keyCode,
    shiftKey,
    ctrlKey,
  };
  return action;
}

//
// Clipboard commands
//
export function actionPasteEvent(text: string, pos: Coordinate) {
  const action: MenuPaste = { type: MenuActionTypes.MenuPaste, text, pos };
  return action;
}

export function actionCopyEvent() {
  const action: MenuCopy = { type: MenuActionTypes.MenuCopy };
  return action;
}

export function actionCutEvent() {
  const action: MenuCut = { type: MenuActionTypes.MenuCut };
  return action;
}

// Sheet commands
export function actionSheetSelect(sheet_index: number) {
  const action: MenuSheetSelect = {
    type: MenuActionTypes.MenuSheetSelect,
    sheet_index,
  };
  return action;
}

export function actionSheetLeft(): MenuSheetLeft {
  return { type: MenuActionTypes.MenuSheetLeft };
}

export function actionSheetRight(): MenuSheetRight {
  return { type: MenuActionTypes.MenuSheetRight };
}

export function actionSheetMove(fromIndex: number, toIndex: number): MenuSheetMove {
  return { type: MenuActionTypes.MenuSheetMove, fromIndex, toIndex };
}

export function actionSheetRename(sheet_name: string) {
  const action: MenuSheetRename = {
    type: MenuActionTypes.MenuSheetRename,
    sheet_name,
  };
  return action;
}

export function actionSheetAdd(sheet_name: string) {
  const action: MenuSheetAdd = {
    type: MenuActionTypes.MenuSheetAdd,
    sheet_name,
  };
  return action;
}

export function actionSheetRemove(): MenuSheetRemove {
  return { type: MenuActionTypes.MenuSheetRemove };
}

// Context menu
export function actionMenuSetContextMenu(
  position: Coordinate,
  items: ContextMenuList,
): MenuSetContextMenu {
  return { type: MenuActionTypes.MenuSetContextMenu, position, items };
}

// File menu
export function actionMenuSetRecentFileList(
  files: CurrentFile[],
): MenuSetRecentFileList {
  return { type: MenuActionTypes.MenuSetRecentFileList, files };
}


export function actionMenuBrowserClose(
  index: number
): BrowserClose {
  return { type: MenuActionTypes.BrowserClose, index };
}

export function actionMenuBrowserOpen(
  url: string, name: string
): BrowserOpen {
  return { type: MenuActionTypes.BrowserOpen, name, url };
}


// Panel Commands
export function actionSelectPanel(dlg: Panels) {
  const action: PanelSelect = {
    type: DialogActionTypes.PanelSelect,
    dlg,
  };
  return action;
}

export function actionSelectBottomPanel(dlg: BottomPanels) {
  const action: BottomPanelSelect = {
    type: DialogActionTypes.BottomPanelSelect,
    dlg,
  };
  return action;
}

export function actionSetDisplaySymbol(
  symbol: tclibSymbol,
  name: tclibLibraryEntry,
  searchSymbol: SearchSymbol,
) {
  const action: SetDisplaySymbol = {
    type: DialogActionTypes.SetDisplaySymbol,
    symbol,
    name,
    searchSymbol,
  };
  return action;
}

// Dialogue commands
export function actionSelectDialog(dlg: string, props: any) {
  const action: DialogSelect = {
    type: DialogActionTypes.DialogSelect,
    dlg,
    props,
  };
  return action;
}

export function actionCancelDialog() {
  return actionSelectDialog(null, null);
}

export function actionUpdatePageSize(page_size: Coordinate) {
  const action: SetPageSize = {
    type: DialogActionTypes.SetPageSize,
    page_size,
  };
  return action;
}

export function actionUpdateDetails(details: SheetDetails) {
  const action: SetDetails = { type: DialogActionTypes.SetDetails, details };
  return action;
}

export function actionUpdateDetailsAllSheets(details: SheetDetails) {
  const action: SetDetailsAllSheets = { type: DialogActionTypes.SetDetailsAllSheets, details };
  return action;
}

export function actionUpdateSettings(details: SetSettingModel) {
  const action: SetSettings = { type: DialogActionTypes.SetSettings, details };
  return action;
}

export function actionUpdateColours(colours: SheetColours) {
  const action: SetColours = { type: DialogActionTypes.SetColours, colours };
  return action;
}

export function actionUpdateColoursAllSheets(colours: SheetColours) {
  const action: SetColoursAllSheets = {
    type: DialogActionTypes.SetColoursAllSheets,
    colours,
  };
  return action;
}

export function actionDrc(drc: DrcOptions, netlist: NetlistData) {
  const action: SetDRC = {
    type: DialogActionTypes.SetDRC,
    drc,
    netlist: netlist,
  };
  return action;
}

export function actionAnnotate(annotate: AnnotateOptions) {
  const action: SetAnnotate = { type: DialogActionTypes.SetAnnotate, annotate };
  return action;
}

// Symbol editing
export function actionSymbolShowPower(show_power: boolean) {
  const action: SymbolShowPower = {
    type: SymbolActionTypes.SymbolShowPower,
    show_power,
  };
  return action;
}

export function actionAllowResize(allow_resize: boolean) {
  const action: SymbolAllowResize = {
    type: SymbolActionTypes.SymbolAllowResize,
    allow_resize,
  };
  return action;
}

export function actionResetResize() {
  const action: SymbolResetResize = {
    type: SymbolActionTypes.SymbolResetResize,
  };
  return action;
}

export function actionSymbolShow(index: number) {
  const action: SymbolShow = { type: SymbolActionTypes.SymbolShow, index };
  return action;
}

export function actionSymbolValue(index: number, value: string) {
  const action: SetSymbolValue = {
    type: SymbolActionTypes.SetSymbolValue,
    index,
    value,
  };
  return action;
}

export function actionSymbolPPP(value: string) {
  const action: SetSymbolPPP = { type: SymbolActionTypes.SetSymbolPPP, value };
  return action;
}

export function actionSymbolName(index: number, value: string) {
  const action: SetSymbolName = {
    type: SymbolActionTypes.SetSymbolName,
    index,
    value,
  };
  return action;
}

export function actionSymbolDelete(index: number) {
  const action: SymbolDelete = { type: SymbolActionTypes.SymbolDelete, index };
  return action;
}

export function actionSymbolAdd() {
  const action: SymbolAdd = { type: SymbolActionTypes.SymbolAdd };
  return action;
}

export function actionSymbolEditPin(pin: dsnPin) {
  const action: SymbolEditPin = { type: SymbolActionTypes.SymbolEditPin, pin };
  return action;
}

export function actionSymbolEditSymbol(editSymbol: tclibLibraryEntry) {
  const action: SymbolEditSymbol = {
    type: SymbolActionTypes.SymbolEditSymbol,
    editSymbol,
  };
  return action;
}

export function actionSymbolEditOutline(heterogeneous: boolean) {
  const action: SymbolEditOutline = {
    type: SymbolActionTypes.SymbolEditOutline,
    heterogeneous,
  };
  return action;
}

export function userLoginOK(user: CurrentUser) {
  const action: UserLoginLoginOK = {
    type: UserLoginActionTypes.UserLoginLoginOK,
    user: user,
  };
  return action;
}

export function userLoginLoginError(error: string) {
  const action: UserLoginLoginError = {
    type: UserLoginActionTypes.UserLoginLoginError,
    error: error,
  };
  return action;
}

export function browserError() {
  const action: BrowserError = {
    type: UserLoginActionTypes.BrowserError,
  };
  return action;
}

export function actionSetLibraryList(libraries: tclib[]) {
  const action: SetLibraryList = {
    type: LibraryActionTypes.SetLibraryList,
    libraries: libraries,
  };
  return action;
}

export function actionViewLibrary(lib: tclib) {
  const action: ViewLibrary = {
    type: LibraryActionTypes.ViewLibrary,
    lib: lib,
  };
  return action;
}

export function actionEditLibrary(
  lib: tclib,
  filename: string,
  id: FileIdType,
  folderId: string,
) {
  const action: EditLibrary = {
    type: LibraryActionTypes.EditLibrary,
    lib: lib,
    filename,
    id,
    folderId,
  };
  return action;
}

export function actionUpdateCurrentLibrary(lib: tclib) {
  const action: UpdateCurrentLibrary = {
    type: LibraryActionTypes.UpdateCurrentLibrary,
    lib: lib,
  };
  return action;
}

export function actionEditLibrarySymbol(name: tclibLibraryEntry) {
  const action: EditLibrarySymbol = {
    type: LibraryActionTypes.EditLibrarySymbol,
    name: name,
  };
  return action;
}

export function actionDuplicateLibrarySymbol(nameId: number) {
  const action: DuplicateLibrarySymbol = {
    type: LibraryActionTypes.DuplicateLibrarySymbol,
    nameId: nameId,
  };
  return action;
}

export function actionDeleteLibrarySymbol(nameId: number) {
  const action: DeleteLibrarySymbol = {
    type: LibraryActionTypes.DeleteLibrarySymbol,
    nameId: nameId,
  };
  return action;
}

export function actionAddLibrarySymbol() {
  const action: AddLibrarySymbol = {
    type: LibraryActionTypes.AddLibrarySymbol,
  };
  return action;
}

export function actionSetPPP(ppp: number) {
  const action: SetPPP = {
    type: LibraryActionTypes.SetPPP,
    ppp: ppp,
  };
  return action;
}

export function actionSetLibraryData(lib: tclib) {
  const action: SetLibraryData = {
    type: LibraryActionTypes.SetLibraryData,
    lib: lib,
  };
  return action;
}

export function actionSelectLibrarySymbol(
  name: tclibLibraryEntry,
  symbolData: DocItem[][],
  pos: Coordinate,
) {
  const action: SelectLibrarySymbol = {
    type: LibraryActionTypes.SelectLibrarySymbol,
    name: name,
    symbolData: symbolData,
    pos: pos,
  };
  return action;
}

export function actionUpdateConfig(config: UserConfig) {
  const action: ConfigUpdateConfig = {
    type: ConfigActionTypes.ConfigUpdateConfig,
    config: config,
  };
  return action;
}
