import React, { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
} from '@fluentui/react-components';
import type { GitCommit, GitSnapshot } from '../../io/projectGit';
import { projectGit } from '../../io/projectGit';
import ProjectGitGraph from './ProjectGitGraph';

export default function ProjectGitBranches({
  open,
  folder,
  snapshot,
  busy,
  error,
  close,
  run,
  apply,
  checkout,
}: {
  open: boolean;
  folder: string;
  snapshot: GitSnapshot;
  busy: boolean;
  error: string;
  close(): void;
  run(operation: () => Promise<void>): void;
  apply(snapshot: GitSnapshot): void;
  checkout(command: 'switch-branch' | 'merge-branch', branch: string): void;
}) {
  const [selected, setSelected] = useState(snapshot.branch);
  const [name, setName] = useState('');
  const [graph, setGraph] = useState<GitCommit[]>();
  const [graphError, setGraphError] = useState('');
  const branchHeads = JSON.stringify(
    snapshot.branches.map(({ name, id }) => [name, id]),
  );
  const hasCommits = snapshot.head !== '(initial)';
  const localBranches = snapshot.branches.length
    ? snapshot.branches
    : [{ name: snapshot.branch }];
  const canSelect =
    !busy &&
    snapshot.branches.some(
      ({ name }) => name === selected && name !== snapshot.branch,
    );
  const canMerge =
    canSelect && snapshot.branches.some(({ name }) => name === snapshot.branch);

  useEffect(() => {
    let active = true;
    setGraphError('');
    void projectGit(folder, { command: 'branch-graph' }).then(
      (commits) => {
        if (active) setGraph(commits);
      },
      (reason) => {
        if (active)
          setGraphError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [folder, snapshot.head, branchHeads]);

  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => !data.open && !busy && close()}
    >
      <DialogSurface className="project-branch-dialog">
        <DialogBody>
          <DialogTitle>Branches</DialogTitle>
          <DialogContent>
            <div className="project-branch-layout">
              <div>
                <ul className="project-branch-list" aria-label="Local branches">
                  {localBranches.map((branch) => (
                    <li key={branch.name}>
                      <Button
                        appearance={
                          selected === branch.name ? 'secondary' : 'subtle'
                        }
                        aria-pressed={selected === branch.name}
                        onClick={() => setSelected(branch.name)}
                      >
                        {branch.name}
                        {snapshot.branch === branch.name && (
                          <small>Current</small>
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
                <div className="project-branch-actions">
                  <Button
                    size="small"
                    disabled={!canSelect}
                    onClick={() => checkout('switch-branch', selected)}
                  >
                    Switch branch
                  </Button>
                  <Button
                    size="small"
                    disabled={!canMerge}
                    onClick={() => checkout('merge-branch', selected)}
                  >
                    Merge into current branch
                  </Button>
                </div>
                <form
                  className="project-branch-create"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (busy || !hasCommits || !name.trim()) return;
                    run(async () => {
                      const branch = name.trim();
                      apply(
                        await projectGit(folder, {
                          command: 'create-branch',
                          branch,
                        }),
                      );
                      setSelected(branch);
                      setName('');
                    });
                  }}
                >
                  <Field label="Branch name">
                    <Input
                      value={name}
                      disabled={busy || !hasCommits}
                      onChange={(_, data) => setName(data.value)}
                    />
                  </Field>
                  <Button
                    type="submit"
                    size="small"
                    disabled={busy || !hasCommits || !name.trim()}
                  >
                    Create branch
                  </Button>
                </form>
              </div>
              <div className="project-branch-graph">
                {graphError ? (
                  <p role="alert">{graphError}</p>
                ) : graph ? (
                  <ProjectGitGraph
                    commits={graph}
                    snapshot={snapshot}
                    label="Branch graph"
                  />
                ) : (
                  <p role="status">Loading branch graph…</p>
                )}
              </div>
            </div>
            {error && <p role="alert">{error}</p>}
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={close}>
              Close
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
