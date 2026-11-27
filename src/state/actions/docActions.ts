import { TSheet } from '../../components/svg/Sheet';
import { FileIdType } from '../../io/files';
import { NetlistData } from '../../io/netlists/netlistGenerator';
import { dsnDrawing, dsnSheet, NetlistTypes, Size } from '../../model/dsnDrawing';
import { LayoutChange } from '../../layout/types';
import { Coordinate } from '../../model/dsnItem';

export enum DocActionTypes {
  ApplyChatLibrary = '[Document] ApplyChatLibrary',
  ApplyChatEdit = '[Document] ApplyChatEdit',
  ApplyAutoLayout = '[Document] ApplyAutoLayout',
  SetDocument = '[Document] SetDocument',
  RenameDocument = '[Document] RenameDocument',
  SetFileData = '[Document] SetFileData',
  BomGenerate = '[Document] BomGenerate',
  BomClose = '[Document] BomClose',
  RegisterTSheet = '[Document] RegisterTSheet',
  UnregisterTSheet = '[Document] UnregisterTSheet',
  AddImage = '[Document] AddImage',
  SaveInProgress = '[Document] SaveInProgress',
  UpdateNetlistHints = '[Document] UpdateNetlistHints',
  UpdateNetlistTypes = '[Document] UpdateNetlistTypes',
  StampWireNetTypes = '[Document] StampWireNetTypes',
}

export interface SetDocument {
  type: DocActionTypes.SetDocument;
  doc: dsnDrawing;
  filename: string;
  id: FileIdType;
  folderId: string;
}

export interface SetFileData {
  type: DocActionTypes.SetFileData;
  filename: string;
  id: FileIdType;
  folderId: string;
  drawingVersion: number;
}

export interface RenameDocument {
  type: DocActionTypes.RenameDocument;
  filename: string;
}

export interface BomGenerate {
  type: DocActionTypes.BomGenerate;
}

export interface BomClose {
  type: DocActionTypes.BomClose;
}

export interface RegisterTSheet {
  type: DocActionTypes.RegisterTSheet;
  tsheet: TSheet;
}

export interface UnregisterTSheet {
  type: DocActionTypes.UnregisterTSheet;
  tsheet: TSheet;
}

export interface AddImage {
  type: DocActionTypes.AddImage;
  data: string;
  dataSize: number;
  imgType: string;
  size: Size;
  pos: Coordinate;
}

export interface SaveInProgress {
  type: DocActionTypes.SaveInProgress;
  saveInProgress: boolean;
  drawingVersion: number;
}

export interface UpdateNetlistHints {
  type: DocActionTypes.UpdateNetlistHints;
  netlist: NetlistData;
}

export interface UpdateNetlistTypes {
  type: DocActionTypes.UpdateNetlistTypes;
  netlist: NetlistData | null;
  netlistTypes: NetlistTypes;
  netTypeAssignments: { [net: string]: string };
}

export interface StampWireNetTypes {
  type: DocActionTypes.StampWireNetTypes;
  netlist: NetlistData;
}

export interface ApplyAutoLayout {
  type: DocActionTypes.ApplyAutoLayout;
  source: dsnSheet;
  changes: LayoutChange[];
}

export interface ApplyChatEdit {
  type: DocActionTypes.ApplyChatEdit;
  source: dsnDrawing;
  sourceSymbol: import('../../model/tclib').tclibLibraryEntry;
  drawing: dsnDrawing;
}

export interface ApplyChatLibrary {
  type: DocActionTypes.ApplyChatLibrary;
  source: dsnDrawing;
  sourceLibrary: import('../../model/tclib').tclib;
  sourceSymbol: import('../../model/tclib').tclibLibraryEntry;
  library: import('../../model/tclib').tclib;
  symbol: import('../../model/tclib').tclibLibraryEntry;
  drawing: dsnDrawing;
}

export type DocActions =
  | ApplyChatLibrary
  | ApplyChatEdit
  | ApplyAutoLayout
  | SetDocument
  | RenameDocument
  | SetFileData
  | BomGenerate
  | BomClose
  | RegisterTSheet
  | UnregisterTSheet
  | AddImage
  | SaveInProgress
  | UpdateNetlistHints
  | UpdateNetlistTypes
  | StampWireNetTypes;
