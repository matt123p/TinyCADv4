import React, { useEffect, useId, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from '@fluentui/react-components';
import { saveAs } from 'file-saver';
import { useTranslation } from 'react-i18next';
import type { BoardDocument } from '../../pcb/board';
import type { BoardWorkspaceSession } from '../../io/boardWorkspace';
import type { BoardWaiver } from '../../pcb/boardWaivers';
import type { BoardCheckReport, BoardIssue } from '../../pcb/boardChecks';
import { createBoardWorker } from '../../pcb/boardWorker';

import { BoardFindingDetails, FindingSeverityLabel } from './BoardFindingDetails';
import type { BoardFinding } from '../../pcb/boardFindings';

export default function BoardChecksDialog({
  board,
  readProjectCircuit,
  waitForRefill,
  filename,
  onClose,
  onChecked,
  onInspect,
  onProbe,
  onWaive,
  onRemoveWaiver,
}: {
  board: BoardDocument;
  readProjectCircuit?: BoardWorkspaceSession['readProjectCircuit'];
  waitForRefill(): Promise<void>;
  filename: string;
  onClose(): void;
  onChecked(revision: number): void;
  onInspect(issue: BoardFinding): void;
  onProbe?: (pin: BoardFinding['sourcePins'][number]) => void;
  onWaive(waiver: BoardWaiver): void;
  onRemoveWaiver(id: string): void;
}) {
  const { t } = useTranslation();
  const findingsId = useId();
  const waiverButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
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
      await waitForRefill();
      if (!active) return;
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
  }, [board, readProjectCircuit, onChecked, waitForRefill]);

  const current =
    report?.revision === board.revision && report.boardId === board.boardId;
  const acknowledged = current
    ? report.issues.filter(({ advisory }) => advisory?.waiver).length
    : 0;
  return (
    <Dialog open onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('pcbChecks.title')}</DialogTitle>
          <DialogContent>
            {error && <p role="alert">{error}</p>}
            {!current && !error && (
              <p role="status">
                {readProjectCircuit
                  ? t('pcbChecks.checkingProject')
                  : t('pcbChecks.checking')}
              </p>
            )}
            {current && (
              <>
                <p role="status">
                  {report.issues.length
                    ? t('pcbChecks.findings', { total: report.issues.length, revision: report.revision })
                    : t('pcbChecks.noFindings', { revision: report.revision })}
                  {acknowledged > 0 && ' ' + t('pcbChecks.waivedCount', { total: acknowledged })}
                </p>
                <Table aria-label={t('pcbChecks.table')} size="small">
                  <TableHeader>
                    <TableRow>
                      <TableHeaderCell scope="col" style={{ width: '6rem' }}>{t('pcbChecks.severityHeading')}</TableHeaderCell>
                      <TableHeaderCell scope="col">{t('pcbChecks.findingHeading')}</TableHeaderCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.issues.map((issue, i) => (
                      <TableRow key={i}>
                        <TableCell id={findingsId + '-severity-' + i}>
                          <FindingSeverityLabel severity={issue.severity} />
                        </TableCell>
                        <TableCell>
                          <Button
                            appearance="subtle"
                            aria-describedby={findingsId + '-severity-' + i}
                            onClick={() => onInspect(issue)}
                          >
                            {issue.message}
                          </Button>{' '}
                          <BoardFindingDetails finding={issue} onProbe={onProbe} />
                          {issue.advisory?.waiver ? (
                            <Button
                              size="small"
                              onClick={() => {
                                closeButton.current?.focus();
                                onRemoveWaiver(issue.advisory.waiver.id);
                              }}
                            >
                              {t('pcbChecks.removeWaiver')}
                            </Button>
                          ) : (
                            issue.advisory && (
                              <Button
                                size="small"
                                onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                                  waiverButton.current = event.currentTarget;
                                  setSelected(issue.advisory);
                                  setReason('');
                                }}
                              >
                                {t('pcbChecks.waive')}
                              </Button>
                            )
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
                        closeButton.current?.focus();
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
                        {t('pcbChecks.reason')}
                        <textarea
                          required
                          autoFocus
                          maxLength={2048}
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                        />
                      </label>
                      <Button type="submit" disabled={!reason.trim()}>
                        {t('pcbChecks.saveWaiver')}
                      </Button>
                      <Button onClick={() => {
                        waiverButton.current?.focus();
                        setSelected(undefined);
                      }}>
                        {t('pcbChecks.cancelWaiver')}
                      </Button>
                    </form>
                  )}
                {!!report.inactiveWaivers.length && (
                  <>
                    <h3>{t('pcbChecks.inactiveWaivers')}</h3>
                    <ul>
                      {report.inactiveWaivers.map(({ id, reason }) => (
                        <li key={id}>
                          {reason}{' '}
                          <Button
                            size="small"
                            onClick={() => onRemoveWaiver(id)}
                          >
                            {t('pcbChecks.removeWaiver')}
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
                  <summary>{t('pcbChecks.coverage')}</summary>
                  <ul>
                    {report.coverage.map(({ check, status, detail, result }) => (
                      <li key={check}>
                        <span>{check} · {t(`pcbChecks.coverageStatus.${status}`)}</span> · {t(`pcbChecks.result.${result}`)}
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
                {t('pcbChecks.saveReport')}
              </Button>
            )}
            <Button ref={closeButton} appearance="primary" onClick={onClose}>
              {t('pcbChecks.close')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
