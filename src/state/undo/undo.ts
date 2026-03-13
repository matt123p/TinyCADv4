import undoable from 'redux-undo';

import { StateWithHistory } from 'redux-undo';
import { docStore, DocStoreReducer } from '../stores/docStoreReducer';
import { AppActionTypes } from '../dispatcher/AppDispatcher';
import { MenuActionTypes } from '../actions/menuActions';
import { altStore } from '../stores/altStoreReducer';
import { SymbolActionTypes } from '../actions/symbolActions';
import { LibraryActionTypes } from '../actions/libraryActions';

let lastEvent = new Date();
let needHistory = false;

export interface docDrawing {
  docStore: StateWithHistory<docStore>;
  altStore: altStore;
}

export const DocStoreWithHistory = undoable(DocStoreReducer, {
  filter: (
    action: AppActionTypes,
    currentState: docStore,
    previousHistory: StateWithHistory<docStore>,
  ) => {
    const now = new Date();
    needHistory =
      needHistory ||
      currentState.drawing != previousHistory._latestUnfiltered?.drawing;
    let undoCheckpoint = now.getTime() - lastEvent.getTime() > 500;
    if (action.type === MenuActionTypes.MenuCommand) {
      undoCheckpoint = true;
    }
    if (
      action.type === SymbolActionTypes.SymbolEditOutline ||
      action.type === SymbolActionTypes.SymbolEditSymbol
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
