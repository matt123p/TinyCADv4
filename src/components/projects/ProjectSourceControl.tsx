import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Textarea,
  Input,
} from '@fluentui/react-components';
import { useSelector } from 'react-redux';
import { cloneProject, projectGit } from '../../io/projectGit';
import type {
  GitChange,
  GitCommit,
  GitConflict,
  GitResolution,
  GitSnapshot,
} from '../../io/projectGit';
import ProjectGitConflictDialog from './ProjectGitConflictDialog';
import { projectFilesChanged } from '../../io/projectStorage';
import type { ProjectLocation } from '../../io/projectStorage';
import type { docDrawing } from '../../state/undo/undo';

export type GitReview = {
  title: string;
  text: string;
  hunks?: string[];
  stageHunk?: (index: number) => void;
};

type Props = {
  root?: ProjectLocation;
  openFolder(): void;
  setCount(count: number): void;
  setAvailable(available: boolean): void;
  historyRequest?: { filename: string };
  openReview(review?: GitReview): void;
  boardDirty(): boolean;
  supportingFilesDirty(): boolean;
  saveOpenFiles(): Promise<void>;
  refreshOpenFiles(repository: string): Promise<void>;
};

const changed = (code: string) =>
  ({
    '?': 'Untracked',
    A: 'Added',
    M: 'Modified',
    D: 'Deleted',
    R: 'Renamed',
    C: 'Copied',
    T: 'Type changed',
    U: 'Conflicted',
  }[code] ?? code);
const description = ({ path, original }: GitChange) =>
  original ? original + ' → ' + path : path;

export default function ProjectSourceControl({
  root,
  openFolder,
  setCount,
  setAvailable,
  historyRequest,
  openReview,
  boardDirty,
  supportingFilesDirty,
  saveOpenFiles,
  refreshOpenFiles,
}: Props) {
  const [snapshot, setSnapshot] = useState<GitSnapshot | null>();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const active = useRef(false);
  const lastHistoryRequest = useRef<typeof historyRequest>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [newBranch, setNewBranch] = useState<string>();
  const [clone, setClone] = useState<{ source: string; name: string }>();
  const [checkout, setCheckout] = useState<
    { command: 'switch-branch'; branch: string } | { command: 'pull' | 'sync' }
  >();
  const [conflict, setConflict] = useState<GitConflict>();
  const [confirmation, setConfirmation] = useState<GitSnapshot>();
  const [history, setHistory] = useState<{
    title: string;
    commits: GitCommit[];
  }>();
  const schematicDirty = useSelector(
    (state: docDrawing) =>
      !!state.altStore.file.project &&
      state.altStore.savedVersion !== state.docStore.present.drawingVersion,
  );
  const id = root?.id;

  function apply(next: GitSnapshot | null) {
    if (!active.current) return;
    setSnapshot(next);
    setAvailable(!!next);
    setCount(next?.changes.filter(({ outside }) => !outside).length ?? 0);
  }

  async function run(operation: () => Promise<void>) {
    if (!active.current || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (error) {
      if (active.current)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }

  function refresh() {
    if (!id) return;
    void run(async () => apply(await projectGit(id, { command: 'status' })));
  }

  useEffect(() => {
    active.current = true;
    refresh();
    window.addEventListener(projectFilesChanged, refresh);
    return () => {
      active.current = false;
      window.removeEventListener(projectFilesChanged, refresh);
    };
  }, [id]);

  function stage(deposit: boolean, path?: string) {
    void run(async () => {
      apply(
        await projectGit(id, { command: deposit ? 'stage' : 'unstage', path }),
      );
      openReview();
    });
  }

  async function review(file: GitChange, staged: boolean) {
    const diff = await projectGit(id, {
      command: 'diff',
      path: file.path,
      staged,
    });
    if (!active.current) return;
    openReview({
      title: (staged ? 'Staged ' : 'Changes to ') + description(file),
      text:
        diff.text || 'No textual differences. Compare or stage the whole file.',
      hunks: diff.hunks,
      stageHunk: (hunk) => {
        void run(async () => {
          const next = await projectGit(id, {
            command: 'stage-hunk',
            path: file.path,
            token: diff.token,
            hunk,
          });
          apply(next);
          const remaining = next.changes.find(
            ({ path, working }) => path === file.path && working !== '.',
          );
          if (remaining) await review(remaining, false);
          else openReview();
        });
      },
    });
  }

  function showHistory(path?: string, direction?: 'incoming' | 'outgoing') {
    void run(async () => {
      const commits = await projectGit(
        id,
        direction ? { command: direction } : { command: 'history', path },
      );
      const title =
        direction === 'incoming'
          ? 'Incoming commits'
          : direction === 'outgoing'
          ? 'Outgoing commits'
          : path
          ? 'History · ' + path
          : 'Commit history';
      if (active.current) setHistory({ title, commits });
    });
  }

  useEffect(() => {
    if (
      !historyRequest ||
      historyRequest === lastHistoryRequest.current ||
      !snapshot ||
      busy ||
      lock.current
    )
      return;
    lastHistoryRequest.current = historyRequest;
    const slash = (value: string) =>
      value.replaceAll(String.fromCharCode(92), '/');
    const prefix = slash(snapshot.root) + '/';
    const filename = slash(historyRequest.filename);
    if (filename.startsWith(prefix)) showHistory(filename.slice(prefix.length));
  }, [historyRequest, snapshot, busy]);

  function performCheckout(save: boolean) {
    if (!snapshot || !checkout) return;
    const before = snapshot;
    const change = checkout;
    void run(async () => {
      if (save) await saveOpenFiles();
      let next: GitSnapshot;
      try {
        next = await projectGit(id, change);
      } catch (error) {
        next = await projectGit(id, { command: 'status' }).catch(
          (): null => null,
        );
        apply(next);
        if (
          next &&
          (next.head !== before.head || next.branch !== before.branch)
        ) {
          setCheckout(undefined);
          await refreshOpenFiles(next.root);
        }
        throw error;
      }
      apply(next);
      setCheckout(undefined);
      openReview();
      if (next.head !== before.head || next.branch !== before.branch)
        await refreshOpenFiles(next.root);
    });
  }

  async function showConflict(path: string) {
    const next = await projectGit(id, { command: 'conflict', path });
    if (active.current) setConflict(next);
  }

  function resolveConflict(resolution: GitResolution) {
    void run(async () => {
      const next = await projectGit(id, {
        command: 'resolve-conflict',
        path: conflict.path,
        token: conflict.token,
        ...resolution,
      });
      apply(next);
      setConflict(undefined);
      openReview();
      await refreshOpenFiles(next.root);
    });
  }

  function changeRows(
    files: GitChange[],
    kind: 'working' | 'index' | 'conflict',
  ) {
    return (
      <ul
        aria-label={
          kind === 'working'
            ? 'Unstaged changes'
            : kind === 'index'
            ? 'Staged changes'
            : 'Conflicts'
        }
      >
        {files.map((file) => (
          <li key={file.path}>
            <div className="git-change">
              <Button
                size="small"
                appearance="subtle"
                disabled={busy || file.outside}
                title={description(file)}
                onClick={() => {
                  void run(() =>
                    kind === 'conflict'
                      ? showConflict(file.path)
                      : review(file, kind === 'index'),
                  );
                }}
              >
                {description(file)}
              </Button>
              <small>
                {kind === 'conflict' ? 'Conflicted' : changed(file[kind])}
                {file.outside ? ' · Outside project' : ''}
              </small>
            </div>
            {!file.outside && (
              <div className="git-actions">
                {kind === 'conflict' ? (
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={() => {
                      void run(() => showConflict(file.path));
                    }}
                  >
                    Resolve…
                  </Button>
                ) : (
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={() => stage(kind !== 'index', file.path)}
                  >
                    {kind === 'index' ? 'Unstage' : 'Stage'}
                  </Button>
                )}
                <Button
                  size="small"
                  disabled={busy}
                  onClick={() => showHistory(file.path)}
                >
                  History
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    );
  }

  const hasUnsaved = schematicDirty || boardDirty() || supportingFilesDirty();
  const staged =
    snapshot?.changes.filter(
      ({ index, conflicted }) => index !== '.' && !conflicted,
    ) ?? [];
  const working =
    snapshot?.changes.filter(
      ({ working, conflicted }) => working !== '.' && !conflicted,
    ) ?? [];
  const conflicts =
    snapshot?.changes.filter(({ conflicted }) => conflicted) ?? [];

  return (
    <section className="project-source-control" aria-label="Source Control">
      <div className="editor-side-panel-header">
        <Button
          size="small"
          disabled={busy}
          onClick={() => {
            setError('');
            setClone({ source: '', name: '' });
          }}
        >
          Clone Repository…
        </Button>
      </div>
      {!root ? (
        <Button onClick={openFolder}>Open Project Folder…</Button>
      ) : (
        <>
          <div className="git-actions">
            <Button size="small" disabled={busy} onClick={refresh}>
              Refresh
            </Button>
            {snapshot && (
              <Button
                size="small"
                disabled={busy}
                onClick={() => showHistory()}
              >
                History
              </Button>
            )}
          </div>
          {error && <p role="alert">{error}</p>}
          {snapshot === null && (
            <Button
              disabled={busy}
              onClick={() => {
                void run(async () =>
                  apply(await projectGit(id, { command: 'init' })),
                );
              }}
            >
              Initialize Repository
            </Button>
          )}
          {snapshot && (
            <>
              <div>
                <strong>{snapshot.branch}</strong>
                <br />
                <small>{snapshot.root}</small>
              </div>
              {!!snapshot.branches.length && (
                <div className="git-actions">
                  <label>
                    Branch{' '}
                    <select
                      value={snapshot.branch}
                      disabled={busy}
                      onChange={(event) => {
                        const branch = event.target.value;
                        if (branch !== snapshot.branch) {
                          setError('');
                          setCheckout({ command: 'switch-branch', branch });
                        }
                      }}
                    >
                      {!snapshot.branches.some(
                        ({ name }) => name === snapshot.branch,
                      ) && (
                        <option value={snapshot.branch}>
                          {snapshot.branch}
                        </option>
                      )}
                      {snapshot.branches.map(({ name, id }) => (
                        <option key={name} title={id.slice(0, 7)} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    size="small"
                    disabled={busy || snapshot.head === '(initial)'}
                    onClick={() => {
                      setError('');
                      setNewBranch('');
                    }}
                  >
                    New branch…
                  </Button>
                </div>
              )}
              {snapshot.upstream && (
                <div className="git-actions">
                  <small>{snapshot.upstream}</small>
                  <Button
                    size="small"
                    disabled={busy || !snapshot.behind}
                    onClick={() => showHistory(undefined, 'incoming')}
                  >
                    {snapshot.behind} incoming
                  </Button>
                  <Button
                    size="small"
                    disabled={busy || !snapshot.ahead}
                    onClick={() => showHistory(undefined, 'outgoing')}
                  >
                    {snapshot.ahead} outgoing
                  </Button>
                </div>
              )}
              {!!snapshot.remotes.length && (
                <div className="git-actions">
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={() => {
                      void run(async () =>
                        apply(await projectGit(id, { command: 'fetch' })),
                      );
                    }}
                  >
                    Fetch
                  </Button>
                  <Button
                    size="small"
                    disabled={busy || !snapshot.upstream}
                    onClick={() => {
                      setError('');
                      setCheckout({ command: 'pull' });
                    }}
                  >
                    Pull
                  </Button>
                  <Button
                    size="small"
                    disabled={busy || !snapshot.upstream}
                    onClick={() => {
                      void run(async () =>
                        apply(await projectGit(id, { command: 'push' })),
                      );
                    }}
                  >
                    Push
                  </Button>
                  <Button
                    size="small"
                    disabled={busy || !snapshot.upstream}
                    onClick={() => {
                      setError('');
                      setCheckout({ command: 'sync' });
                    }}
                  >
                    Sync Changes
                  </Button>
                </div>
              )}
              {hasUnsaved && (
                <div>
                  <p>Open project files have unsaved edits.</p>
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={() => {
                      void run(async () => {
                        await saveOpenFiles();
                        apply(await projectGit(id, { command: 'status' }));
                      });
                    }}
                  >
                    Save open project files
                  </Button>
                </div>
              )}
              <Textarea
                aria-label="Commit message"
                value={message}
                onChange={(_, data) => setMessage(data.value)}
              />
              <Button
                disabled={
                  busy ||
                  !message.trim() ||
                  !staged.length ||
                  !!conflicts.length
                }
                onClick={() => {
                  void run(async () => {
                    const next = await projectGit(id, { command: 'status' });
                    apply(next);
                    if (next) setConfirmation(next);
                  });
                }}
              >
                Review commit
              </Button>
              {!!conflicts.length && (
                <>
                  <h3>Conflicts</h3>
                  {changeRows(conflicts, 'conflict')}
                </>
              )}
              <h3>Staged changes</h3>
              <Button
                size="small"
                disabled={busy || !staged.some(({ outside }) => !outside)}
                onClick={() => stage(false)}
              >
                Unstage project files
              </Button>
              {changeRows(staged, 'index')}
              <h3>Changes</h3>
              <Button
                size="small"
                disabled={busy || !working.some(({ outside }) => !outside)}
                onClick={() => stage(true)}
              >
                Stage project files
              </Button>
              {changeRows(working, 'working')}
            </>
          )}
        </>
      )}
      {conflict && (
        <ProjectGitConflictDialog
          key={conflict.token}
          conflict={conflict}
          busy={busy}
          error={error}
          hasUnsaved={hasUnsaved}
          onResolve={resolveConflict}
          onSaveOpenFiles={() => {
            void run(async () => {
              await saveOpenFiles();
              await showConflict(conflict.path);
            });
          }}
          onClose={() => setConflict(undefined)}
        />
      )}
      {clone && (
        <Dialog
          open
          onOpenChange={(_, data) => !data.open && !busy && setClone(undefined)}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Clone Repository</DialogTitle>
              <DialogContent className="git-dialog-fields">
                <label>
                  Repository URL or local path
                  <Input
                    value={clone.source}
                    onChange={(_, data) =>
                      setClone({ ...clone, source: data.value })
                    }
                  />
                </label>
                <label>
                  Destination folder name
                  <Input
                    value={clone.name}
                    onChange={(_, data) =>
                      setClone({ ...clone, name: data.value })
                    }
                  />
                </label>
                {error && <p role="alert">{error}</p>}
              </DialogContent>
              <DialogActions>
                <Button
                  appearance="primary"
                  disabled={busy || !clone.source.trim() || !clone.name.trim()}
                  onClick={() => {
                    void run(async () => {
                      const folder = await cloneProject(
                        clone.source,
                        clone.name.trim(),
                      );
                      if (folder && active.current) setClone(undefined);
                    });
                  }}
                >
                  Choose parent folder and clone
                </Button>
                <Button disabled={busy} onClick={() => setClone(undefined)}>
                  Cancel
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
      {newBranch !== undefined && (
        <Dialog
          open
          onOpenChange={(_, data) =>
            !data.open && !busy && setNewBranch(undefined)
          }
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>New branch</DialogTitle>
              <DialogContent className="git-dialog-fields">
                <label>
                  Branch name
                  <Input
                    value={newBranch}
                    onChange={(_, data) => setNewBranch(data.value)}
                  />
                </label>
                {error && <p role="alert">{error}</p>}
              </DialogContent>
              <DialogActions>
                <Button
                  appearance="primary"
                  disabled={busy || !newBranch.trim()}
                  onClick={() => {
                    void run(async () => {
                      apply(
                        await projectGit(id, {
                          command: 'create-branch',
                          branch: newBranch.trim(),
                        }),
                      );
                      setNewBranch(undefined);
                    });
                  }}
                >
                  Create branch
                </Button>
                <Button disabled={busy} onClick={() => setNewBranch(undefined)}>
                  Cancel
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
      {checkout && (
        <Dialog
          open
          onOpenChange={(_, data) =>
            !data.open && !busy && setCheckout(undefined)
          }
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>
                {checkout.command === 'switch-branch'
                  ? 'Switch branch'
                  : checkout.command === 'pull'
                  ? 'Pull changes'
                  : 'Sync Changes'}
              </DialogTitle>
              <DialogContent>
                <p>
                  {checkout.command === 'switch-branch'
                    ? 'Switch this repository to ' + checkout.branch + '.'
                    : 'Update this checkout from ' + snapshot.upstream + '.'}
                </p>
                {hasUnsaved && (
                  <p>
                    Open edits can be saved first or retained in their editors.
                  </p>
                )}
                {error && <p role="alert">{error}</p>}
              </DialogContent>
              <DialogActions>
                {hasUnsaved && (
                  <Button
                    appearance="primary"
                    disabled={busy}
                    onClick={() => performCheckout(true)}
                  >
                    Save and continue
                  </Button>
                )}
                <Button
                  appearance={hasUnsaved ? 'secondary' : 'primary'}
                  disabled={busy}
                  onClick={() => performCheckout(false)}
                >
                  {hasUnsaved ? 'Retain edits and continue' : 'Continue'}
                </Button>
                <Button disabled={busy} onClick={() => setCheckout(undefined)}>
                  Cancel
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
      {confirmation && (
        <Dialog
          open
          onOpenChange={(_, data) =>
            !data.open && !busy && setConfirmation(undefined)
          }
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Commit staged changes</DialogTitle>
              <DialogContent>
                <p className="git-message">{message}</p>
                <ul>
                  {confirmation.changes
                    .filter(
                      ({ index, conflicted }) => index !== '.' && !conflicted,
                    )
                    .map((file) => (
                      <li key={file.path}>
                        {description(file)}
                        {file.outside ? ' · Outside project' : ''}
                      </li>
                    ))}
                </ul>
                {error && <p role="alert">{error}</p>}
              </DialogContent>
              <DialogActions>
                <Button
                  appearance="primary"
                  disabled={busy}
                  onClick={() => {
                    void run(async () => {
                      apply(
                        await projectGit(id, {
                          command: 'commit',
                          message,
                          token: confirmation.stagedToken,
                        }),
                      );
                      setConfirmation(undefined);
                      setMessage('');
                      openReview();
                    });
                  }}
                >
                  Commit
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => setConfirmation(undefined)}
                >
                  Cancel
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
      {history && (
        <Dialog
          open
          onOpenChange={(_, data) => !data.open && setHistory(undefined)}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>{history.title}</DialogTitle>
              <DialogContent>
                {!history.commits.length && <p>No commits yet.</p>}
                <ul className="git-history">
                  {history.commits.map((commit) => (
                    <li key={commit.id}>
                      <Button
                        disabled={busy}
                        appearance="subtle"
                        onClick={() => {
                          void run(async () => {
                            const text = await projectGit(id, {
                              command: 'revision',
                              id: commit.id,
                            });
                            if (!active.current) return;
                            openReview({
                              title: commit.short + ' · ' + commit.subject,
                              text,
                            });
                            setHistory(undefined);
                          });
                        }}
                      >
                        {commit.subject}
                      </Button>
                      <small>
                        {commit.short} · {commit.date}
                        {commit.parents.length > 0 &&
                          ' · Parents ' +
                            commit.parents
                              .map((parent) => parent.slice(0, 7))
                              .join(', ')}
                      </small>
                    </li>
                  ))}
                </ul>
                {error && <p role="alert">{error}</p>}
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setHistory(undefined)}>Close</Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
    </section>
  );
}
