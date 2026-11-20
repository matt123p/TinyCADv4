import { encodeBoard } from '../pcb/boardCodec';
import { placeUnplacedComponent } from '../pcb/boardPlacement';
import {
  findProjectPath,
  projectFilesChanged,
  projectRequest,
  readProject,
  readProjectBoard,
} from './projects';

export type BoardPlacementInput = Parameters<typeof placeUnplacedComponent>[2];

export async function openProjectBoardWorkspace(
  location: { id: string; rootId: string },
  boardId: string,
) {
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
  let current = await readProjectBoard(project, boardId);
  return {
    path: entry.path,
    board: current.board,
    circuit: current.circuit,
    async place(componentId: string, placement: BoardPlacementInput) {
      const next = await placeUnplacedComponent(
        current.board,
        componentId,
        placement,
      );
      const load = async () =>
        (await import('./projectPcbKernel')).projectPcbKernel();
      const { reviewCircuitCopper } = await import('../pcb/circuitEcoCopper');
      const { candidate, affected, shorts } = await reviewCircuitCopper(
        current.board,
        next,
        load,
      );
      if (shorts.length || affected.length)
        throw new Error(
          'This placement affects existing copper. Review it before placing the component.',
        );
      const data = await encodeBoard(candidate);
      const saved = await projectRequest({
        operation: 'write',
        id: file.id,
        name: file.name,
        folder,
        data,
        version: current.version,
      });
      current = { ...current, board: candidate, data, version: saved.version };
      window.dispatchEvent(new Event(projectFilesChanged));
      return candidate;
    },
  };
}

export type ProjectBoardWorkspace = Awaited<
  ReturnType<typeof openProjectBoardWorkspace>
>;
