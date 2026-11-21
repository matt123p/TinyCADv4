import React, { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Textarea,
} from '@fluentui/react-components';
import type { GitConflict, GitResolution } from '../../io/projectGit';

interface Props {
  conflict: GitConflict;
  busy: boolean;
  error: string;
  hasUnsaved: boolean;
  onResolve(resolution: GitResolution): void;
  onSaveOpenFiles(): void;
  onClose(): void;
}

export default function ProjectGitConflictDialog({
  conflict,
  busy,
  error,
  hasUnsaved,
  onResolve,
  onSaveOpenFiles,
  onClose,
}: Props) {
  const [result, setResult] = useState(conflict.result ?? '');

  return (
    <Dialog open onOpenChange={(_, data) => !data.open && !busy && onClose()}>
      <DialogSurface className="git-merge-dialog">
        <DialogBody>
          <DialogTitle>Resolve {conflict.path}</DialogTitle>
          <DialogContent>
            <div className="git-merge-versions">
              {['Base', 'Current', 'Incoming'].map((label, index) => {
                const version = conflict.versions[index];
                return (
                  <section key={label} aria-label={label}>
                    <h3>{label}</h3>
                    {version ? (
                      <>
                        <small>
                          {version.id.slice(0, 12)} · {version.size} bytes
                          {version.executable ? ' · Executable' : ''}
                        </small>
                        {version.text !== undefined && (
                          <pre>{version.text}</pre>
                        )}
                      </>
                    ) : (
                      <p>File absent</p>
                    )}
                  </section>
                );
              })}
            </div>
            {conflict.editable ? (
              <label className="git-merge-result">
                Merged result
                <Textarea
                  value={result}
                  onChange={(_, data) => setResult(data.value)}
                  disabled={busy}
                  resize="vertical"
                />
              </label>
            ) : (
              <p>Choose a complete version of this file.</p>
            )}
            {hasUnsaved && (
              <div>
                <p>
                  Resolving the saved file keeps open unsaved edits in their
                  editors.
                </p>
                <Button size="small" disabled={busy} onClick={onSaveOpenFiles}>
                  Save open editor changes first
                </Button>
              </div>
            )}
            {error && <p role="alert">{error}</p>}
          </DialogContent>
          <DialogActions>
            {conflict.editable && (
              <Button
                appearance="primary"
                disabled={busy}
                onClick={() => onResolve({ choice: 'text', text: result })}
              >
                Stage merged result
              </Button>
            )}
            <Button
              disabled={busy}
              onClick={() => onResolve({ choice: 'ours' })}
            >
              {conflict.versions[1]
                ? 'Use current version'
                : 'Use current deletion'}
            </Button>
            <Button
              disabled={busy}
              onClick={() => onResolve({ choice: 'theirs' })}
            >
              {conflict.versions[2]
                ? 'Use incoming version'
                : 'Use incoming deletion'}
            </Button>
            <Button disabled={busy} onClick={onClose}>
              Cancel
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
