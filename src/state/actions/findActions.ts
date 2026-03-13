import { FindResult } from '../../model/dsnView';

export enum FindActionTypes {
  SetFindSelection = '[Find] SetFindSelection',
}

export interface SetFindSelection {
  type: FindActionTypes.SetFindSelection;
  mode: number;
  selection: FindResult;
}

export type FindActions = SetFindSelection;
