import { digest } from '../util/sha256';
import type { dsnDrawing } from '../model/dsnDrawing';
import type { BoardDocument } from '../pcb/board';
import { decodeBoard, encodeBoard } from '../pcb/boardCodec';
import { openRecoverableBoard } from './boardWorkspace';
import type { BoardWorkspaceSession } from './boardWorkspace';
import {
  findProjectPath,
  projectFilesChanged,
  projectRequest,
  readProject,
  readProjectBoard,
} from './projects';

type BoardFile = { id: string; name: string; folder: string; path: string };

async function openTrackedBoard(
  board: BoardDocument,
  saved: { data: Uint8Array; version: string },
  file: BoardFile,
  key: string,
  options: Pick<
    BoardWorkspaceSession,
    'projectId' | 'circuit' | 'readProjectCircuit'
  > = {},
): Promise<BoardWorkspaceSession> {
  let version = saved.version;
  return openRecoverableBoard(
    board,
    {
      ...options,
      key,
      path: () => file.path,
      version: () => version,
      recoverySource: () => ({ key, version }),
      saved: true,
      async write(candidate) {
        const data = await encodeBoard(candidate);
        const next = await projectRequest({
          operation: 'write',
          id: file.id,
          name: file.name,
          folder: file.folder,
          data,
          version,
        });
        version = next.version;
        window.dispatchEvent(new Event(projectFilesChanged));
      },
    },
    await digest(saved.data),
  );
}

export async function openProjectBoardFile(file: BoardFile, account: string) {
  const saved = await projectRequest({ operation: 'read', id: file.id });
  const board = await decodeBoard(saved.data);
  return openTrackedBoard(
    board,
    saved,
    file,
    JSON.stringify(['pcb-project-file', account, file.id, board.boardId]),
  );
}

export async function openProjectBoardWorkspace(
  location: { id: string; rootId: string },
  boardId: string,
  account: string,
  activeDrawing: (id: string) => dsnDrawing | undefined,
): Promise<BoardWorkspaceSession> {
  const project = await readProject(location.id, location.rootId);
  const entry = project.settings.entries.find(
    ({ kind, id }) => kind === 'board' && id === boardId,
  );
  if (!entry) throw new Error('The board is no longer linked to the project.');
  const directory = entry.path.split('/').slice(0, -1).join('/');
  const folder = directory
    ? (await findProjectPath(location.rootId, directory, true))?.id
    : location.rootId;
  const file = project.files.get(entry.path);
  if (!folder || !file) throw new Error('The PCB file is no longer available.');
  const saved = await readProjectBoard(project, boardId);
  return openTrackedBoard(
    saved.board,
    saved,
    { ...file, folder, path: entry.path },
    JSON.stringify(['pcb-project', account, location.id, file.id, boardId]),
    {
      projectId: project.settings.projectId,
      circuit: saved.circuit,
      async readProjectCircuit(board, source) {
        const { currentProjectCircuit } = await import(
          './projectCircuitStatus'
        );
        const applied =
          board.appliedCircuit ??
          (board.sourceCircuit?.documentId === saved.circuit?.documentId &&
          board.sourceCircuit?.revision === saved.circuit?.revision
            ? saved.circuit
            : undefined);
        return currentProjectCircuit(location, board, applied,
          source === 'saved' ? () => undefined : activeDrawing);
      },
    },
  );
}
