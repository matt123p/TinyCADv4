import React from 'react';
import {
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
} from '@fluentui/react-components';
import type { GitCommit, GitSnapshot } from '../../io/projectGit';

type Lane = { id: string; color: number };
const palette = ['#287bb8', '#865bbb', '#25815e', '#ad5925', '#a63d6b'];
const x = (index: number) => 8 + index * 12;

function graphRows(commits: GitCommit[]) {
  let lanes: Lane[] = [];
  let nextColor = 0;
  return commits.map((commit) => {
    let current = lanes.findIndex(({ id }) => id === commit.id);
    if (current < 0) {
      current = lanes.length;
      lanes = [...lanes, { id: commit.id, color: nextColor++ }];
    }
    const before = lanes;
    const node = before[current];
    const after = before.filter(({ id }) => id !== commit.id);
    const parents = commit.parents.map((parent, index) => {
      const existing = after.find((lane) => lane.id === parent);
      if (existing) return existing;
      const lane = {
        id: parent,
        color: index === 0 ? node.color : nextColor++,
      };
      const insert =
        index === 0 ? Math.min(current, after.length) : after.length;
      after.splice(insert, 0, lane);
      return lane;
    });
    lanes = after;
    return { commit, before, after, current, node, parents };
  });
}

export default function ProjectGitGraph({
  commits,
  snapshot,
  inspect,
  compare,
}: {
  commits: GitCommit[];
  snapshot: GitSnapshot;
  inspect(commit: GitCommit): void;
  compare(commit: GitCommit): void;
}) {
  const rows = graphRows(commits);
  const width = x(
    rows.reduce(
      (max, { before, after }) => Math.max(max, before.length, after.length),
      0,
    ),
  );
  const labels = new Map(snapshot.branches.map(({ name, id }) => [id, name]));
  return (
    <details className="project-git-group" open>
      <summary>Commit Graph</summary>
      {!rows.length && <p>No commits yet.</p>}
      <ol className="project-git-graph" aria-label="Commit graph">
        {rows.map(({ commit, before, after, current, node, parents }) => (
          <li key={commit.id}>
            <svg width={width} height={28} aria-hidden="true">
              {before.map((lane, index) => {
                if (lane === node)
                  return (
                    <path
                      key={lane.id}
                      stroke={palette[lane.color % palette.length]}
                      d={`M ${x(index)} 0 V 14`}
                    />
                  );
                const next = after.indexOf(lane);
                return (
                  <path
                    key={lane.id}
                    stroke={palette[lane.color % palette.length]}
                    d={`M ${x(index)} 0 V 14 L ${x(next)} 28`}
                  />
                );
              })}
              {parents.map((lane) => (
                <path
                  key={lane.id}
                  stroke={palette[lane.color % palette.length]}
                  d={`M ${x(current)} 14 L ${x(after.indexOf(lane))} 28`}
                />
              ))}
              <circle
                cx={x(current)}
                cy={14}
                r={4}
                fill={palette[node.color % palette.length]}
              />
            </svg>
            <Menu openOnContext>
              <MenuTrigger disableButtonEnhancement>
                <button
                  type="button"
                  onClick={() => inspect(commit)}
                  title={`${commit.short} · ${commit.date} · ${commit.subject}`}
                >
                  <span>{commit.subject}</span>
                  {labels.has(commit.id) && (
                    <small>{labels.get(commit.id)}</small>
                  )}
                </button>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem onClick={() => inspect(commit)}>
                    Open Changes
                  </MenuItem>
                  <MenuItem onClick={() => compare(commit)}>
                    Compare with Branch or Tag…
                  </MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          </li>
        ))}
      </ol>
    </details>
  );
}
