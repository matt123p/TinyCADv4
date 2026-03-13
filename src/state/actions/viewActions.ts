// New file to define view option actions
import { Action } from 'redux';
import { Coordinate } from '../../model/dsnItem';

export enum ViewActionTypes {
    SetMousePosition = 'SET_MOUSE_POSITION',
}

export interface SetMousePosition extends Action {
    type: ViewActionTypes.SetMousePosition;
    position: Coordinate | null;
}

export type ViewActions = SetMousePosition;

export function actionSetMousePosition(position: Coordinate | null): SetMousePosition {
    return {
        type: ViewActionTypes.SetMousePosition,
        position,
    };
}
