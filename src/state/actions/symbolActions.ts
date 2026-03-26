import { DocItem, dsnPin } from '../../model/dsnItem';
import { tclibLibraryEntry } from '../../model/tclib';

export type ReplaceSymbolScope = 'single_symbol' | 'all_symbols_on_sheet';

export enum SymbolActionTypes {
  SymbolShowPower = '[Symbol] SymbolShowPower',
  SymbolAllowResize = '[Symbol] SymbolAllowResize',
  SymbolResetResize = '[Symbol] SymbolResetResize',
  SymbolShow = '[Symbol] SymbolShow',
  SetSymbolValue = '[Symbol] SetSymbolValue',
  SetSymbolPPP = '[Symbol] SetSymbolPPP',
  SetSymbolName = '[Symbol] SetSymbolName',
  SymbolDelete = '[Symbol] SymbolDelete',
  SymbolAdd = '[Symbol] SymbolAdd',
  SymbolEditPin = '[Symbol] SymbolEditPin',
  SymbolEditSymbol = '[Symbol] SymbolEditSymbol',
  SymbolEditOutline = '[Symbol] SymbolEditOutline',
  ReplaceSymbol = '[Symbol] ReplaceSymbol',
}

export interface SymbolShowPower {
  type: SymbolActionTypes.SymbolShowPower;
  show_power: boolean;
}

export interface SymbolAllowResize {
  type: SymbolActionTypes.SymbolAllowResize;
  allow_resize: boolean;
}

export interface SymbolResetResize {
  type: SymbolActionTypes.SymbolResetResize;
}

export interface SymbolShow {
  type: SymbolActionTypes.SymbolShow;
  index: number;
}

export interface SetSymbolValue {
  type: SymbolActionTypes.SetSymbolValue;
  index: number;
  value: string;
}

export interface SetSymbolPPP {
  type: SymbolActionTypes.SetSymbolPPP;
  value: string;
}

export interface SetSymbolName {
  type: SymbolActionTypes.SetSymbolName;
  index: number;
  value: string;
}

export interface SymbolDelete {
  type: SymbolActionTypes.SymbolDelete;
  index: number;
}

export interface SymbolAdd {
  type: SymbolActionTypes.SymbolAdd;
}

export interface SymbolEditPin {
  type: SymbolActionTypes.SymbolEditPin;
  pin: dsnPin;
}

export interface SymbolEditSymbol {
  type: SymbolActionTypes.SymbolEditSymbol;
  editSymbol: tclibLibraryEntry;
}

export interface SymbolEditOutline {
  type: SymbolActionTypes.SymbolEditOutline;
  heterogeneous: boolean;
}

export interface ReplaceSymbol {
  type: SymbolActionTypes.ReplaceSymbol;
  sourceUid: string;
  targetSymbolId: number;
  targetSheetIndex: number;
  scope: ReplaceSymbolScope;
  name: tclibLibraryEntry;
  symbolData: DocItem[][];
  keepFieldValues: boolean;
}

export type SymbolActions =
  | SymbolShowPower
  | SymbolAllowResize
  | SymbolResetResize
  | SymbolShow
  | SetSymbolValue
  | SetSymbolPPP
  | SetSymbolName
  | SymbolDelete
  | SymbolAdd
  | SymbolEditPin
  | SymbolEditSymbol
  | SymbolEditOutline
  | ReplaceSymbol;
