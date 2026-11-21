import React, { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from '@fluentui/react-components';
import type { BoardWorkspaceSession } from '../../io/boardWorkspace';

export default function BoardRecoveryDialog({
  session,
  onSelect,
  onClose,
}: {
  session: BoardWorkspaceSession;
  onSelect(session: BoardWorkspaceSession): void;
  onClose(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const offer = session.recovery;
  async function choose(choice: 'restore' | 'discard') {
    setBusy(true);
    setError('');
    try {
      onSelect(await offer.choose(choice));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(_, data) => !data.open && !busy && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Recover PCB edits</DialogTitle>
          <DialogContent>
            <p>
              {session.path} · Recovery revision {offer.revision} ·{' '}
              {new Date(offer.time).toLocaleString()}
            </p>
            {offer.conflict ? (
              <p>
                The saved board changed after these edits. Open the recovery as
                a separate board and use Save As to keep it.
              </p>
            ) : (
              <p>
                Restore the last recovery copy to continue editing this board.
              </p>
            )}
            {error && <p role="alert">{error}</p>}
          </DialogContent>
          <DialogActions>
            <Button
              appearance="primary"
              disabled={busy}
              onClick={() => {
                void choose('restore');
              }}
            >
              {offer.conflict ? 'Open recovery copy' : 'Restore edits'}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                void choose('discard');
              }}
            >
              Discard recovery and open saved
            </Button>
            <Button disabled={busy} onClick={onClose}>
              Cancel opening
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
