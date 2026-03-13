import { TSheet } from '../../components/svg/Sheet';
import { FileIdType } from '../../io/files';
import { NetlistData } from '../../io/netlists/netlistGenerator';
import { dsnDrawing, NetlistTypes, Size } from '../../model/dsnDrawing';
import { Coordinate } from '../../model/dsnItem';

export enum DocActionTypes {
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
  netlist: NetlistData;
  netlistTypes: NetlistTypes;
  netTypeAssignments: { [net: string]: string };
}

export type DocActions =
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
  | UpdateNetlistTypes;
