import React, { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from '@fluentui/react-components';
import { saveAs } from 'file-saver';
import type { BoardDocument } from '../../pcb/board';
import type { BoardWorkspaceSession } from '../../io/boardWorkspace';
import type { BoardWaiver } from '../../pcb/boardWaivers';
import type { BoardCheckReport, BoardIssue } from '../../pcb/boardChecks';
import { createBoardWorker } from '../../pcb/boardWorker';

const mm = (value: number) => (value / 1_000_000).toString() + ' mm';

export default function BoardChecksDialog({
  board,
  readProjectCircuit,
  filename,
  onClose,
  onChecked,
  onInspect,
  onWaive,
  onRemoveWaiver,
}: {
  board: BoardDocument;
  readProjectCircuit?: BoardWorkspaceSession['readProjectCircuit'];
  filename: string;
  onClose(): void;
  onChecked(revision: number): void;
  onInspect(issue: BoardIssue): void;
  onWaive(waiver: BoardWaiver): void;
  onRemoveWaiver(id: string): void;
}) {
  const [report, setReport] = useState<BoardCheckReport>();
  const [selected, setSelected] = useState<BoardIssue['advisory']>();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setReport(undefined);
    setError('');
    let active = true;
    let worker: ReturnType<typeof createBoardWorker>;
    const run = async () => {
      const projectCircuit = await readProjectCircuit?.(board);
      if (!active) return;
      worker = createBoardWorker();
      return worker.check(board, projectCircuit);
    };
    void run().then(
      (result) => {
        if (active) {
          setReport(result);
          onChecked(result.revision);
        }
        worker?.dispose();
      },
      (failure: Error) => {
        if (active) setError(failure.message);
        worker?.dispose();
      },
    );
    return () => {
      active = false;
      worker?.dispose();
    };
  }, [board, readProjectCircuit, onChecked]);

  const current =
    report?.revision === board.revision && report.boardId === board.boardId;
  const acknowledged = current
    ? report.issues.filter(({ advisory }) => advisory?.waiver).length
    : 0;
  return (
    <Dialog open onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>PCB design checks</DialogTitle>
          <DialogContent>
            {error && <p role="alert">{error}</p>}
            {!current && !error && (
              <p role="status">
                {readProjectCircuit
                  ? 'Comparing the project schematic and checking PCB geometry…'
                  : 'Checking PCB geometry…'}
              </p>
            )}
            {current && (
              <>
                <p role="status">
                  {report.issues.length
                    ? `${report.issues.length} findings for revision ${report.revision}.`
                    : `The implemented checks found no issues for revision ${report.revision}.`}
                  {acknowledged > 0 && ` ${acknowledged} waived.`}
                </p>
                <ol aria-label="PCB findings">
                  {report.issues.map((issue, i) => (
                    <li key={i}>
                      <Button
                        appearance="subtle"
                        onClick={() => onInspect(issue)}
                      >
                        {issue.message}
                      </Button>
                      {issue.measuredNm !== undefined &&
                        ' Measured ' + mm(issue.measuredNm) + '.'}
                      {issue.requiredNm !== undefined &&
                        ' Required ' + mm(issue.requiredNm) + '.'}
                      {issue.clearanceRules?.length > 0 && (
                        <ul aria-label="Matched clearance rules">
                          {issue.clearanceRules.map(({ id, name, clearanceNm }) => (
                            <li key={id}>{name} · {mm(clearanceNm)}</li>
                          ))}
                        </ul>
                      )}
                      {issue.advisory?.waiver ? (
                        <>
                          <p>Waived. {issue.advisory.waiver.reason}</p>
                          <Button
                            size="small"
                            onClick={() =>
                              onRemoveWaiver(issue.advisory.waiver.id)
                            }
                          >
                            Remove waiver
                          </Button>
                        </>
                      ) : (
                        issue.advisory && (
                          <Button
                            size="small"
                            onClick={() => {
                              setSelected(issue.advisory);
                              setReason('');
                            }}
                          >
                            Waive finding…
                          </Button>
                        )
                      )}
                    </li>
                  ))}
                </ol>
                {selected &&
                  report.issues.some(
                    ({ advisory }) =>
                      advisory?.fingerprint === selected.fingerprint &&
                      !advisory.waiver,
                  ) && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!reason.trim()) return;
                        onWaive({
                          id: crypto.randomUUID(),
                          code: selected.code,
                          fingerprint: selected.fingerprint,
                          reason: reason.trim(),
                        });
                        setSelected(undefined);
                      }}
                    >
                      <label>
                        Reason for waiver
                        <textarea
                          required
                          maxLength={2048}
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                        />
                      </label>
                      <Button type="submit" disabled={!reason.trim()}>
                        Save waiver
                      </Button>
                      <Button onClick={() => setSelected(undefined)}>
                        Cancel waiver
                      </Button>
                    </form>
                  )}
                {!!report.inactiveWaivers.length && (
                  <>
                    <h3>Inactive waivers</h3>
                    <ul>
                      {report.inactiveWaivers.map(({ id, reason }) => (
                        <li key={id}>
                          {reason}{' '}
                          <Button
                            size="small"
                            onClick={() => onRemoveWaiver(id)}
                          >
                            Remove waiver
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <details
                  open={report.coverage.some(
                    ({ status }) => status === 'limited' || status === 'unavailable',
                  )}
                >
                  <summary>Check coverage</summary>
                  <ul>
                    {report.coverage.map(({ check, status, detail }) => (
                      <li key={check}>
                        {check} · {status}
                        {detail && ' · ' + detail}
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            )}
          </DialogContent>
          <DialogActions>
            {current && (
              <Button
                onClick={() =>
                  saveAs(
                    new Blob([JSON.stringify(report, null, 2)], {
                      type: 'application/json',
                    }),
                    filename.replace(/\.dpn$/i, '') + '.drc.json',
                  )
                }
              >
                Save report…
              </Button>
            )}
            <Button appearance="primary" onClick={onClose}>
              Close
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
