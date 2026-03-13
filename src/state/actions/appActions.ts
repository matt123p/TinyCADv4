import { Action } from 'redux';

export enum AppUiActionTypes {
  ToggleRulers = 'TOGGLE_RULERS',
}

export interface ToggleRulers extends Action {
  type: AppUiActionTypes.ToggleRulers;
}

export type AppUiActions = ToggleRulers;

export function actionToggleRulers(): ToggleRulers {
  return {
    type: AppUiActionTypes.ToggleRulers,
  };
}
