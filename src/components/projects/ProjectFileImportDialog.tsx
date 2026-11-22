import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  ProgressBar,
} from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { importProjectFiles } from '../../io/projectImport';
import type {
  ImportChoice,
  ImportConflict,
  ImportSource,
} from '../../io/projectImport';
import { projectFilesChanged } from '../../io/projectStorage';
import type { ProjectLocation } from '../../io/projectStorage';

type Result = Awaited<ReturnType<typeof importProjectFiles>>;
export type ProjectImportJob = {
  destination: ProjectLocation;
  sources: Promise<ImportSource[]>;
  protectedFiles: ReadonlySet<string>;
};

export default function ProjectFileImportDialog({
  job,
  onClose,
}: {
  job: ProjectImportJob;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<{
    index: number;
    total: number;
    path: string;
  }>();
  const [conflict, setConflict] = useState<ImportConflict>();
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState('');
  const abort = useRef<AbortController>();
  const primaryAction = useRef<HTMLButtonElement>(null);
  const pendingChoice = useRef<(choice: ImportChoice) => void>();
  const running = !result && !error;

  useEffect(() => {
    // The file picker and the menu can return focus outside the dialog while
    // the import is running. Focus the next action when it becomes available.
    primaryAction.current?.focus();
  }, [conflict, running]);

  function decide(choice: ImportChoice) {
    const respond = pendingChoice.current;
    pendingChoice.current = undefined;
    setConflict(undefined);
    respond?.(choice);
  }

  async function run(
    sourceList: Promise<ImportSource[]>,
    controller: AbortController,
    previous?: Result,
  ) {
    const { signal } = controller;
    try {
      const sources = await sourceList;
      if (signal.aborted) return;
      if (!sources.length) throw new Error(t('projects.noImportFiles'));
      const batch = await importProjectFiles({
        sources,
        destination: job.destination,
        protectedFiles: job.protectedFiles,
        signal,
        choose: (conflict) =>
          new Promise((resolve) => {
            if (signal.aborted) {
              resolve('skip');
              return;
            }
            pendingChoice.current = resolve;
            setConflict(conflict);
          }),
        report: (index, path) =>
          setProgress({ index, total: sources.length, path }),
      });
      if (signal.aborted) return;
      setResult({
        added: (previous?.added ?? 0) + batch.added,
        skipped: (previous?.skipped ?? 0) + batch.skipped,
        failed: [
          ...(previous?.failed.filter(({ source }) => source.error) ?? []),
          ...batch.failed,
        ],
      });
    } catch (error) {
      if (!signal.aborted)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!signal.aborted) window.dispatchEvent(new Event(projectFilesChanged));
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    void run(job.sources, controller);
    return () => {
      controller.abort();
      abort.current?.abort();
      pendingChoice.current?.('skip');
      pendingChoice.current = undefined;
    };
  }, [job]);

  function retry() {
    const sources = result.failed
      .filter(({ source }) => !source.error)
      .map(({ source }) => source);
    const controller = new AbortController();
    abort.current = controller;
    setResult(undefined);
    setProgress(undefined);
    void run(Promise.resolve(sources), controller, result);
  }

  return (
    <Dialog
      open
      onOpenChange={(_, data) => !data.open && !running && onClose()}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('projects.addFiles')}</DialogTitle>
          <DialogContent>
            <p>
              {t('projects.importDestination', {
                folder: job.destination.name,
              })}
            </p>
            {progress && running && (
              <>
                <ProgressBar
                  aria-label={t('projects.importProgress')}
                  value={progress.index}
                  max={progress.total}
                />
                <p role="status">
                  {t('projects.importCurrent', {
                    index: progress.index + 1,
                    total: progress.total,
                    path: progress.path,
                  })}
                </p>
              </>
            )}
            {conflict && (
              <p>{t('projects.importConflict', { path: conflict.path })}</p>
            )}
            {error && <p role="alert">{error}</p>}
            {result && (
              <>
                <p role="status">
                  {t('projects.importAdded', { count: result.added })}{' '}
                  {t('projects.importSkipped', { count: result.skipped })}
                </p>
                {result.failed.length > 0 && (
                  <ul aria-label={t('projects.importFailures')}>
                    {result.failed.map(({ source, message }, index) => (
                      <li key={index}>
                        {source.path.join('/')} — {message}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </DialogContent>
          <DialogActions>
            {conflict && (
              <>
                <Button ref={primaryAction} appearance="primary" onClick={() => decide('keep')}>
                  {t('projects.keepBoth')}
                </Button>
                <Button
                  disabled={!conflict.replaceable}
                  onClick={() => decide('replace')}
                >
                  {t('projects.replaceFile')}
                </Button>
                <Button onClick={() => decide('skip')}>
                  {t('projects.skipFile')}
                </Button>
              </>
            )}
            {!running && (
              <>
                {result?.failed.some(({ source }) => !source.error) && (
                  <Button onClick={retry}>{t('projects.retryFiles')}</Button>
                )}
                <Button ref={primaryAction} appearance="primary" onClick={onClose}>
                  {t('common.close')}
                </Button>
              </>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
