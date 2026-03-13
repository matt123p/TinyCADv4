import { FileIdType } from '../../io/files';
import { dsnDrawing } from '../../model/dsnDrawing';
import { Coordinate, DocItem } from '../../model/dsnItem';
import { tclib, tclibLibraryEntry } from '../../model/tclib';

export enum LibraryActionTypes {
  SetLibraryList = '[Library] SetLibraryList',
  SetLibraryData = '[Library] SetLibraryData',
  SelectLibrarySymbol = '[Library] SelectLibrarySymbol',
  ViewLibrary = '[Library] ViewLibrary',
  EditLibrary = '[Library] EditLibrary',
  EditLibrarySymbol = '[Library] EditLibrarySymbol',
  DuplicateLibrarySymbol = '[Library] DuplicateLibrarySymbol',
  DeleteLibrarySymbol = '[Library] DeleteLibrarySymbol',
  AddLibrarySymbol = '[Library] AddLibrarySymbol',
  SetPPP = '[Library] SetPPP',
  UpdateCurrentLibrary = '[Library] UpdateCurrentLibrary',
}

export interface SetLibraryList {
  type: LibraryActionTypes.SetLibraryList;
  libraries: tclib[];
}

export interface SetLibraryData {
  type: LibraryActionTypes.SetLibraryData;
  lib: tclib;
}

export interface SelectLibrarySymbol {
  type: LibraryActionTypes.SelectLibrarySymbol;
  name: tclibLibraryEntry;
  symbolData: DocItem[][];
  pos: Coordinate;
}

export interface ViewLibrary {
  type: LibraryActionTypes.ViewLibrary;
  lib: tclib;
}

export interface EditLibrarySymbol {
  type: LibraryActionTypes.EditLibrarySymbol;
  name: tclibLibraryEntry;
}

export interface DuplicateLibrarySymbol {
  type: LibraryActionTypes.DuplicateLibrarySymbol;
  nameId: number;
}

export interface EditLibrary {
  type: LibraryActionTypes.EditLibrary;
  lib: tclib;
  filename: string;
  id: FileIdType;
  folderId: string;
}

export interface DeleteLibrarySymbol {
  type: LibraryActionTypes.DeleteLibrarySymbol;
  nameId: number;
}

export interface AddLibrarySymbol {
  type: LibraryActionTypes.AddLibrarySymbol;
}

export interface SetPPP {
  type: LibraryActionTypes.SetPPP;
  ppp: number;
}

export interface UpdateCurrentLibrary {
  type: LibraryActionTypes.UpdateCurrentLibrary;
  lib: tclib;
}

export type LibraryActions =
  | SetLibraryData
  | SelectLibrarySymbol
  | SetLibraryList
  | ViewLibrary
  | EditLibrary
  | EditLibrarySymbol
  | DuplicateLibrarySymbol
  | DeleteLibrarySymbol
  | AddLibrarySymbol
  | SetPPP
  | UpdateCurrentLibrary;
