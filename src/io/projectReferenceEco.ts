import type { dsnDrawing } from '../model/dsnDrawing';
import { encodeBoard } from '../pcb/boardCodec';
import { validateBoard } from '../pcb/board';
import { circuitConnectivityDigest } from '../pcb/circuitSnapshot';
import { canonicalDeviceJson } from '../pcb/deviceLibrary';
import {
  applyBackAnnotation,
  editBoardReferences,
  previewBackAnnotation,
} from '../pcb/referenceEco';
import type { ReferenceConflictChoice } from '../pcb/referenceEco';
import {
  checkReferenceVersions,
  replaceReferenceFile,
  replaceReferencePair,
} from './projectReferenceTransaction';
import type { ReferenceFile } from './projectReferenceTransaction';
import { decodeDrawing, encodeDrawing } from './dsnCodec';
import { reviewProjectCircuit } from './netlists/activeNetlist';
import {
  findProjectPath,
  projectFilesChanged,
  projectRequest,
  readProject,
  readProjectBoard,
} from './projects';

type Location = { id: string; rootId: string };
async function linkedFile(
  location: Location,
  project: Awaited<ReturnType<typeof readProject>>,
  path: string,
): Promise<ReferenceFile> {
  const file = project.files.get(path);
  if (!file) throw new Error(`Missing project file: ${path}.`);
  const directory = path.split('/').slice(0, -1).join('/');
  const folder = directory
    ? (await findProjectPath(location.rootId, directory, true))?.id
    : location.rootId;
  if (!folder) throw new Error(`Missing project folder for ${path}.`);
  return {
    ...file,
    folder,
    ...(await projectRequest({ operation: 'read', id: file.id })),
  };
}

export async function openBoardReferenceEdit(
  location: Location,
  boardId: string,
) {
  const project = await readProject(location.id, location.rootId);
  const entry = project.settings.entries.find(
    ({ kind, id }) => kind === 'board' && id === boardId,
  );
  if (!entry) throw new Error('The PCB is no longer linked to the project.');
  const file = await linkedFile(location, project, entry.path);
  const { board, version } = await readProjectBoard(project, boardId);
  if (version !== file.version)
    throw new Error('The PCB changed. Reopen the reference editor.');
  return {
    title: entry.path,
    components: board.components ?? [],
    async apply(edits: ReadonlyMap<string, string>) {
      await checkReferenceVersions([file]);
      const data = await encodeBoard(editBoardReferences(board, edits));
      await replaceReferenceFile(file, data);
      window.dispatchEvent(new Event(projectFilesChanged));
    },
  };
}

export async function openProjectBackAnnotation(
  location: Location,
  boardId: string,
  sourceIsDirty: (id: string) => boolean,
) {
  const project = await readProject(location.id, location.rootId);
  const { board, circuit, version } = await readProjectBoard(project, boardId);
  const boardEntry = project.settings.entries.find(
    ({ kind, id }) => kind === 'board' && id === boardId,
  );
  const sourceEntry = project.settings.entries.find(
    ({ kind, id }) => kind === 'schematic' && id === circuit?.documentId,
  );
  if (!sourceEntry || !circuit?.sources)
    throw new Error(
      'The board needs an applied circuit with schematic source identities.',
    );
  const [sourceFile, boardFile] = await Promise.all([
    linkedFile(location, project, sourceEntry.path),
    linkedFile(location, project, boardEntry.path),
  ]);
  if (boardFile.version !== version)
    throw new Error('The PCB changed. Reopen the preview.');
  const drawing = await decodeDrawing(sourceFile.data);
  function getOpenChild(id: string): undefined {
    if (sourceIsDirty(id))
      throw new Error(
        'Save the open schematic before applying PCB reference changes.',
      );
    return undefined;
  }
  async function compile(root: dsnDrawing) {
    getOpenChild(sourceEntry.id);
    const { snapshot } = await reviewProjectCircuit(
      { ...location, entryId: sourceEntry.id },
      root,
      circuit,
      undefined,
      getOpenChild,
    );
    return snapshot;
  }
  const current = await compile(drawing);
  const preview = (choices?: ReadonlyMap<string, ReferenceConflictChoice>) =>
    previewBackAnnotation(drawing, board, circuit, current, choices);
  return {
    source: boardEntry.path,
    target: sourceEntry.path,
    sourceId: sourceEntry.id,
    drawing,
    preview,
    async apply(choices: ReadonlyMap<string, ReferenceConflictChoice>) {
      const result = applyBackAnnotation(
        drawing,
        board,
        circuit,
        current,
        choices,
      );
      const [recompiled, latest] = await Promise.all([
        compile(result.drawing),
        readProject(location.id, location.rootId),
      ]);
      if (latest.version !== project.version)
        throw new Error('The project settings changed after preview.');
      if (
        canonicalDeviceJson(await compile(drawing)) !==
        canonicalDeviceJson(current)
      )
        throw new Error('The source hierarchy changed after preview.');
      if (
        (await circuitConnectivityDigest(recompiled)) !==
        (await circuitConnectivityDigest(current))
      )
        throw new Error(
          'Back annotation must preserve schematic connectivity.',
        );
      const recompiledRefs = new Map(
        recompiled.components.map(({ id, reference }) => [id, reference]),
      );
      if (
        preview(choices).changes.some(
          ({ componentId, result }) =>
            recompiledRefs.get(componentId) !== result,
        )
      )
        throw new Error(
          'The proposed references could not be compiled back to their original components.',
        );
      const representation = /\.dzn$/i.test(sourceEntry.path)
        ? 'zip-v1'
        : 'xml';
      const [sourceData, boardData] = await Promise.all([
        encodeDrawing(result.drawing, representation),
        encodeBoard(result.board),
      ]);
      getOpenChild(sourceEntry.id);
      const { sourceVersion, boardVersion } = await replaceReferencePair(
        location.id,
        sourceFile,
        sourceData,
        boardFile,
        boardData,
      );
      window.dispatchEvent(new Event(projectFilesChanged));
      return {
        boardId,
        projectId: location.id,
        affectedEntry: sourceEntry.id,
        async restore() {
          getOpenChild(sourceEntry.id);
          const afterBoard = {
            ...boardFile,
            version: boardVersion,
            data: boardData,
          };
          const afterSource = {
            ...sourceFile,
            version: sourceVersion,
            data: sourceData,
          };
          const restored = validateBoard({
            ...board,
            revision: result.board.revision + 1,
          });
          await replaceReferencePair(
            location.id,
            afterSource,
            sourceFile.data,
            afterBoard,
            await encodeBoard(restored),
          );
          window.dispatchEvent(new Event(projectFilesChanged));
        },
      };
    },
  };
}

export type ProjectBackAnnotation = Awaited<
  ReturnType<typeof openProjectBackAnnotation>
>;
export type BoardReferenceEdit = Awaited<
  ReturnType<typeof openBoardReferenceEdit>
>;
export type ProjectReferenceUndo = Awaited<
  ReturnType<ProjectBackAnnotation['apply']>
>;
