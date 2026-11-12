import undoable from 'redux-undo';

import { StateWithHistory } from 'redux-undo';
import { activeSheet, docStore, DocStoreReducer } from '../stores/docStoreReducer';
import { AppActionTypes } from '../dispatcher/AppDispatcher';
import { MenuActionTypes } from '../actions/menuActions';
import { altStore } from '../stores/altStoreReducer';
import { SymbolActionTypes } from '../actions/symbolActions';
import { LibraryActionTypes } from '../actions/libraryActions';
import { DocActionTypes } from '../actions/docActions';

let lastEvent = new Date();
let needHistory = false;

export interface docDrawing {
  docStore: StateWithHistory<docStore>;
  altStore: altStore;
}

const reduceWithHistory = undoable(DocStoreReducer, {
  filter: (
    action: AppActionTypes,
    currentState: docStore,
    previousHistory: StateWithHistory<docStore>,
  ) => {
    if (action.type === 'simulation/diagnostics' || action.type === 'simulation/panel') return false;
    const now = new Date();
    needHistory =
      needHistory ||
      currentState.drawing != previousHistory._latestUnfiltered?.drawing;
    let undoCheckpoint = now.getTime() - lastEvent.getTime() > 500;
    if (action.type.startsWith('simulation/') || action.type === MenuActionTypes.MenuCommand || action.type === DocActionTypes.ApplyAutoLayout) {
      undoCheckpoint = true;
    }
    if (
      action.type === SymbolActionTypes.SymbolEditOutline ||
      action.type === SymbolActionTypes.SymbolEditSymbol ||
      action.type === SymbolActionTypes.ReplaceSymbol
    ) {
      undoCheckpoint = true;
    }
    if (action.type === LibraryActionTypes.SetPPP) {
      if (
        currentState.editSymbol !==
        previousHistory._latestUnfiltered?.editSymbol
      ) {
        needHistory = true;
      }
      undoCheckpoint = true;
    }
    if (!!currentState.view.add) {
      undoCheckpoint = false;
    }

    if (undoCheckpoint) {
      lastEvent = now;
    }

    const r = undoCheckpoint && needHistory;

    if (r) {
      needHistory = false;
    }

    return r;
  },
  ignoreInitialState: true,
});

export function DocStoreWithHistory(
  state: StateWithHistory<docStore> | undefined,
  action: AppActionTypes,
): StateWithHistory<docStore> {
  if (
    state && action.type === DocActionTypes.ApplyAutoLayout && action.changes.length &&
    activeSheet(state.present) === action.source &&
    !state.present.editSymbol && !state.present.editLibrary
  ) {
    // clearHistory omits the initial checkpoint. Layout always needs the exact
    // current sheet as its undo baseline, including immediately after opening.
    state = { ...state, _latestUnfiltered: state.present };
  }
  return reduceWithHistory(state, action);
}
