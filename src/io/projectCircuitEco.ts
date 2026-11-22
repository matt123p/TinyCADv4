import { withoutResults } from '../simulation/document';
import { validProjectName } from '../../shared/projectFiles';
import { createBoard, validateBoard } from '../pcb/board';
import {
  decodeProjectSettings,
  encodeProjectSettings,
} from '../pcb/projectSettings';
import type { ProjectLink } from '../pcb/projectSettings';
import type { dsnDrawing } from '../model/dsnDrawing';
import { encodeBoard } from '../pcb/boardCodec';
import { applyCircuitEco, previewCircuitEco } from '../pcb/circuitEco';
import type { CircuitDeviceSelection, CircuitEco } from '../pcb/circuitEco';
import { canonicalDeviceJson } from '../pcb/deviceLibrary';
import { digest } from '../util/sha256';
import { encodeDrawing } from './dsnCodec';
import { reviewProjectCircuit } from './netlists/activeNetlist';
import {
  findProjectPath,
  projectFilesChanged,
  projectRequest,
  readProject,
  readProjectBoard,
} from './projects';
import type { OpenProjectAction } from './projects';
import { readProjectSchematic } from './projectHierarchy';
import { projectDeviceReview } from './projectDevices';
import type { ProjectDeviceReview } from './projectDevices';

export interface ProjectCircuitUndo {
  readonly boardId: string;
  readonly projectId: string;
  readonly fileId: string;
  restore(): Promise<void>;
}

export async function openProjectCircuitEco(
  location: Pick<OpenProjectAction['location'], 'id' | 'rootId'>,
  destination: { boardId: string; sourceId?: string } | { sourceId: string; path: string },
  activeDrawing: (sourceId: string) => dsnDrawing | undefined,
) {
  const project = await readProject(location.id, location.rootId);
  const creating = 'path' in destination;
  const link = creating
    ? undefined
    : project.settings.entries.find(
        ({ kind, id }) => kind === 'board' && id === destination.boardId,
      );
  if (!link && !creating)
    throw new Error('The PCB is no longer linked to the project.');
  const path = creating ? destination.path : link.path;
  const segments = path.split('/');
  const name = segments.at(-1);
  if (!segments.every(validProjectName) || !/\.dpn$/i.test(name))
    throw new Error('Choose a project-relative PCB filename ending in .dpn.');
  const directory = segments.slice(0, -1).join('/');
  const folder = directory
    ? (await findProjectPath(location.rootId, directory, true))?.id
    : location.rootId;
  if (!folder)
    throw new Error('The PCB folder does not exist in this project.');
  const existing = link && (await readProjectBoard(project, link.id));
  const { circuit } = existing ?? {};
  const association =
    link &&
    project.settings.associations?.find(({ board }) => board === link.id);
  const sourceId = creating
    ? destination.sourceId
    : association?.schematic ?? circuit?.documentId ?? destination.sourceId;
  if (!creating && destination.sourceId && destination.sourceId !== sourceId)
    throw new Error('The PCB already has a different source schematic.');
  const entry = project.settings.entries.find(
    ({ kind, id }) => kind === 'schematic' && id === sourceId,
  );
  if (!entry) throw new Error('The board needs a linked source schematic.');
  const file = link && project.files.get(link.path);

  async function checkDestination() {
    const siblings = await projectRequest({
      operation: 'list',
      folder,
      tree: true,
    });
    if (siblings.some((item) => item.name.toLowerCase() === name.toLowerCase()))
      throw new Error('A project item already uses this PCB filename.');
    if (
      project.settings.entries.some(
        (entry) =>
          entry.kind === 'board' &&
          entry.path.split('/').slice(0, -1).join('/').toLowerCase() ===
            directory.toLowerCase(),
      )
    )
      throw new Error('Choose a project folder without an active PCB.');
  }

  if (creating) await checkDestination();
  const board =
    existing?.board ??
    createBoard(name.slice(0, -4), 2, [
      { x: 0, y: 0 },
      { x: 100_000_000, y: 0 },
      { x: 100_000_000, y: 80_000_000 },
      { x: 0, y: 80_000_000 },
    ]);

  async function compile() {
    const latest = await readProject(location.id, location.rootId);
    if (latest.version !== project.version)
      throw new Error(
        'The project settings changed. Open a new circuit preview.',
      );
    const openSources = new Map<string, dsnDrawing>();
    const openDrawing = (id: string) => {
      const source = activeDrawing(id);
      if (source) openSources.set(id, source);
      return source;
    };
    const fromEditor = openDrawing(entry.id);
    const drawing = fromEditor ?? (await readProjectSchematic(latest, entry));
    const sources = new Map<string, Promise<string>>();
    const { snapshot } = await reviewProjectCircuit(
      { ...location, entryId: entry.id },
      drawing,
      circuit,
      (path, source) => {
        if (!sources.has(path))
          sources.set(path, encodeDrawing(withoutResults(source), 'xml').then(digest));
      },
      openDrawing,
    );
    const revisions = await Promise.all(
      [...sources.entries()].map(async ([path, encoding]) => [
        path,
        await encoding,
      ]),
    );
    if ([...openSources].some(([id, source]) => activeDrawing(id) !== source))
      throw new Error(
        'The schematic changed while compiling. Open a new circuit preview.',
      );
    return { snapshot, revisions: canonicalDeviceJson(revisions) };
  }

  const proposed = await compile();
  const selectedDevices = new Map<string, CircuitDeviceSelection>();
  let retainedMechanical = new Set<string>();
  const loadKernel = async () =>
    (await import('./projectPcbKernel')).projectPcbKernel();
  const review = await previewCircuitEco(board, circuit, proposed.snapshot, {
    loadKernel,
  });
  return {
    review,
    sourcePath: entry.path,
    targetPath: path,
    creating,
    boardId: board.boardId,
    async toggleMechanical(componentId: string): Promise<CircuitEco> {
      const next = new Set(retainedMechanical);
      if (next.has(componentId)) next.delete(componentId);
      else next.add(componentId);
      const updated = await previewCircuitEco(
        board,
        circuit,
        proposed.snapshot,
        {
          selectedDevices,
          retainedMechanical: next,
          loadKernel,
        },
      );
      retainedMechanical = next;
      return updated;
    },
    async reviewDevice(
      draft: CircuitEco,
      componentId: string,
      onReview: (review: CircuitEco) => void,
    ): Promise<ProjectDeviceReview> {
      return projectDeviceReview({
        project,
        rootId: location.rootId,
        folder,
        board: draft.candidate,
        circuit: proposed.snapshot,
        componentId,
        activeDrawing,
        async apply({ selection }) {
          const selected = new Map(selectedDevices).set(componentId, selection);
          const updated = await previewCircuitEco(
            board,
            circuit,
            proposed.snapshot,
            { selectedDevices: selected, retainedMechanical, loadKernel },
          );
          selectedDevices.set(componentId, selection);
          onReview(updated);
        },
      });
    },
    async apply(review: CircuitEco): Promise<ProjectCircuitUndo | undefined> {
      const latest = await readProject(location.id, location.rootId);
      const current = link && (await readProjectBoard(latest, link.id));
      if (
        link &&
        (latest.files.get(link.path)?.id !== file.id ||
          current.version !== existing.version)
      )
        throw new Error(
          'The PCB changed after the preview. Open a new circuit preview.',
        );
      const currentBoard = current?.board ?? board;
      const next = applyCircuitEco(currentBoard, review);
      if (next === currentBoard) return;
      const data = await encodeBoard(next);
      if (creating) await checkDestination();
      const fresh = await compile();
      if (
        proposed.revisions !== fresh.revisions ||
        canonicalDeviceJson(fresh.snapshot) !==
          canonicalDeviceJson(proposed.snapshot)
      )
        throw new Error(
          'The schematic changed after the preview. Open a new circuit preview.',
        );
      if (creating) {
        const newLink: ProjectLink = { kind: 'board', id: board.boardId, path };
        const settings = encodeProjectSettings({
          ...latest.settings,
          entries: [...latest.settings.entries, newLink],
          primaryBoard: latest.settings.primaryBoard ?? newLink.id,
          associations: [
            ...(latest.settings.associations ?? []),
            {
              schematic: entry.id,
              board: newLink.id,
            },
          ],
        });
        const written = await projectRequest({
          operation: 'write',
          folder,
          name,
          data,
        });
        try {
          await projectRequest({
            operation: 'write',
            folder: location.rootId,
            id: location.id,
            name: latest.marker.name,
            version: latest.version,
            data: settings,
          });
        } catch (error) {
          // A transport error can also occur after storage accepted the marker write.
          const marker = await projectRequest({
            operation: 'read',
            id: location.id,
          })
            .then(({ data }) => decodeProjectSettings(data))
            .catch((): undefined => undefined);
          if (
            marker &&
            !marker.entries.some(
              ({ kind, id }) => kind === 'board' && id === newLink.id,
            )
          )
            await projectRequest({
              operation: 'trash',
              directory: false,
              id: written.id,
            }).catch((): undefined => undefined);
          if (
            !marker?.entries.some(
              ({ kind, id }) => kind === 'board' && id === newLink.id,
            )
          )
            throw error;
        }
        window.dispatchEvent(new Event(projectFilesChanged));
        return;
      }

      const written = await projectRequest({
        operation: 'write',
        id: file.id,
        folder,
        name,
        data,
        version: current.version,
      });
      window.dispatchEvent(new Event(projectFilesChanged));
      return {
        boardId: board.boardId,
        projectId: location.id,
        fileId: file.id,
        async restore() {
          const updatedProject = await readProject(
            location.id,
            location.rootId,
          );
          const updated = await readProjectBoard(updatedProject, board.boardId);
          const updatedLink = updatedProject.settings.entries.find(
            ({ kind, id }) => kind === 'board' && id === board.boardId,
          );
          if (
            updated.version !== written.version ||
            updatedProject.files.get(updatedLink.path)?.id !== file.id
          )
            throw new Error(
              'The PCB changed after the circuit update. The saved board was left as it is.',
            );
          const restored = validateBoard({
            ...currentBoard,
            revision: updated.board.revision + 1,
          });
          await projectRequest({
            operation: 'write',
            id: file.id,
            folder,
            name,
            data: await encodeBoard(restored),
            version: written.version,
          });
          window.dispatchEvent(new Event(projectFilesChanged));
        },
      };
    },
  };
}

export type ProjectCircuitEco = Awaited<
  ReturnType<typeof openProjectCircuitEco>
>;
