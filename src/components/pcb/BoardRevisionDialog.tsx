import React, { useEffect, useState } from 'react';
import {
  Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
} from '@fluentui/react-components';
import type { BoardDocument } from '../../pcb/board';
import type { BoardWorkspaceSession } from '../../io/boardWorkspace';
import {
  compareBoardRelease, readBoardRelease, startBoardRevision,
} from '../../pcb/boardReleaseHistory';
import type { BoardReleaseBaseline } from '../../pcb/boardReleaseHistory';
import { createBoardWorker } from '../../pcb/boardWorker';

export default function BoardRevisionDialog({ board, session, onCreated, onClose }: {
  board: BoardDocument;
  session: BoardWorkspaceSession;
  onCreated(board: BoardDocument): void;
  onClose(): void;
}) {
  const [file, setFile] = useState<File>();
  const [baseline, setBaseline] = useState<BoardReleaseBaseline>();
  const [comparison, setComparison] = useState<Awaited<ReturnType<typeof compareBoardRelease>>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setBaseline(undefined);
    setComparison(undefined);
    setError('');
    setBusy(!!file);
    if (!file) return;
    let active = true;
    let worker: ReturnType<typeof createBoardWorker>;
    async function run() {
      const released = await readBoardRelease(file);
      if (!active) return;
      if (released.board.boardId !== board.boardId)
        throw new Error('Choose a manufacturing release for this PCB.');
      setBaseline(released);
      const circuit = await session.readProjectCircuit?.(board);
      if (!active) return;
      worker = createBoardWorker();
      const preview = await worker.cam(board, circuit);
      const result = await compareBoardRelease(released, board, preview);
      if (active) setComparison(result);
    }
    void run().catch((failure) => {
      if (active) setError(failure instanceof Error ? failure.message : String(failure));
    }).finally(() => {
      worker?.dispose();
      if (active) setBusy(false);
    });
    return () => {
      active = false;
      worker?.dispose();
    };
  }, [board, file, session]);

  function create() {
    try {
      if (session.board !== board) throw new Error('The PCB changed. Run the comparison again.');
      onCreated(session.commit(startBoardRevision(board, baseline)));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  return (
    <Dialog open onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Manufacturing revisions</DialogTitle>
          <DialogContent>
            {board.releaseParent && (
              <p>Working revision based on release {board.releaseParent.id.slice(0, 12)} · revision {board.releaseParent.revision}.</p>
            )}
            <label>
              Manufacturing release ZIP{' '}
              <input
                type="file" accept=".zip,application/zip"
                onChange={(event) => setFile(event.target.files?.[0])}
              />
            </label>
            {busy && <p role="status">Verifying archive and rebuilding current outputs…</p>}
            {error && <p role="alert">{error}</p>}
            {baseline && (
              <>
                <p>Release {baseline.parent.id.slice(0, 12)} · revision {baseline.parent.revision}. Working PCB revision {board.revision}.</p>
                <p>Creating a revision loads the released design into this editor. The edit can be undone. Save when you are ready to update the working file.</p>
              </>
            )}
            {comparison && (
              <>
                {comparison.map(({ name, changes }) => (
                  <details key={name}>
                    <summary>{name} · {changes.length} changes</summary>
                    {changes.length > 0 && (
                      <ul aria-label={name}>
                        {changes.map(({ id, change, name }) => <li key={id}>{change} · {name}</li>)}
                      </ul>
                    )}
                  </details>
                ))}
              </>
            )}
            {baseline && baseline.parent.revision > board.revision &&
              <p>The release is newer than the working PCB.</p>}
          </DialogContent>
          <DialogActions>
            <Button
              appearance="primary"
              disabled={busy || !baseline || baseline.parent.revision > board.revision}
              onClick={create}
            >
              Create revision
            </Button>
            <Button onClick={onClose}>Close</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
