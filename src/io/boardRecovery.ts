import type { BoardDocument } from '../pcb/board';
import { decodeBoard, encodeBoard } from '../pcb/boardCodec';
import {
  deleteRecoveryDraft,
  readRecoveryDraft,
  replaceBoardRecoveryDraft,
} from './projectRecovery';
import type { ProjectRecoveryDraft } from './projectRecovery';
import { digest } from '../util/sha256';

export type BoardRecoveryStatus =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'saved'; revision: number }
  | { kind: 'error'; message: string };

export type BoardRecoverySource = { key: string; version: string };

export function boardRecoveryJournal(
  source: BoardRecoverySource,
  token?: string,
) {
  let status: BoardRecoveryStatus = { kind: 'idle' };
  const listeners = new Set<(status: BoardRecoveryStatus) => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: BoardDocument | undefined;
  let write = Promise.resolve();

  function publish(next: BoardRecoveryStatus) {
    status = next;
    for (const listener of listeners) listener(next);
  }

  return {
    subscribe(listener: (status: BoardRecoveryStatus) => void) {
      listeners.add(listener);
      listener(status);
      return () => {
        listeners.delete(listener);
      };
    },
    schedule(board: BoardDocument) {
      latest = board;
      clearTimeout(timer);
      publish({ kind: 'pending' });
      timer = setTimeout(() => {
        write = write.then(async () => {
          if (latest !== board) return;
          try {
            const data = await encodeBoard(board);
            if (latest !== board) return;
            const next = crypto.randomUUID();
            const written = await replaceBoardRecoveryDraft(
              {
                key: source.key,
                token: next,
                sourceVersion: source.version,
                time: Date.now(),
                data,
              },
              token,
            );
            if (!written)
              throw new Error(
                'Another editor has a recovery copy for this PCB.',
              );
            token = next;
            if (latest === board)
              publish({ kind: 'saved', revision: board.revision });
          } catch (error) {
            if (latest === board)
              publish({
                kind: 'error',
                message: error instanceof Error ? error.message : String(error),
              });
          }
        });
      }, 650);
    },
    async clear() {
      clearTimeout(timer);
      latest = undefined;
      await write;
      try {
        if (token) await deleteRecoveryDraft(source.key, token);
        token = undefined;
        publish({ kind: 'idle' });
      } catch (error) {
        publish({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  };
}

export async function inspectBoardRecovery(
  source: BoardRecoverySource,
  saved: BoardDocument,
  savedDigest?: string,
): Promise<
  | { draft: ProjectRecoveryDraft; board: BoardDocument; conflict: boolean }
  | undefined
> {
  const draft = await readRecoveryDraft(source.key);
  if (!draft) return;
  if (savedDigest && (await digest(draft.data)) === savedDigest) {
    await deleteRecoveryDraft(source.key, draft.token);
    return;
  }
  const board = await decodeBoard(draft.data);
  if (source.version !== 'untitled' && board.boardId !== saved.boardId)
    throw new Error('The recovery copy belongs to a different PCB.');
  return { draft, board, conflict: draft.sourceVersion !== source.version };
}
