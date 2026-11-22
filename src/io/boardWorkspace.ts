import { BoardHistory, createBoard } from '../pcb/board';
import type { BoardDocument, BoardOperation } from '../pcb/board';
import type { ProjectCircuitInput } from '../pcb/boardParity';
import { decodeBoard, encodeBoard } from '../pcb/boardCodec';
import {
  movePlacedComponent,
  movePlacedGroup,
  placeUnplacedComponent,
} from '../pcb/boardPlacement';
import type { PlacementGroupOperation } from '../pcb/boardPlacement';
import type { CurrentFile } from '../state/stores/altStoreReducer';
import { isBoardFile } from '../../shared/drawingFiles';
import { userManager } from './files';
import { digest } from '../util/sha256';

export type BoardPlacementInput = Parameters<typeof placeUnplacedComponent>[2];
export interface BoardWorkspaceSession {
  readonly path: string;
  readonly key?: string;
  readonly savedVersion?: string;
  readonly projectId?: string;
  readonly board: BoardDocument;
  readonly circuit?: import('../pcb/circuitSnapshot').CircuitSnapshot;
  readProjectCircuit?(board: BoardDocument, source?: 'saved'): Promise<ProjectCircuitInput>;
  place(
    componentId: string,
    placement: BoardPlacementInput,
  ): Promise<BoardDocument>;
  moveGroup(
    componentIds: readonly string[],
    operation: PlacementGroupOperation,
  ): Promise<BoardDocument>;
  readonly dirty: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly canSaveAs: boolean;
  subscribeChange(listener: () => void): () => void;
  commit(candidate: BoardDocument): BoardDocument;
  apply(operations: readonly BoardOperation[]): BoardDocument;
  undo(): BoardDocument;
  redo(): BoardDocument;
  save(saveAs?: boolean): Promise<void>;
}

export async function validatedBoardPlacement(
  board: BoardDocument,
  componentId: string,
  placement: BoardPlacementInput,
) {
  const next = board.footprints?.some(
    ({ componentId: id }) => id === componentId,
  )
    ? movePlacedComponent(board, componentId, placement)
    : await placeUnplacedComponent(board, componentId, placement);
  return reviewPlacement(board, next);
}

async function reviewPlacement(board: BoardDocument, next: BoardDocument) {
  if (board === next) return board;
  const { reviewCircuitCopper } = await import('../pcb/circuitEcoCopper');
  const result = await reviewCircuitCopper(board, next, async () =>
    (await import('./projectPcbKernel')).projectPcbKernel(),
  );
  if (result.shorts.length || result.affected.length)
    throw new Error(
      'This placement affects existing copper. Review it before placing the component.',
    );
  return result.candidate;
}

interface BoardWorkspaceStorage {
  path(): string;
  key?: string;
  version?(): string;
  projectId?: string;
  write(board: BoardDocument, saveAs?: boolean): Promise<void>;
  saved: boolean;
  canSaveAs?: boolean;
  circuit?: BoardWorkspaceSession['circuit'];
  readProjectCircuit?: BoardWorkspaceSession['readProjectCircuit'];
}

export function editableBoardWorkspace(
  initial: BoardDocument,
  storage: BoardWorkspaceStorage,
): BoardWorkspaceSession {
  const history = new BoardHistory(initial);
  let savedRevision = storage.saved ? initial.revision : undefined;
  let writing = false;
  const changeListeners = new Set<() => void>();
  const notifyChange = () => changeListeners.forEach((listener) => listener());

  function changed(board: BoardDocument) {
    if (!writing) notifyChange();
    return board;
  }

  function assertIdle() {
    if (writing)
      throw new Error('Wait for the current PCB operation to finish.');
  }

  return {
    get key() {
      return storage.key;
    },
    projectId: storage.projectId,
    readProjectCircuit: storage.readProjectCircuit,
    subscribeChange(listener) {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    },
    get savedVersion() {
      return storage.version?.();
    },
    get path() {
      return storage.path();
    },
    get board() {
      return history.board;
    },
    get circuit() {
      return history.board.appliedCircuit ?? storage.circuit;
    },
    get dirty() {
      return savedRevision !== history.board.revision;
    },
    get canUndo() {
      return history.canUndo;
    },
    get canRedo() {
      return history.canRedo;
    },
    canSaveAs: !!storage.canSaveAs,
    commit(candidate) {
      assertIdle();
      if (candidate.revision !== history.board.revision)
        throw new Error(
          'The PCB changed while editing. Review the edit again.',
        );
      return changed(history.commit(candidate));
    },
    apply(operations) {
      assertIdle();
      return changed(
        history.apply({
          apiVersion: 1,
          boardId: history.board.boardId,
          expectedRevision: history.board.revision,
          operations,
        }),
      );
    },
    undo() {
      assertIdle();
      return changed(history.undo(history.board.revision));
    },
    redo() {
      assertIdle();
      return changed(history.redo(history.board.revision));
    },
    async place(componentId, placement) {
      assertIdle();
      writing = true;
      try {
        const next = await validatedBoardPlacement(
          history.board,
          componentId,
          placement,
        );
        return next === history.board ? next : changed(history.commit(next));
      } finally {
        writing = false;
        notifyChange();
      }
    },
    async moveGroup(componentIds, operation) {
      assertIdle();
      writing = true;
      try {
        const before = history.board;
        const next = await reviewPlacement(
          before,
          movePlacedGroup(before, componentIds, operation),
        );
        if (next === before) return before;
        return changed(history.commit(next));
      } finally {
        writing = false;
        notifyChange();
      }
    },
    async save(saveAs) {
      assertIdle();
      writing = true;
      try {
        const board = history.board;
        await storage.write(board, saveAs);
        savedRevision = board.revision;
      } finally {
        writing = false;
        notifyChange();
      }
    },
  };
}

function standaloneStorage(
  initial: BoardDocument,
  initialFile: CurrentFile,
  initialVersion = 'untitled',
): BoardWorkspaceStorage {
  let file = initialFile;
  let version = initialVersion;
  const key = () =>
    JSON.stringify([
      'pcb-file',
      typeof file.id === 'string' ? file.id : file.id ? file.name : 'untitled',
      file.id ? initial.boardId : null,
    ]);
  return {
    path: () => file.name,
    get key() {
      return file.id ? key() : undefined;
    },
    version: () => version,
    canSaveAs: true,
    saved: !!file.id,
    async write(next, saveAs) {
      const bytes = await encodeBoard(next);
      const saved = await userManager.saveFile(
        bytes,
        {
          ...file,
          id: saveAs ? null : file.id,
          name: isBoardFile(file.name) ? file.name : 'Board.dpn',
        },
        !saveAs && file.id ? version : undefined,
      );
      version = await digest(bytes);
      file = { ...file, ...saved };
    },
  };
}

export async function openStandaloneBoard(
  bytes: ArrayBuffer | Uint8Array,
  file: CurrentFile,
) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const [board, hash] = await Promise.all([decodeBoard(data), digest(data)]);
  return editableBoardWorkspace(board, standaloneStorage(board, file, hash));
}

export function newStandaloneBoard() {
  const board = createBoard('Untitled PCB', 2, [
    { x: 0, y: 0 },
    { x: 100_000_000, y: 0 },
    { x: 100_000_000, y: 80_000_000 },
    { x: 0, y: 80_000_000 },
  ]);
  return editableBoardWorkspace(
    board,
    standaloneStorage(board, { name: 'Untitled.dpn', id: null }),
  );
}
