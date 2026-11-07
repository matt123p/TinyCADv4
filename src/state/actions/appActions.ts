import { Action } from 'redux';
import { WireMode } from '../../model/dsnView';

export enum AppUiActionTypes {
  SetWireMode = 'SET_WIRE_MODE',
  ToggleRulers = 'TOGGLE_RULERS',
}

export interface ToggleRulers extends Action {
  type: AppUiActionTypes.ToggleRulers;
}

export interface SetWireMode extends Action {
  type: AppUiActionTypes.SetWireMode;
  mode: WireMode;
}

export function actionSetWireMode(mode: WireMode): SetWireMode {
  return { type: AppUiActionTypes.SetWireMode, mode };
}

export type AppUiActions = ToggleRulers | SetWireMode;

export function actionToggleRulers(): ToggleRulers {
  return {
    type: AppUiActionTypes.ToggleRulers,
  };
}
