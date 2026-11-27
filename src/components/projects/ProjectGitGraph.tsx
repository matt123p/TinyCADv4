import React from 'react';
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
  label = 'Commit graph',
}: {
  commits: GitCommit[];
  snapshot: GitSnapshot;
  label?: string;
}) {
  const rows = graphRows(commits);
  const width = x(
    rows.reduce(
      (max, { before, after }) => Math.max(max, before.length, after.length),
      0,
    ),
  );
  const labels = new Map<string, string[]>();
  for (const { name, id } of snapshot.branches) {
    const names = labels.get(id) ?? [];
    names.push(name);
    labels.set(id, names);
  }
  const commitLabel = (commit: GitCommit) => (
    <>
      <span>{commit.subject}</span>
      {labels.get(commit.id)?.map((name) => (
        <small key={name}>{name}</small>
      ))}
    </>
  );
  return (
    <details className="project-git-group" open>
      <summary>{label === 'Commit graph' ? 'Commit Graph' : label}</summary>
      {!rows.length && <p>No commits yet.</p>}
      <ol className="project-git-graph" aria-label={label}>
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
            <div className="project-git-graph-label" title={commit.short}>
              {commitLabel(commit)}
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
