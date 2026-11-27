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
  Select,
} from '@fluentui/react-components';
import {
  AddRegular,
  ArrowClockwiseRegular,
  ArrowUndoRegular,
  BranchForkRegular,
  CheckmarkRegular,
  ChevronDownRegular,
  HistoryRegular,
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
  GitDiffLine,
  GitSnapshot,
} from '../../io/projectGit';
import { projectFilesChanged } from '../../io/projectStorage';
import type { ProjectLocation } from '../../io/projectStorage';

export type GitReview = {
  title: string;
  text: string;
  hunks?: string[];
  applyHunk?: (index: number) => void;
  applyLines?: (lines: GitDiffLine[]) => void;
  linesLabel?: string;
  hunkLabel?: string;
};

type Props = {
  root?: ProjectLocation;
  openFolder(): void;
  setCount(count: number): void;
  onSnapshot(snapshot: GitSnapshot | null): void;
  historyRequest?: { filename: string; blame?: boolean };
  openReview(review?: GitReview): void;
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
  historyRequest,
  openReview,
  schematicDirty,
  supportingFilesDirty,
  saveOpenFiles,
  refreshOpenFiles,
}: Props) {
  const [snapshot, setSnapshot] = useState<GitSnapshot | null>();
  const [busy, setBusy] = useState(false);
  const [maintenance, setMaintenance] = useState<MaintenanceMode>();
  const [compareCommit, setCompareCommit] = useState<{
    commit: GitCommit;
    references: { ref: string; name: string }[];
  }>();
  const [reference, setReference] = useState('');
  const [graph, setGraph] = useState<GitCommit[]>([]);
  const lock = useRef(false);
  const refreshing = useRef(false);
  const refreshQueued = useRef(false);
  const revision = useRef(0);
  const active = useRef(false);
  const lastHistoryRequest = useRef<typeof historyRequest>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [clone, setClone] = useState<{ source: string; name: string }>();
  const [checkout, setCheckout] = useState<
    | { command: 'switch-branch'; branch: string }
    | { command: 'merge-branch'; branch: string; into: string }
    | { command: 'pull' | 'sync' }
  >();
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

  function inspectCommit(commit: GitCommit) {
    void run(async () => {
      const text = await projectGit(id, { command: 'revision', id: commit.id });
      if (!active.current) return;
      openReview({ title: commit.short + ' · ' + commit.subject, text });
      setHistory(undefined);
    });
  }

  function compareRevision(commit: GitCommit) {
    void run(async () => {
      const references = await projectGit(id, { command: 'references' });
      if (!active.current) return;
      setReference(references[0]?.ref ?? '');
      setCompareCommit({ commit, references });
    });
  }

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
    const applyPart = (part: number | GitDiffLine[]) => {
      void run(async () => {
        const location = { path: file.path, token: diff.token };
        const next = await projectGit(
          id,
          typeof part === 'number'
            ? {
                ...location,
                command: staged ? 'unstage-hunk' : 'stage-hunk',
                hunk: part,
              }
            : {
                ...location,
                command: staged ? 'unstage-lines' : 'stage-lines',
                lines: part,
              },
        );
        apply(next);
        const remaining = next.changes.find(
          (entry) =>
            entry.path === file.path &&
            (staged ? entry.index : entry.working) !== '.',
        );
        if (remaining) await review(remaining, staged);
        else openReview();
      });
    };
    openReview({
      title: (staged ? 'Staged ' : 'Changes to ') + description(file),
      text:
        diff.text || 'No textual differences. Compare or stage the whole file.',
      hunks: diff.hunks,
      hunkLabel: staged ? 'Unstage Hunk' : 'Stage Hunk',
      linesLabel: staged ? 'Unstage Selected Lines' : 'Stage Selected Lines',
      applyHunk: diff.hunks.length ? applyPart : undefined,
      applyLines: diff.hunks.length ? applyPart : undefined,
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
    if (!filename.startsWith(prefix)) return;
    const path = filename.slice(prefix.length);
    if (historyRequest.blame) {
      void run(async () => {
        const text = await projectGit(id, { command: 'blame', path });
        if (active.current)
          openReview({ title: 'Line History · ' + path, text });
      });
    } else showHistory(path);
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
      openReview();
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
                stage(kind !== 'index');
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
                <button
                  type="button"
                  className="project-git-file-name"
                  disabled={busy || file.outside || kind === 'conflict'}
                  title={description(file)}
                  onClick={() => void run(() => review(file, kind === 'index'))}
                >
                  <span>{file.path.slice(lastSlash + 1)}</span>
                  {lastSlash !== -1 && (
                    <small>{file.path.slice(0, lastSlash)}</small>
                  )}
                </button>
                <span
                  className="project-git-file-code"
                  title={file.outside ? 'Outside project' : changed(code)}
                  data-change={code}
                >
                  {code === '?' ? 'U' : code}
                </span>
                {!file.outside && (
                  <div className="project-git-file-actions">
                    {kind !== 'conflict' && (
                      <Button
                        size="small"
                        appearance="subtle"
                        disabled={busy}
                        aria-label={stageLabel}
                        title={`${stageLabel} ${file.path}`}
                        icon={stageIcon}
                        onClick={() => stage(kind !== 'index', file.path)}
                      />
                    )}
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
                    <Button
                      size="small"
                      appearance="subtle"
                      disabled={busy || !hasCommits}
                      aria-label="File History"
                      title={`History of ${file.path}`}
                      icon={<HistoryRegular />}
                      onClick={() => showHistory(file.path)}
                    />
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
                  appearance="subtle"
                  size="small"
                  icon={<BranchForkRegular />}
                  title="Manage branches"
                  disabled={busy}
                  onClick={() => {
                    setError('');
                    setBranchesOpen(true);
                  }}
                >
                  {snapshot.branch}
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
              <small className="project-git-root" title={snapshot.root}>
                {snapshot.root}
              </small>
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
                inspect={inspectCommit}
                compare={compareRevision}
              />
            </>
          )}
        </>
      )}
      {compareCommit && (
        <Dialog
          open
          onOpenChange={(_, data) => {
            if (!data.open && !busy) setCompareCommit(undefined);
          }}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Compare {compareCommit.commit.short}</DialogTitle>
              <DialogContent>
                <label>
                  Compare with{' '}
                  <Select
                    value={reference}
                    onChange={(_, { value }) => setReference(value)}
                  >
                    {compareCommit.references.map(({ ref, name }) => (
                      <option key={ref} value={ref}>
                        {name}
                      </option>
                    ))}
                  </Select>
                </label>
                {error && <p role="alert">{error}</p>}
              </DialogContent>
              <DialogActions>
                <Button
                  disabled={busy}
                  onClick={() => setCompareCommit(undefined)}
                >
                  Cancel
                </Button>
                <Button
                  appearance="primary"
                  disabled={busy || !reference}
                  onClick={() => {
                    void run(async () => {
                      const { commit, references } = compareCommit;
                      const text = await projectGit(id, {
                        command: 'compare',
                        id: commit.id,
                        ref: reference,
                      });
                      if (!active.current) return;
                      openReview({
                        title:
                          references.find(({ ref }) => ref === reference).name +
                          ' ↔ ' +
                          commit.short,
                        text: text || 'No textual differences.',
                      });
                      setCompareCommit(undefined);
                    });
                  }}
                >
                  Compare
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
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
          close={() => setBranchesOpen(false)}
          run={(operation) => {
            void run(operation);
          }}
          apply={apply}
          checkout={(command, branch) => {
            setError('');
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
                        onClick={() => inspectCommit(commit)}
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
