import type { BoardWorkspaceSession } from './boardWorkspace';

export const boardOpened = 'tinycad:board-opened';
export const editFootprintLibrary = 'tinycad:edit-footprint-library';
export const circuitOpened = 'tinycad:circuit-opened';
export const confirmCircuitOpen = 'tinycad:confirm-circuit-open';
export const editorHeaderDocument = 'tinycad:editor-header-document';
export const saveActiveBoard = 'tinycad:save-active-board';

export function showOpenedBoard(session: BoardWorkspaceSession) {
  window.dispatchEvent(new CustomEvent(boardOpened, { detail: session }));
}

export function canOpenCircuit() {
  return window.dispatchEvent(new Event(confirmCircuitOpen, { cancelable: true }));
}

declare global {
  interface WindowEventMap {
    'tinycad:editor-header-document': CustomEvent<{ name: string; dirty: boolean } | undefined>;
    'tinycad:board-opened': CustomEvent<BoardWorkspaceSession>;
    'tinycad:save-active-board': CustomEvent<boolean>;
  }
}

export const boardZoomCommand = 'tinycad:board-zoom';
export const boardHistoryCommand = 'tinycad:board-history';
export const boardMenuCommand = 'tinycad:board-menu';
export const confirmBoardClose = 'tinycad:confirm-board-close';

export interface BoardMenuItemState {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface BoardMenuState {
  title: string;
  items: (BoardMenuItemState | null)[];
}

declare global {
  interface WindowEventMap {
    'tinycad:board-zoom': CustomEvent<'in' | 'out'>;
    'tinycad:board-history': CustomEvent<'undo' | 'redo'>;
    'tinycad:board-menu': CustomEvent<string>;
  }
}
