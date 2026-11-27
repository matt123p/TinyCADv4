import React, { useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Select,
} from '@fluentui/react-components';
import { openProjectWorktree, projectGit } from '../../io/projectGit';
import type { GitSnapshot, GitStash, GitWorktree } from '../../io/projectGit';
import { projectRequest } from '../../io/projects';
import { projectFilesChanged } from '../../io/projectStorage';

export type MaintenanceMode = 'stash' | 'worktrees' | 'publish';

type Props = {
  mode: MaintenanceMode;
  folder: string;
  snapshot: GitSnapshot;
  busy: boolean;
  error: string;
  close(): void;
  run(operation: () => Promise<void>): void;
  apply(snapshot: GitSnapshot): void;
  hasUnsaved(): boolean;
  refreshFiles(repository: string): Promise<void>;
};

const title = {
  stash: 'Git Stashes',
  worktrees: 'Git Worktrees',
  publish: 'Publish Branch',
};

export default function ProjectGitMaintenance({
  mode,
  folder,
  snapshot,
  busy,
  error,
  close,
  run,
  apply,
  hasUnsaved,
  refreshFiles,
}: Props) {
  const [stashes, setStashes] = useState<GitStash[]>([]);
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [message, setMessage] = useState('');
  const [newBranch, setNewBranch] = useState(true);
  const [branch, setBranch] = useState('');
  const [directory, setDirectory] = useState('');
  const [remote, setRemote] = useState(snapshot.remotes[0] ?? '');

  async function loadEntries() {
    if (mode === 'stash')
      setStashes(await projectGit(folder, { command: 'stash-list' }));
    if (mode === 'worktrees')
      setWorktrees(
        await projectRequest({ operation: 'worktree-list', folder }),
      );
  }

  useEffect(() => {
    if (mode !== 'publish') run(loadEntries);
  }, [mode, folder]);

  function requireSavedFiles() {
    if (hasUnsaved())
      throw new Error(
        'Save or close open project files before changing the working tree.',
      );
  }

  async function finishStash(next: GitSnapshot) {
    apply(next);
    await refreshFiles(next.root);
    window.dispatchEvent(new Event(projectFilesChanged));
    await loadEntries();
  }

  return (
    <Dialog
      open
      onOpenChange={(_, data) => {
        if (!data.open && !busy) close();
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{title[mode]}</DialogTitle>
          <DialogContent className="project-git-maintenance">
            {error && <p role="alert">{error}</p>}
            {mode === 'stash' && (
              <>
                <Field label="Stash message">
                  <Input
                    value={message}
                    onChange={(_, { value }) => setMessage(value)}
                  />
                </Field>
                <Button
                  disabled={busy || !snapshot.changes.length}
                  onClick={() =>
                    run(async () => {
                      requireSavedFiles();
                      await finishStash(
                        await projectGit(folder, {
                          command: 'stash-create',
                          message,
                        }),
                      );
                      setMessage('');
                    })
                  }
                >
                  Stash Changes
                </Button>
                {!stashes.length && <p>No stashes.</p>}
                <ul aria-label="Stashes">
                  {stashes.map((stash) => (
                    <li key={stash.ref}>
                      <strong>{stash.subject}</strong>
                      <div className="git-actions">
                        {(['apply', 'pop', 'drop'] as const).map((action) => (
                          <Button
                            key={action}
                            size="small"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                if (action !== 'drop') requireSavedFiles();
                                if (
                                  action === 'drop' &&
                                  !window.confirm(`Drop "${stash.subject}"?`)
                                )
                                  return;
                                try {
                                  await finishStash(
                                    await projectGit(folder, {
                                      command: `stash-${action}`,
                                      ...stash,
                                    }),
                                  );
                                } catch (error) {
                                  apply(
                                    await projectGit(folder, {
                                      command: 'status',
                                    }),
                                  );
                                  await loadEntries();
                                  throw error;
                                }
                              })
                            }
                          >
                            {action[0].toUpperCase() + action.slice(1)}
                          </Button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {mode === 'worktrees' && (
              <>
                <ul aria-label="Worktrees">
                  {worktrees
                    .filter((entry) => !entry.bare && !entry.prunable)
                    .map((entry) => (
                      <li key={entry.id}>
                        <Button
                          size="small"
                          disabled={busy || entry.id === folder}
                          title={entry.id}
                          onClick={() =>
                            run(async () => {
                              requireSavedFiles();
                              await openProjectWorktree(folder, {
                                id: entry.id,
                              });
                              close();
                            })
                          }
                        >
                          {entry.branch ?? entry.head?.slice(0, 8) ?? entry.id}
                        </Button>
                        <small>{entry.id}</small>
                      </li>
                    ))}
                </ul>
                <Checkbox
                  label="Create a new branch"
                  checked={newBranch}
                  onChange={(_, { checked }) => {
                    setNewBranch(checked === true);
                    setBranch('');
                  }}
                />
                <Field label="Branch">
                  {newBranch ? (
                    <Input
                      value={branch}
                      onChange={(_, { value }) => setBranch(value)}
                    />
                  ) : (
                    <Select
                      value={branch}
                      onChange={(_, { value }) => setBranch(value)}
                    >
                      <option value="">Select a branch</option>
                      {snapshot.branches
                        .filter(
                          ({ name }) =>
                            !worktrees.some((item) => item.branch === name),
                        )
                        .map(({ name }) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                    </Select>
                  )}
                </Field>
                <Field label="New worktree folder name">
                  <Input
                    value={directory}
                    onChange={(_, { value }) => setDirectory(value)}
                  />
                </Field>
                <Button
                  disabled={busy || !directory.trim() || !branch.trim()}
                  onClick={() =>
                    run(async () => {
                      requireSavedFiles();
                      await openProjectWorktree(folder, {
                        name: directory.trim(),
                        branch: branch.trim(),
                        createBranch: newBranch,
                      });
                      close();
                    })
                  }
                >
                  Choose Location and Create
                </Button>
              </>
            )}
            {mode === 'publish' && (
              <>
                <p>
                  Push <strong>{snapshot.branch}</strong> to the selected remote
                  and set its upstream.
                </p>
                <Field label="Remote">
                  <Select
                    value={remote}
                    onChange={(_, { value }) => setRemote(value)}
                  >
                    {snapshot.remotes.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            )}
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={close}>
              Close
            </Button>
            {mode === 'publish' && (
              <Button
                appearance="primary"
                disabled={busy || !remote}
                onClick={() =>
                  run(async () => {
                    apply(
                      await projectGit(folder, {
                        command: 'publish-branch',
                        remote,
                      }),
                    );
                    close();
                  })
                }
              >
                Publish Branch
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
