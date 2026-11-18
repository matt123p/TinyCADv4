import { Action } from 'redux';
import { WireMode } from '../../model/dsnView';
import type { ExampleContent } from '../../../shared/bundledExamples';

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

export interface ExampleLoaded extends Action {
  type: 'example/loaded';
  item: ExampleContent;
}

export interface SetExampleExplanationVisible extends Action {
  type: 'example/explanation';
  visible: boolean;
}

export type AppUiActions =
  | ToggleRulers
  | SetWireMode
  | ExampleLoaded
  | SetExampleExplanationVisible;

export function actionToggleRulers(): ToggleRulers {
  return {
    type: AppUiActionTypes.ToggleRulers,
  };
}
