import React, { Fragment, useEffect, useMemo, useState } from 'react';
import { Button } from '@fluentui/react-components';
import {
  Decoration,
  Diff,
  Hunk,
  getChangeKey,
  isNormal,
  parseDiff,
} from 'react-diff-view';
import 'react-diff-view/style/index.css';
import type { GitDiffLine } from '../../io/projectGit';
import type { GitReview } from './ProjectSourceControl';

export default function ProjectGitDiff({
  review,
  close,
}: {
  review: GitReview;
  close(): void;
}) {
  const [split, setSplit] = useState(false);
  const [raw, setRaw] = useState(false);
  const [selected, setSelected] = useState<Record<string, GitDiffLine>>({});
  useEffect(() => setSelected({}), [review.text]);
  const files = useMemo(() => {
    const patch = review.text.search(/^diff --git /m);
    if (patch < 0) return [];
    try {
      return parseDiff(review.text.slice(patch), { nearbySequences: 'zip' });
    } catch {
      return [];
    }
  }, [review.text]);
  const showPatch = files.some(({ hunks }) => hunks.length > 0);

  return (
    <section
      className="project-document-editor project-git-review"
      aria-label={review.title}
    >
      <header className="project-git-review-header">
        <strong title={review.title}>{review.title}</strong>
        {showPatch && (
          <>
            <Button
              size="small"
              aria-pressed={split}
              onClick={() => {
                setSplit(!split);
                setRaw(false);
              }}
            >
              {split ? 'Inline' : 'Side by Side'}
            </Button>
            <Button
              size="small"
              aria-pressed={raw}
              onClick={() => setRaw(!raw)}
            >
              Raw Patch
            </Button>
          </>
        )}
        {review.applyLines && Object.keys(selected).length > 0 && !raw && (
          <Button
            size="small"
            onClick={() => review.applyLines(Object.values(selected))}
          >
            {review.linesLabel}
          </Button>
        )}
        <Button size="small" onClick={close}>
          Close Review
        </Button>
      </header>
      {showPatch && !raw ? (
        <div
          className="project-git-patch"
          tabIndex={0}
          role="region"
          aria-label="Git diff"
        >
          {files.map(({ type, oldPath, newPath, hunks }, index) => (
            <div key={index}>
              {files.length > 1 && (
                <h3>{newPath === '/dev/null' ? oldPath : newPath}</h3>
              )}
              <Diff
                viewType={split ? 'split' : 'unified'}
                diffType={type}
                selectedChanges={Object.keys(selected)}
                renderGutter={
                  review.applyLines
                    ? ({ change, side, renderDefault }) => {
                        if (
                          isNormal(change) ||
                          (side === 'old') !== (change.type === 'delete')
                        )
                          return renderDefault();
                        const key = getChangeKey(change);
                        return (
                          <button
                            type="button"
                            className="project-git-line-number"
                            aria-pressed={!!selected[key]}
                            aria-label={`Select ${
                              change.type === 'insert' ? 'added' : 'removed'
                            } line ${change.lineNumber}`}
                            title="Select line for staging"
                            onClick={() =>
                              setSelected((current) => {
                                const next = { ...current };
                                if (next[key]) delete next[key];
                                else
                                  next[key] = {
                                    type: change.type,
                                    line: change.lineNumber,
                                  };
                                return next;
                              })
                            }
                          >
                            {renderDefault()}
                          </button>
                        );
                      }
                    : undefined
                }
                hunks={hunks}
              >
                {(items) =>
                  items.map((hunk, hunkIndex) => (
                    <Fragment key={hunk.content}>
                      <Decoration>
                        <div className="project-git-hunk">
                          <code>{hunk.content}</code>
                          {files.length === 1 &&
                            review.applyHunk &&
                            hunkIndex < review.hunks?.length && (
                              <Button
                                size="small"
                                onClick={() => review.applyHunk(hunkIndex)}
                              >
                                {review.hunkLabel}
                              </Button>
                            )}
                        </div>
                      </Decoration>
                      <Hunk hunk={hunk} />
                    </Fragment>
                  ))
                }
              </Diff>
            </div>
          ))}
        </div>
      ) : (
        <pre>{review.text}</pre>
      )}
    </section>
  );
}
