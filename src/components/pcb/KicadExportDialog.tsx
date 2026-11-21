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
import { createBoardWorker } from '../../pcb/boardWorker';

export default function KicadExportDialog({
  board,
  filename,
  onClose,
}: {
  board: BoardDocument;
  filename: string;
  onClose(): void;
}) {
  const [output, setOutput] =
    useState<
      Awaited<ReturnType<ReturnType<typeof createBoardWorker>['kicad']>>
    >();
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    let closed = false;
    setOutput(undefined);
    setError('');
    const worker = createBoardWorker();
    void worker
      .kicad(board)
      .then(
        (result) => {
          if (!closed) setOutput(result);
        },
        (error: Error) => {
          if (!closed) setError(error.message);
        },
      )
      .finally(() => worker.dispose());
    return () => {
      closed = true;
      worker.dispose();
    };
  }, [board]);
  const current =
    output?.report.source.boardId === board.boardId &&
    output?.report.source.revision === board.revision;

  async function download() {
    setDownloading(true);
    setError('');
    try {
      const { ZipWriter, Uint8ArrayWriter, TextReader } = await import(
        '@zip.js/zip.js'
      );
      const zip = new ZipWriter(new Uint8ArrayWriter(), {
        useWebWorkers: false,
      });
      const base =
        filename
          .split(/[\\/]/)
          .at(-1)
          ?.replace(/\.dpn$/i, '') || 'board';
      await zip.add(base + '.kicad_pcb', new TextReader(output.pcb));
      await zip.add(base + '.kicad_dru', new TextReader(output.designRules));
      await zip.add(
        'tinycad-export-report.json',
        new TextReader(JSON.stringify(output.report, null, 2)),
      );
      const bytes = new Uint8Array(await zip.close());
      saveAs(
        new Blob([bytes.buffer], { type: 'application/zip' }),
        base + '-kicad.zip',
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Export KiCad board</DialogTitle>
          <DialogContent>
            {error && <p role="alert">{error}</p>}
            {!current && !error && <p role="status">Preparing KiCad export…</p>}
            {current && (
              <>
                <p>
                  KiCad {output.report.target.version} · TinyCAD board revision{' '}
                  {output.report.source.revision}
                </p>
                <p>
                  Extract the board and its rules into the same folder. Review
                  the export report before continuing in KiCad.
                </p>
                <p role="status">
                  {
                    output.report.notes.filter(
                      ({ kind }) => kind === 'omission',
                    ).length
                  }{' '}
                  omissions ·{' '}
                  {
                    output.report.notes.filter(
                      ({ kind }) => kind === 'translation',
                    ).length
                  }{' '}
                  translations
                </p>
                <ul aria-label="KiCad export notes">
                  {output.report.notes
                    .slice(0, 30)
                    .map(({ kind, detail }, i) => (
                      <li key={i}>
                        {kind === 'omission' ? 'Omitted' : 'Translated'} ·{' '}
                        {detail}
                      </li>
                    ))}
                </ul>
                {output.report.notes.length > 30 && (
                  <p>
                    The downloaded report includes all{' '}
                    {output.report.notes.length} notes.
                  </p>
                )}
              </>
            )}
          </DialogContent>
          <DialogActions>
            {current && (
              <Button
                onClick={() => {
                  void download();
                }}
                disabled={downloading}
              >
                Download KiCad bundle…
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
