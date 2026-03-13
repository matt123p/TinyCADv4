import { SetSettingModel, Panels, BottomPanels } from '../dispatcher/AppDispatcher';
import { Coordinate } from '../../model/dsnItem';
import {
  SheetDetails,
  DrcOptions,
  AnnotateOptions,
} from '../../model/dsnDrawing';
import { SheetColours } from '../../manipulators/updateView';
import { NetlistData } from '../../io/netlists/netlistGenerator';
import { tclibLibraryEntry, tclibSymbol } from '../../model/tclib';
import { SearchSymbol } from '../../components/libraryPanel/Search';

export enum DialogActionTypes {
  PanelSelect = '[Dialog] PanelSelect',
  BottomPanelSelect = '[Dialog] BottomPanelSelect',
  SetDisplaySymbol = '[Dialog] SetDisplaySymbol',
  DialogSelect = '[Dialog] DialogSelect',
  SetPageSize = '[Dialog] SetPageSize',
  SetDetails = '[Dialog] SetDetails',
  SetDetailsAllSheets = '[Dialog] SetDetailsAllSheets',
  SetSettings = '[Dialog] SetSettings',
  SetColours = '[Dialog] SetColours',
  SetColoursAllSheets = '[Dialog] SetColoursAllSheets',
  SetDRC = '[Dialog] SetDRC',
  SetAnnotate = '[Dialog] SetAnnotate',
}

export interface PanelSelect {
  type: DialogActionTypes.PanelSelect;
  dlg: Panels;
}

export interface BottomPanelSelect {
  type: DialogActionTypes.BottomPanelSelect;
  dlg: BottomPanels;
}

export interface SetDisplaySymbol {
  type: DialogActionTypes.SetDisplaySymbol;
  symbol: tclibSymbol;
  name: tclibLibraryEntry;
  searchSymbol: SearchSymbol;
}

export interface DialogSelect {
  type: DialogActionTypes.DialogSelect;
  dlg: string;
  props: any;
}

export interface SetPageSize {
  type: DialogActionTypes.SetPageSize;
  page_size: Coordinate;
}

export interface SetDetails {
  type: DialogActionTypes.SetDetails;
  details: SheetDetails;
}

export interface SetDetailsAllSheets {
  type: DialogActionTypes.SetDetailsAllSheets;
  details: SheetDetails;
}

export interface SetSettings {
  type: DialogActionTypes.SetSettings;
  details: SetSettingModel;
}

export interface SetColours {
  type: DialogActionTypes.SetColours;
  colours: SheetColours;
}

export interface SetColoursAllSheets {
  type: DialogActionTypes.SetColoursAllSheets;
  colours: SheetColours;
}

export interface SetDRC {
  type: DialogActionTypes.SetDRC;
  drc: DrcOptions;
  netlist: NetlistData;
}

export interface SetAnnotate {
  type: DialogActionTypes.SetAnnotate;
  annotate: AnnotateOptions;
}

export type DialogActions =
  | PanelSelect
  | BottomPanelSelect
  | SetDisplaySymbol
  | DialogSelect
  | SetPageSize
  | SetDetails
  | SetDetailsAllSheets
  | SetSettings
  | SetColours
  | SetColoursAllSheets
  | SetDRC
  | SetAnnotate;
