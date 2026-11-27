import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Textarea,
  Input,
} from '@fluentui/react-components';
import {
  AddRegular,
  ArrowClockwiseRegular,
  ArrowUndoRegular,
  BranchForkRegular,
  CheckmarkRegular,
  ChevronDownRegular,
  MoreHorizontalRegular,
  SubtractRegular,
} from '@fluentui/react-icons';
import ProjectGitMaintenance from './ProjectGitMaintenance';
import type { MaintenanceMode } from './ProjectGitMaintenance';
import ProjectGitGraph from './ProjectGitGraph';
import ProjectGitBranches from './ProjectGitBranches';
import { cloneProject, projectGit } from '../../io/projectGit';
import type {
  GitChange,
  GitCommit,
  GitSnapshot,
} from '../../io/projectGit';
import { projectFilesChanged } from '../../io/projectStorage';
import type { ProjectLocation } from '../../io/projectStorage';

type Props = {
  root?: ProjectLocation;
  openFolder(): void;
  setCount(count: number): void;
  onSnapshot(snapshot: GitSnapshot | null): void;
  schematicDirty(): boolean;
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
  onSnapshot,
  schematicDirty,
  supportingFilesDirty,
  saveOpenFiles,
  refreshOpenFiles,
}: Props) {
  const [snapshot, setSnapshot] = useState<GitSnapshot | null>();
  const [busy, setBusy] = useState(false);
  const [maintenance, setMaintenance] = useState<MaintenanceMode>();
  const [graph, setGraph] = useState<GitCommit[]>([]);
  const lock = useRef(false);
  const refreshing = useRef(false);
  const refreshQueued = useRef(false);
  const revision = useRef(0);
  const active = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [branchNotice, setBranchNotice] = useState('');
  const [clone, setClone] = useState<{ source: string; name: string }>();
  const [checkout, setCheckout] = useState<
    | { command: 'switch-branch'; branch: string }
    | { command: 'merge-branch'; branch: string; into: string }
    | { command: 'pull' | 'sync' }
  >();
  const [pendingStage, setPendingStage] = useState<{ path?: string }>();
  const [confirmation, setConfirmation] = useState<GitSnapshot>();
  const [history, setHistory] = useState<{
    title: string;
    commits: GitCommit[];
  }>();
  const id = root?.id;

  function apply(next: GitSnapshot | null) {
    if (!active.current) return;
    setSnapshot(next);
    onSnapshot(next);
    setCount(next?.changes.filter(({ outside }) => !outside).length ?? 0);
  }

  async function run(operation: () => Promise<void>) {
    if (!active.current || lock.current) return;
    lock.current = true;
    revision.current++;
    if (refreshing.current) refreshQueued.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (error) {
      if (active.current)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      lock.current = false;
      if (active.current) {
        setBusy(false);
        if (refreshQueued.current) refresh();
      }
    }
  }

  function refresh() {
    if (!id || !active.current) return;
    if (lock.current || refreshing.current) {
      refreshQueued.current = true;
      return;
    }
    refreshing.current = true;
    refreshQueued.current = false;
    const startedAt = revision.current;
    void projectGit(id, { command: 'status' })
      .then((next) => {
        if (revision.current === startedAt) apply(next);
      })
      .catch((error) => {
        if (active.current && revision.current === startedAt)
          setError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        refreshing.current = false;
        if (refreshQueued.current) refresh();
      });
  }

  useEffect(() => {
    active.current = true;
    refresh();
    const unwatch = window.electronAPI.onProjectFoldersChanged(refresh);
    window.addEventListener(projectFilesChanged, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      unwatch();
      window.removeEventListener('focus', refresh);
      active.current = false;
      window.removeEventListener(projectFilesChanged, refresh);
    };
  }, [id]);

  useEffect(() => {
    if (!id || !snapshot) return;
    let current = true;
    void projectGit(id, { command: 'graph' })
      .then((commits) => {
        if (current) setGraph(commits);
      })
      .catch((error) => {
        if (current)
          setError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      current = false;
    };
  }, [
    id,
    snapshot?.head,
    snapshot?.upstream,
    snapshot?.behind,
    snapshot?.ahead,
  ]);

  function stage(deposit: boolean, path?: string) {
    void run(async () => {
      apply(
        await projectGit(id, { command: deposit ? 'stage' : 'unstage', path }),
      );
      if (deposit) setPendingStage(undefined);
    });
  }

  function changeStaging(deposit: boolean, path?: string) {
    if (deposit && (schematicDirty() || supportingFilesDirty())) {
      setError('');
      setPendingStage({ path });
      return;
    }
    stage(deposit, path);
  }

  function showHistory(
    command: 'history' | 'incoming' | 'outgoing' = 'history',
  ) {
    void run(async () => {
      const commits = await projectGit(id, { command });
      const title =
        command === 'incoming'
          ? 'Incoming commits'
          : command === 'outgoing'
          ? 'Outgoing commits'
          : 'Commit history';
      if (active.current) setHistory({ title, commits });
    });
  }

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
      if (change.command === 'switch-branch')
        setBranchNotice(`Switched to ${next.branch}.`);
      if (change.command === 'merge-branch')
        setBranchNotice(
          `Merge complete. ${next.branch} contains ${change.branch}.`,
        );
      if (next.head !== before.head || next.branch !== before.branch)
        await refreshOpenFiles(next.root);
      window.dispatchEvent(new Event(projectFilesChanged));
    });
  }

  function discard(file: GitChange) {
    if (schematicDirty() || supportingFilesDirty()) {
      setError('Save or close open files before discarding Git changes.');
      return;
    }
    void run(async () => {
      const { token } = await projectGit(id, {
        command: 'diff',
        path: file.path,
        staged: false,
      });
      if (!window.confirm(`Discard the working changes to "${file.path}"?`))
        return;
      const next = await projectGit(id, {
        command: 'discard',
        path: file.path,
        token,
      });
      apply(next);
      await refreshOpenFiles(next.root);
      window.dispatchEvent(new Event(projectFilesChanged));
    });
  }

  function changeGroup(
    files: GitChange[],
    kind: 'working' | 'index' | 'conflict',
  ) {
    const label =
      kind === 'working'
        ? 'Changes'
        : kind === 'index'
        ? 'Staged Changes'
        : 'Merge Changes';
    const stageLabel = kind === 'index' ? 'Unstage' : 'Stage';
    const stageIcon = kind === 'index' ? <SubtractRegular /> : <AddRegular />;
    return (
      <details className="project-git-group" open>
        <summary>
          <span>{label}</span>
          <span className="project-git-count">{files.length}</span>
          {kind !== 'conflict' && (
            <Button
              aria-label={
                kind === 'index'
                  ? 'Unstage project files'
                  : 'Stage project files'
              }
              title={
                kind === 'index'
                  ? 'Unstage project files'
                  : 'Stage project files'
              }
              disabled={busy || !files.some(({ outside }) => !outside)}
              size="small"
              appearance="subtle"
              icon={stageIcon}
              onClick={(event: React.MouseEvent) => {
                event.preventDefault();
                changeStaging(kind !== 'index');
              }}
            />
          )}
        </summary>
        <ul aria-label={label}>
          {files.map((file) => {
            const code = kind === 'conflict' ? 'U' : file[kind];
            const lastSlash = file.path.lastIndexOf('/');
            return (
              <li key={file.path} className="project-git-file">
                <div
                  className="project-git-file-name"
                  title={description(file)}
                >
                  <span>{file.path.slice(lastSlash + 1)}</span>
                  {lastSlash !== -1 && (
                    <small>{file.path.slice(0, lastSlash)}</small>
                  )}
                </div>
                <span
                  className="project-git-file-code"
                  title={file.outside ? 'Outside project' : changed(code)}
                  data-change={code}
                >
                  {code === '?' ? 'U' : code}
                </span>
                {!file.outside && kind !== 'conflict' && (
                  <div className="project-git-file-actions">
                    <Button
                      size="small"
                      appearance="subtle"
                      disabled={busy}
                      aria-label={stageLabel}
                      title={`${stageLabel} ${file.path}`}
                      icon={stageIcon}
                      onClick={() =>
                        changeStaging(kind !== 'index', file.path)
                      }
                    />
                    {kind === 'working' && file.working !== '?' && (
                      <Button
                        size="small"
                        appearance="subtle"
                        disabled={busy}
                        aria-label="Discard Changes"
                        title={`Discard changes to ${file.path}`}
                        icon={<ArrowUndoRegular />}
                        onClick={() => discard(file)}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </details>
    );
  }

  const hasUnsaved = schematicDirty() || supportingFilesDirty();
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
  const hasCommits = !!snapshot && snapshot.head !== '(initial)';
  const hasRemotes = !!snapshot?.remotes.length;
  const hasUpstream = !!snapshot?.upstream;

  function initialize() {
    void run(async () => apply(await projectGit(id, { command: 'init' })));
  }

  function fetchChanges() {
    void run(async () => apply(await projectGit(id, { command: 'fetch' })));
  }

  return (
    <section className="project-source-control" aria-label="Source Control">
      <header className="project-source-control-header side-panel-header">
        <strong>Source Control</strong>
        {root && (
          <Button
            size="small"
            appearance="subtle"
            disabled={busy}
            icon={<ArrowClockwiseRegular />}
            onClick={() => {
              void run(async () =>
                apply(await projectGit(id, { command: 'status' })),
              );
            }}
            aria-label="Refresh source control"
            title="Refresh source control"
          />
        )}
        <Menu>
          <MenuTrigger>
            <Button
              size="small"
              appearance="subtle"
              icon={<MoreHorizontalRegular />}
              aria-label="Repository actions"
              disabled={busy}
            />
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem
                disabled={busy || !root || snapshot !== null}
                onClick={initialize}
              >
                Initialize Repository
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setError('');
                  setClone({ source: '', name: '' });
                }}
              >
                Clone Repository…
              </MenuItem>
              <MenuItem
                disabled={!hasCommits || !!snapshot?.scope}
                onClick={() => {
                  setError('');
                  setMaintenance('stash');
                }}
              >
                Stashes…
              </MenuItem>
              <MenuItem
                disabled={!hasCommits}
                onClick={() => {
                  setError('');
                  setMaintenance('worktrees');
                }}
              >
                Worktrees…
              </MenuItem>
              <MenuItem
                disabled={!hasCommits || hasUpstream || !hasRemotes}
                onClick={() => {
                  setError('');
                  setMaintenance('publish');
                }}
              >
                Publish Branch…
              </MenuItem>
              <MenuItem disabled={!hasCommits} onClick={() => showHistory()}>
                Commit History
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </header>
      {!root ? (
        <Button onClick={openFolder}>Open Project Folder…</Button>
      ) : (
        <>
          {error && <p role="alert">{error}</p>}
          {snapshot === null && (
            <Button disabled={busy} onClick={initialize}>
              Initialize Repository
            </Button>
          )}
          {snapshot && (
            <>
              <div className="project-git-branch-header">
                <Button
                  className="project-current-branch"
                  appearance="secondary"
                  icon={<BranchForkRegular />}
                  title="Manage branches"
                  disabled={busy}
                  onClick={() => {
                    setError('');
                    setBranchNotice('');
                    setBranchesOpen(true);
                  }}
                >
                  <span>
                    <small>Current branch</small>
                    <strong>{snapshot.branch}</strong>
                  </span>
                </Button>
                <Menu>
                  <MenuTrigger>
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={<ChevronDownRegular />}
                      aria-label="Synchronize repository"
                      title="Synchronize repository"
                      disabled={busy}
                    />
                  </MenuTrigger>
                  <MenuPopover>
                    <MenuList>
                      <MenuItem disabled={!hasRemotes} onClick={fetchChanges}>
                        Fetch
                      </MenuItem>
                      <MenuItem
                        disabled={!hasUpstream}
                        onClick={() => setCheckout({ command: 'pull' })}
                      >
                        Pull
                      </MenuItem>
                      <MenuItem
                        disabled={!hasUpstream}
                        onClick={() => {
                          void run(async () =>
                            apply(await projectGit(id, { command: 'push' })),
                          );
                        }}
                      >
                        Push
                      </MenuItem>
                      <MenuItem
                        disabled={!hasUpstream}
                        onClick={() => setCheckout({ command: 'sync' })}
                      >
                        Sync Changes
                      </MenuItem>
                    </MenuList>
                  </MenuPopover>
                </Menu>
              </div>
              {snapshot.upstream && (
                <div className="git-actions">
                  <small>{snapshot.upstream}</small>
                  <Button
                    size="small"
                    disabled={busy || !snapshot.behind}
                    onClick={() => showHistory('incoming')}
                  >
                    {snapshot.behind} incoming
                  </Button>
                  <Button
                    size="small"
                    disabled={busy || !snapshot.ahead}
                    onClick={() => showHistory('outgoing')}
                  >
                    {snapshot.ahead} outgoing
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
                className="project-git-commit-message"
                placeholder="Commit message"
                aria-label="Commit message"
                value={message}
                onChange={(_, data) => setMessage(data.value)}
              />
              <Button
                className="project-git-commit-button"
                appearance="primary"
                icon={<CheckmarkRegular />}
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
                Review Commit
              </Button>
              {!!conflicts.length && (
                <>
                  <p role="status">Resolve the listed conflicts in Git.</p>
                  {changeGroup(conflicts, 'conflict')}
                </>
              )}
              {changeGroup(staged, 'index')}
              {changeGroup(working, 'working')}
              <ProjectGitGraph
                commits={graph}
                snapshot={snapshot}
              />
            </>
          )}
        </>
      )}
      {maintenance && snapshot && (
        <ProjectGitMaintenance
          mode={maintenance}
          folder={id}
          snapshot={snapshot}
          busy={busy}
          error={error}
          close={() => setMaintenance(undefined)}
          run={(operation) => {
            void run(operation);
          }}
          apply={apply}
          hasUnsaved={() => schematicDirty() || supportingFilesDirty()}
          refreshFiles={refreshOpenFiles}
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
      {branchesOpen && snapshot && (
        <ProjectGitBranches
          open={!checkout}
          folder={id}
          snapshot={snapshot}
          busy={busy}
          error={error}
          notice={branchNotice}
          announce={setBranchNotice}
          close={() => setBranchesOpen(false)}
          run={(operation) => {
            void run(operation);
          }}
          apply={apply}
          checkout={(command, branch) => {
            setError('');
            setBranchNotice('');
            setCheckout(
              command === 'merge-branch'
                ? { command, branch, into: snapshot.branch }
                : { command, branch },
            );
          }}
        />
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
                {checkout.command === 'merge-branch'
                  ? 'Merge branches'
                  : checkout.command === 'switch-branch'
                  ? 'Switch branch'
                  : checkout.command === 'pull'
                  ? 'Pull changes'
                  : 'Sync Changes'}
              </DialogTitle>
              <DialogContent>
                <p>
                  {checkout.command === 'merge-branch'
                    ? `Merge ${checkout.branch} into ${checkout.into}.`
                    : checkout.command === 'switch-branch'
                  ? `Switch from ${snapshot.branch} to ${checkout.branch}.`
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
                  {hasUnsaved
                    ? 'Keep edits and continue'
                    : checkout.command === 'merge-branch'
                    ? 'Merge branches'
                    : checkout.command === 'switch-branch'
                    ? 'Switch branch'
                    : checkout.command === 'pull'
                    ? 'Pull changes'
                    : 'Sync changes'}
                </Button>
                <Button disabled={busy} onClick={() => setCheckout(undefined)}>
                  Cancel
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
      {pendingStage && (
        <Dialog
          open
          onOpenChange={(_, data) =>
            !data.open && !busy && setPendingStage(undefined)
          }
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Stage with unsaved edits?</DialogTitle>
              <DialogContent>
                <p>
                  Open project files have unsaved edits. Git will stage the
                  versions currently saved on disk.
                </p>
                {error && <p role="alert">{error}</p>}
              </DialogContent>
              <DialogActions>
                <Button
                  appearance="primary"
                  disabled={busy}
                  onClick={() => setPendingStage(undefined)}
                >
                  Cancel
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => stage(true, pendingStage.path)}
                >
                  Stage Saved Changes
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
                {hasUnsaved && (
                  <p role="alert">
                    Open project files have unsaved edits. This commit will
                    include only the versions already staged in Git.
                  </p>
                )}
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
                      <span>{commit.subject}</span>
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
