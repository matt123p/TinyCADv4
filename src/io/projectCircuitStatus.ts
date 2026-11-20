import type { dsnDrawing } from '../model/dsnDrawing';
import { canonicalDeviceJson } from '../pcb/deviceLibrary';
import type { CircuitSnapshot } from '../pcb/circuitSnapshot';
import { reviewProjectCircuit } from './netlists/activeNetlist';
import { readProjectSchematic } from './projectHierarchy';
import { readProjectBoard } from './projects';
import type { readProject } from './projects';

export type CircuitSyncStatus =
  | 'current'
  | 'pending'
  | 'unavailable'
  | 'pcb-references';

function comparable({ snapshotId, revision, ...content }: CircuitSnapshot) {
  return canonicalDeviceJson(content);
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
    if (comparable(snapshot) !== comparable(circuit))
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
