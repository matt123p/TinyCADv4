import React, { useEffect, useState } from 'react';
import {
  Button,
  Badge,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
} from '@fluentui/react-components';
import {
  AddRegular,
  ArrowSwapRegular,
  BranchForkRegular,
  CheckmarkRegular,
} from '@fluentui/react-icons';
import type { GitCommit, GitSnapshot } from '../../io/projectGit';
import { projectGit } from '../../io/projectGit';
import ProjectGitGraph from './ProjectGitGraph';

export default function ProjectGitBranches({
  open,
  folder,
  snapshot,
  busy,
  error,
  notice,
  announce,
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
  notice: string;
  announce(message: string): void;
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
          setGraphError(
            reason instanceof Error ? reason.message : String(reason),
          );
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
            <div className="project-branch-current">
              <BranchForkRegular />
              <span>Current branch</span>
              <strong>{snapshot.branch}</strong>
            </div>
            {notice && <p role="status">{notice}</p>}
            <div className="project-branch-layout">
              <section aria-labelledby="project-local-branches">
                <h3 id="project-local-branches">Local branches</h3>
                <ul className="project-branch-list" aria-label="Local branches">
                  {localBranches.map((branch) => (
                    <li key={branch.name}>
                      <Button
                        appearance={
                          selected === branch.name ? 'secondary' : 'subtle'
                        }
                        aria-pressed={selected === branch.name}
                        disabled={busy}
                        icon={
                          snapshot.branch === branch.name ? (
                            <CheckmarkRegular />
                          ) : (
                            <BranchForkRegular />
                          )
                        }
                        onClick={() => setSelected(branch.name)}
                      >
                        <span>{branch.name}</span>
                        {snapshot.branch === branch.name && (
                          <Badge appearance="tint">Current</Badge>
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
                <div className="project-branch-actions">
                  <Button
                    size="small"
                    icon={<ArrowSwapRegular />}
                    disabled={!canSelect}
                    onClick={() => checkout('switch-branch', selected)}
                  >
                    Switch to selected
                  </Button>
                  <Button
                    size="small"
                    icon={<BranchForkRegular />}
                    disabled={!canMerge}
                    onClick={() => checkout('merge-branch', selected)}
                  >
                    Merge selected into current
                  </Button>
                </div>
                <form
                  className="project-branch-create"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (busy || !hasCommits || !name.trim()) return;
                    run(async () => {
                      const branch = name.trim();
                      announce('');
                      apply(
                        await projectGit(folder, {
                          command: 'create-branch',
                          branch,
                        }),
                      );
                      setSelected(branch);
                      setName('');
                      announce(`Created ${branch}.`);
                    });
                  }}
                >
                  <h3>Create a branch</h3>
                  <p>
                    {hasCommits ? (
                      <>
                        Starts from <strong>{snapshot.branch}</strong> and keeps
                        it checked out.
                      </>
                    ) : (
                      'Create the first commit before adding another branch.'
                    )}
                  </p>
                  <Field label="Branch name">
                    <Input
                      value={name}
                      placeholder="e.g. revise-power-supply"
                      disabled={busy || !hasCommits}
                      onChange={(_, data) => setName(data.value)}
                    />
                  </Field>
                  <Button
                    type="submit"
                    icon={<AddRegular />}
                    appearance="primary"
                    disabled={busy || !hasCommits || !name.trim()}
                  >
                    Create branch
                  </Button>
                </form>
              </section>
              <section
                className="project-branch-graph"
                aria-labelledby="project-branch-graph-heading"
              >
                <h3 id="project-branch-graph-heading">Branch graph</h3>
                {graphError ? (
                  <p role="alert">{graphError}</p>
                ) : graph ? (
                  <ProjectGitGraph
                    commits={graph}
                    snapshot={snapshot}
                    label="Branch graph"
                    collapsible={false}
                  />
                ) : (
                  <p role="status">Loading branch graph…</p>
                )}
              </section>
            </div>
            {error && <p role="alert">{error}</p>}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" disabled={busy} onClick={close}>
              Close
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
