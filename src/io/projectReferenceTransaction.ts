import { digest } from '../util/sha256';
import {
  deleteReferenceJournal,
  readReferenceJournal,
  writeReferenceJournal,
} from './projectRecovery';
import type { ReferenceRecoveryJournal } from './projectRecovery';
import { projectRequest } from './projects';

export type ReferenceFile = {
  id: string;
  folder: string;
  name: string;
  data: Uint8Array;
  version: string;
};

const projectLocks = new Map<string, Promise<unknown>>();

function inReferenceTransaction<T>(
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks)
    return navigator.locks.request('tinycad-project-annotation:' + key, run);
  const previous = projectLocks.get(key) ?? Promise.resolve();
  const active = previous.catch(() => undefined as undefined).then(run);
  projectLocks.set(key, active);
  return active.finally(() => {
    if (projectLocks.get(key) === active) projectLocks.delete(key);
  });
}

export async function checkReferenceVersions(files: readonly ReferenceFile[]) {
  const current = await Promise.all(
    files.map(({ id }) => projectRequest({ operation: 'read', id })),
  );
  if (files.some(({ version }, index) => current[index].version !== version))
    throw new Error(
      'The board or schematic changed in storage. Reopen the preview.',
    );
}

export async function replaceReferenceFile(
  file: ReferenceFile,
  data: Uint8Array,
) {
  const desired = await digest(data);
  if (desired === (await digest(file.data))) return file.version;
  try {
    const written = await projectRequest({
      operation: 'write',
      id: file.id,
      folder: file.folder,
      name: file.name,
      version: file.version,
      data,
    });
    return written.version;
  } catch (failure) {
    const current = await projectRequest({ operation: 'read', id: file.id });
    if ((await digest(current.data)) === desired) return current.version;
    throw failure;
  }
}

async function recover(journal: ReferenceRecoveryJournal) {
  const [sourceFile, boardFile] = await Promise.all([
    projectRequest({ operation: 'read', id: journal.source.id }),
    projectRequest({ operation: 'read', id: journal.board.id }),
  ]);
  const [source, board] = await Promise.all([
    digest(sourceFile.data),
    digest(boardFile.data),
  ]);
  if (board === journal.board.after && source === journal.source.after) {
    await deleteReferenceJournal(journal.key);
    return {
      committed: true,
      sourceVersion: sourceFile.version,
      boardVersion: boardFile.version,
    };
  }
  if (
    board !== journal.board.before ||
    (source !== journal.source.before && source !== journal.source.after)
  )
    throw new Error(
      'A saved schematic or PCB was edited after an interrupted reference update. Its recovery copy has been retained.',
    );
  if (source !== journal.source.before)
    await replaceReferenceFile(
      { ...journal.source, ...sourceFile },
      journal.source.data,
    );
  await deleteReferenceJournal(journal.key);
  return {
    committed: false,
    sourceVersion: sourceFile.version,
    boardVersion: boardFile.version,
  };
}

export async function recoverProjectReferenceUpdate(key: string) {
  await inReferenceTransaction(key, async () => {
    const journal = await readReferenceJournal(key).catch(
      (): undefined => undefined,
    );
    if (journal) await recover(journal);
  });
}

export async function replaceReferencePair(
  key: string,
  source: ReferenceFile,
  sourceData: Uint8Array,
  board: ReferenceFile,
  boardData: Uint8Array,
) {
  return inReferenceTransaction(key, async () => {
    const pending = await readReferenceJournal(key);
    if (pending) await recover(pending);
    await checkReferenceVersions([source, board]);
    const [sourceBefore, sourceAfter, boardBefore, boardAfter] =
      await Promise.all(
        [source.data, sourceData, board.data, boardData].map(digest),
      );
    const journal = {
      key,
      source: {
        id: source.id,
        folder: source.folder,
        name: source.name,
        data: source.data,
        before: sourceBefore,
        after: sourceAfter,
      },
      board: { id: board.id, before: boardBefore, after: boardAfter },
    };
    await writeReferenceJournal(journal);
    try {
      const sourceVersion = await replaceReferenceFile(source, sourceData);
      const boardVersion = await replaceReferenceFile(board, boardData);
      await deleteReferenceJournal(key);
      return { sourceVersion, boardVersion };
    } catch (failure) {
      const result = await recover(journal);
      if (result.committed) return result;
      throw failure;
    }
  });
}
