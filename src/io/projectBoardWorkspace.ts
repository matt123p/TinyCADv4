import { isProjectFile } from '../../shared/projectFiles';
import { decodeDrawing } from './dsnCodec';
import { decodeProjectSettings } from '../pcb/projectSettings';
import { childPath } from './hierarchyDrawing';
import { buildHierarchicalNetlist } from '../pcb/hierarchicalNetlist';
import { buildHierarchicalCircuitSnapshot } from '../pcb/hierarchicalSnapshot';
import type { BoardDocument } from '../pcb/board';
import { decodeBoard, encodeBoard } from '../pcb/boardCodec';
import { editableBoardWorkspace } from './boardWorkspace';
import type { BoardWorkspaceSession } from './boardWorkspace';
import { projectRequest } from './projects';
import { projectFilesChanged } from './projectStorage';

type BoardFile = { id: string; name: string; folder: string; path: string };

function openTrackedBoard(
  board: BoardDocument,
  version: string,
  file: BoardFile,
  key: string,
  options: Pick<
    BoardWorkspaceSession,
    'projectId' | 'circuit' | 'readProjectCircuit'
  > = {},
): BoardWorkspaceSession {
  return editableBoardWorkspace(
    board,
    {
      ...options,
      key,
      path: () => file.path,
      version: () => version,
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
  );
}

export async function openProjectBoardFile(file: BoardFile, root: string) {
  const saved = await projectRequest({ operation: 'read', id: file.id });
  const board = await decodeBoard(saved.data);
  const markers = (await projectRequest({ operation: 'list', folder: root, tree: true }))
    .filter(({ name, folder, unsupported }) => !folder && !unsupported && isProjectFile(name));
  const basename = file.path.replaceAll('\\', '/').toLowerCase();
  const settings = async () => {
    for (const marker of markers) {
      const { data } = await projectRequest({ operation: 'read', id: marker.id });
      if (!/<SETTINGS[\s>]/.test(new TextDecoder().decode(data))) continue;
      const project = decodeProjectSettings(data);
      if (project.entries.some(({ kind, id, path }) => kind === 'board' &&
          id === board.boardId && path.toLowerCase() === basename)) return project;
    }
  };
  const project = await settings();
  const linked = project && (board.sourceCircuit || project.associations?.some((entry) => entry.board === board.boardId));
  const readProjectCircuit: BoardWorkspaceSession['readProjectCircuit'] = linked && (async (candidate) => {
    try {
      const current = await settings();
      if (!current) throw new Error('The PCB is no longer linked to this project.');
      const association = current.associations?.find(({ board: id }) => id === candidate.boardId);
      const embedded = candidate.sourceCircuit?.documentId;
      if (association && embedded && association.schematic !== embedded)
        throw new Error('The PCB source circuit and schematic association disagree.');
      const sourceId = association?.schematic ?? embedded;
      if (!sourceId) return { state: 'unlinked' };
      const schematics = current.entries.filter(({ kind }) => kind === 'schematic');
      const entry = schematics.find(({ id }) => id === sourceId);
      if (!entry) throw new Error('The project source schematic is missing.');
      const separator = root.includes('\\') ? '\\' : '/';
      const files = new Map<string, string>();
      async function read(path: string, id?: string) {
        const filename = root.replace(/[\\/]$/, '') + separator + path.replaceAll('/', separator);
        const { data, version } = await projectRequest({ operation: 'read', id: filename });
        files.set(filename, version);
        const drawing = await decodeDrawing(data, new Map());
        return { path, drawing: { ...drawing, documentId: id ?? drawing.documentId } };
      }
      const graph = await buildHierarchicalNetlist(await read(entry.path, entry.id), (parent, link) => {
        const linked = link.documentId && schematics.find(({ id }) => id === link.documentId);
        return linked ? read(linked.path, linked.id) : read(childPath(link, parent.path));
      });
      const applied = candidate.appliedCircuit;
      const { snapshot } = await buildHierarchicalCircuitSnapshot(graph, {
        documentId: sourceId, revision: (candidate.sourceCircuit?.revision ?? 0) + 1, previous: applied?.nets,
      });
      for (const [id, version] of files) {
        if (await projectRequest({ operation: 'fingerprint', id }) !== version)
          throw new Error('The schematic changed during PCB checks. Run the checks again.');
      }
      return { state: 'resolved', snapshot, applied };
    } catch (error) {
      return { state: 'unavailable', detail: error instanceof Error ? error.message : String(error) };
    }
  });
  return openTrackedBoard(
    board,
    saved.version,
    file,
    JSON.stringify(['pcb-project-file', file.id, board.boardId]),
    { projectId: project?.projectId, readProjectCircuit },
  );
}
