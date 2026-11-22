import { isProjectFile } from '../../shared/projectFiles';
import {
  decodeProjectSettings,
  encodeProjectSettings,
} from '../pcb/projectSettings';
import type { ProjectSettings } from '../pcb/projectSettings';
import { digest } from '../util/sha256';
import {
  deleteProjectFileJournal,
  readProjectFileJournal,
  writeProjectFileJournal,
} from './projectRecovery';
import type { ProjectTrashJournal } from './projectRecovery';
import { inProjectTransaction } from './projectReferenceTransaction';
import type { ProjectItem } from './projectStorage';
import {
  findProjectPath,
  projectRequest,
  readProject,
  readProjectBoard,
} from './projects';

type Source = ProjectTrashJournal['source'];

function trashImpact(settings: ProjectSettings, source: Source) {
  const target = source.path.toLowerCase();
  const entries = settings.entries.filter(({ path }) => {
    const name = path.toLowerCase();
    return (
      name === target || (source.directory && name.startsWith(target + '/'))
    );
  });
  const schematics = new Set(
    entries.filter(({ kind }) => kind === 'schematic').map(({ id }) => id),
  );
  const boards = new Set(
    entries.filter(({ kind }) => kind === 'board').map(({ id }) => id),
  );
  const associations =
    settings.associations?.filter(
      ({ schematic, board }) => schematics.has(schematic) || boards.has(board),
    ) ?? [];
  const detachedBoards = new Set(associations.map(({ board }) => board));
  const recipes =
    settings.outputRecipes?.filter((recipe) =>
      recipe.kind === 'pcb'
        ? boards.has(recipe.board)
        : schematics.has(recipe.schematic) ||
          boards.has(recipe.board) ||
          detachedBoards.has(recipe.board),
    ) ?? [];
  return { entries, schematics, boards, associations, recipes };
}

function withoutTrashedLinks(
  settings: ProjectSettings,
  impact: ReturnType<typeof trashImpact>,
): ProjectSettings {
  const { entries, schematics, boards, associations, recipes } = impact;
  return {
    ...settings,
    entries: settings.entries.filter((entry) => !entries.includes(entry)),
    primarySchematic: schematics.has(settings.primarySchematic)
      ? undefined
      : settings.primarySchematic,
    primaryBoard: boards.has(settings.primaryBoard)
      ? undefined
      : settings.primaryBoard,
    associations: settings.associations?.filter(
      (association) => !associations.includes(association),
    ),
    outputRecipes: settings.outputRecipes?.filter(
      (recipe) => !recipes.includes(recipe),
    ),
  };
}

function identityOf(item: Pick<ProjectItem, 'folder' | 'id'>) {
  return projectRequest({
    operation: item.folder ? 'folder-identity' : 'fingerprint',
    id: item.id,
  });
}

async function findTrashSource(
  source: Source,
): Promise<ProjectItem | undefined> {
  const matches = (
    await projectRequest({
      operation: 'list',
      folder: source.folder,
      tree: true,
    })
  ).filter(({ name }) => name.toLowerCase() === source.name.toLowerCase());
  const [item] = matches;
  if (
    matches.length > 1 ||
    (item &&
      (item.id !== source.id ||
        item.name !== source.name ||
        item.folder !== source.directory ||
        item.unsupported))
  )
    throw new Error(
      'The file selected for trash changed. Refresh the project and try again.',
    );
  return item;
}

async function writeMarker(
  {
    key,
    root,
    markerName,
  }: Pick<ProjectTrashJournal, 'key' | 'root' | 'markerName'>,
  data: Uint8Array,
  version: string,
) {
  return projectRequest({
    operation: 'write',
    id: key,
    folder: root,
    name: markerName,
    data,
    version,
  });
}

/** Recover while holding the project lock. The item's presence decides which settings to retain. */
export async function recoverProjectTrash(journal: ProjectTrashJournal) {
  const [marker, item] = await Promise.all([
    projectRequest({ operation: 'read', id: journal.key }),
    findTrashSource(journal.source),
  ]);
  const before = await digest(journal.before);
  const after = await digest(journal.after);
  const current = await digest(marker.data);
  let wasDetached = current === after;
  let wasLinked = current === before;
  let rollbackData = journal.before;
  let detachedData = journal.after;

  if (!wasDetached && !wasLinked) {
    // An independent title or author edit can survive a failed trash operation.
    const settings = decodeProjectSettings(marker.data);
    const { title, author } = settings;
    const currentCanonical = await digest(encodeProjectSettings(settings));
    rollbackData = encodeProjectSettings({
      ...decodeProjectSettings(journal.before),
      title,
      author,
    });
    detachedData = encodeProjectSettings({
      ...decodeProjectSettings(journal.after),
      title,
      author,
    });
    wasLinked = currentCanonical === (await digest(rollbackData));
    wasDetached = currentCanonical === (await digest(detachedData));
  }
  if (
    (!wasDetached && !wasLinked) ||
    (item && (await identityOf(item)) !== journal.identity)
  )
    throw new Error(
      'The project changed during a trash operation. The recovery copy has been retained.',
    );

  if (item && wasDetached)
    await writeMarker(journal, rollbackData, marker.version);
  if (!item && wasLinked)
    await writeMarker(journal, detachedData, marker.version);
  await deleteProjectFileJournal(journal.key);
  return !item;
}

export async function previewProjectTrash(
  key: string,
  root: string,
  source: Source,
) {
  if (source.id === key || isProjectFile(source.name))
    throw new Error('Close this project before moving its settings to trash.');
  const project = await readProject(key, root);
  const item = await findProjectPath(root, source.path, source.directory);
  if (item?.id !== source.id || !(await findTrashSource(source)))
    throw new Error(
      'The file selected for trash changed. Refresh the project and try again.',
    );
  const impact = trashImpact(project.settings, source);
  const names = new Map(
    project.settings.entries.map(({ kind, id, path }) => [
      kind + ':' + id,
      path,
    ]),
  );
  return {
    key,
    root,
    source,
    markerName: project.marker.name,
    version: project.version,
    identity: await identityOf(item),
    removedPaths: impact.entries.map(({ path }) => path),
    removesNativeDesigns: !!(impact.schematics.size || impact.boards.size),
    removedAssociations: impact.associations.map(({ schematic, board }) => ({
      schematic: names.get('schematic:' + schematic),
      board: names.get('board:' + board),
    })),
    removedRecipes: impact.recipes.map(
      ({ directory, filename }) => directory + '/' + filename,
    ),
  };
}

export type ProjectTrashPreview = Awaited<
  ReturnType<typeof previewProjectTrash>
>;

export async function trashProjectPath(
  preview: ProjectTrashPreview,
  isOpen: (id: string) => boolean,
) {
  const { key, root, source } = preview;
  const project = await readProject(key, root);
  await inProjectTransaction(key, async () => {
    if (await readProjectFileJournal(key))
      throw new Error(
        'Reopen the project to recover its previous file operation.',
      );
    const marker = await projectRequest({ operation: 'read', id: key });
    if (
      marker.version !== preview.version ||
      marker.version !== project.version
    )
      throw new Error(
        'The project settings changed. Open a fresh trash preview.',
      );
    const item = await findTrashSource(source);
    const resolved = await findProjectPath(root, source.path, source.directory);
    if (
      !item ||
      resolved?.id !== item.id ||
      (await identityOf(item)) !== preview.identity
    )
      throw new Error('The file changed. Open a fresh trash preview.');
    const impact = trashImpact(project.settings, source);
    if (
      isOpen(item.id) ||
      impact.entries.some(({ path }) => {
        const file = project.files.get(path);
        return file && isOpen(file.id);
      })
    )
      throw new Error(
        'Close the affected project documents before moving them to trash.',
      );

    const trash = {
      operation: 'trash' as const,
      id: item.id,
      directory: item.folder,
    };
    if (!impact.entries.length) {
      await projectRequest(trash);
      return;
    }
    if (isOpen(key))
      throw new Error(
        'Close the project settings tab before moving linked files to trash.',
      );

    const removedSnapshots = new Set(
      impact.entries
        .filter(({ kind }) => kind === 'circuit')
        .map(({ id }) => id),
    );
    if (removedSnapshots.size) {
      for (const entry of project.settings.entries) {
        if (entry.kind !== 'board' || impact.boards.has(entry.id)) continue;
        const { board, circuit } = await readProjectBoard(project, entry.id);
        if (!board.appliedCircuit && removedSnapshots.has(circuit?.snapshotId))
          throw new Error(
            'Apply the circuit to ' +
              entry.path +
              ' before removing its external circuit snapshot.',
          );
      }
    }
    const data = encodeProjectSettings(
      withoutTrashedLinks(project.settings, impact),
    );
    const journal: ProjectTrashJournal = {
      kind: 'trash',
      key,
      root,
      markerName: preview.markerName,
      source,
      identity: preview.identity,
      before: marker.data,
      after: data,
    };
    await writeProjectFileJournal(journal);
    try {
      const written = await writeMarker(journal, data, marker.version);
      const saved = await projectRequest({ operation: 'read', id: key });
      const current = await findTrashSource(source);
      if (
        saved.version !== written.version ||
        !current ||
        (await identityOf(current)) !== preview.identity
      )
        throw new Error('The project changed. Open a fresh trash preview.');
      await projectRequest(trash);
      await deleteProjectFileJournal(key);
    } catch (failure) {
      const pending = await readProjectFileJournal(key);
      if (pending?.kind === 'trash' && (await recoverProjectTrash(pending)))
        return;
      throw failure;
    }
  });
}
