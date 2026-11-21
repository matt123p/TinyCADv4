import type { BoardWorkspaceSession } from './boardWorkspace';

export const boardOpened = 'tinycad:board-opened';
export const circuitOpened = 'tinycad:circuit-opened';
export const editorHeaderDocument = 'tinycad:editor-header-document';
export const saveActiveBoard = 'tinycad:save-active-board';

export function showOpenedBoard(session: BoardWorkspaceSession) {
  window.dispatchEvent(new CustomEvent(boardOpened, { detail: session }));
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
export const confirmBoardClose = 'tinycad:confirm-board-close';

declare global {
  interface WindowEventMap {
    'tinycad:board-zoom': CustomEvent<'in' | 'out'>;
    'tinycad:board-history': CustomEvent<'undo' | 'redo'>;
  }
}
