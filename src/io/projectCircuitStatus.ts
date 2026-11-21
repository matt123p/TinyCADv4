import type { dsnDrawing } from '../model/dsnDrawing';
import { comparableCircuit } from '../pcb/boardParity';
import type { CircuitSnapshot } from '../pcb/circuitSnapshot';
import { reviewProjectCircuit } from './netlists/activeNetlist';
import { readProjectSchematic } from './projectHierarchy';
import { projectRequest, readProject, readProjectBoard } from './projects';
import type { ProjectCircuitInput } from '../pcb/boardParity';
import type { BoardDocument } from '../pcb/board';

export type CircuitSyncStatus =
  | 'current'
  | 'pending'
  | 'unavailable'
  | 'pcb-references';

export async function currentProjectCircuit(
  location: { id: string; rootId: string },
  board: BoardDocument,
  applied: CircuitSnapshot | undefined,
  activeDrawing: (id: string) => dsnDrawing | undefined,
): Promise<ProjectCircuitInput> {
  try {
    const project = await readProject(location.id, location.rootId);
    const linkedBoard = project.settings.entries.find(
      ({ id, kind }) => id === board.boardId.toLowerCase() && kind === 'board',
    );
    if (!linkedBoard)
      throw new Error('The PCB is no longer linked to this project.');
    const association = project.settings.associations?.find(
      ({ board: id }) => id === linkedBoard.id,
    );
    const embeddedId = board.sourceCircuit?.documentId.toLowerCase();
    if (association && embeddedId && association.schematic !== embeddedId)
      throw new Error(
        'The PCB source circuit and project schematic association disagree.',
      );
    const sourceId = association?.schematic ?? embeddedId;
    if (!sourceId) return { state: 'unlinked' };
    const entry = project.settings.entries.find(
      ({ id, kind }) => id === sourceId && kind === 'schematic',
    );
    if (!entry) throw new Error('The project source schematic is missing.');
    const opened = new Map<string, dsnDrawing>();
    const openDrawing = (id: string) => {
      const drawing = activeDrawing(id);
      if (drawing) opened.set(id, drawing);
      return drawing;
    };
    const versions = new Map([[location.id, project.version]]);
    const readSchematic: typeof readProjectSchematic = (loaded, link) =>
      readProjectSchematic(loaded, link, (fileId, version) => {
        if (versions.has(fileId) && versions.get(fileId) !== version)
          throw new Error(
            'A schematic changed during the check. Run the PCB checks again.',
          );
        versions.set(fileId, version);
      });
    const drawing =
      openDrawing(entry.id) ?? (await readSchematic(project, entry));
    const { snapshot } = await reviewProjectCircuit(
      { ...location, entryId: entry.id },
      drawing,
      applied,
      undefined,
      openDrawing,
      readSchematic,
    );
    await Promise.all(
      [...versions].map(async ([id, expected]) => {
        if (
          (await projectRequest({ operation: 'read', id })).version !== expected
        )
          throw new Error(
            'The project changed during the check. Run the PCB checks again.',
          );
      }),
    );
    if ([...opened].some(([id, source]) => activeDrawing(id) !== source))
      throw new Error(
        'A schematic changed during the check. Run the PCB checks again.',
      );
    return { state: 'resolved', snapshot, applied };
  } catch (error) {
    return {
      state: 'unavailable',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function projectCircuitStatus(
  project: Awaited<ReturnType<typeof readProject>>,
  rootId: string,
  boardId: string,
  openDrawing: dsnDrawing | undefined,
): Promise<{ status: CircuitSyncStatus; detail?: string }> {
  try {
    const { board, circuit } = await readProjectBoard(project, boardId);
    if (!circuit) return { status: 'unavailable' };
    const entry = project.settings.entries.find(
      ({ id, kind }) => kind === 'schematic' && id === circuit.documentId,
    );
    if (!entry) return { status: 'unavailable' };
    const drawing =
      openDrawing?.documentId === entry.id
        ? openDrawing
        : await readProjectSchematic(project, entry);
    const { snapshot } = await reviewProjectCircuit(
      { id: project.marker.id, rootId, entryId: entry.id },
      drawing,
      circuit,
      undefined,
      (id) => (openDrawing?.documentId === id ? openDrawing : undefined),
    );
    if (comparableCircuit(snapshot) !== comparableCircuit(circuit))
      return { status: 'pending' };
    const references = new Map(
      circuit.components.map(({ id, reference }) => [id, reference]),
    );
    if (
      board.components?.some(
        ({ id, logicalId, role, reference }) =>
          role !== 'pcb-only' &&
          reference &&
          references.has(logicalId ?? id) &&
          references.get(logicalId ?? id) !== reference,
      )
    )
      return { status: 'pcb-references' };
    return { status: 'current' };
  } catch (error) {
    return {
      status: 'unavailable',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
