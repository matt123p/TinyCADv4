import React, { useState } from 'react';
import {
  Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
} from '@fluentui/react-components';
import { saveAs } from 'file-saver';
import { kicadBoardReviewByteLimit, reviewKicadBoard } from '../../pcb/kicadBoardReview';
import type { KicadBoardReview } from '../../pcb/kicadBoardReview';

const labels = {
  blind: 'Blind via',
  buried: 'Buried via',
  microvia: 'Microvia',
  unknown: 'Unknown via type or span',
};

export default function KicadBoardReviewDialog({ onClose }: { onClose(): void }) {
  const [report, setReport] = useState<KicadBoardReview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function read(file: File) {
    setReport(undefined);
    setError('');
    setBusy(true);
    try {
      if (file.size > kicadBoardReviewByteLimit)
        throw new Error('Choose a KiCad board no larger than 16 MiB.');
      setReport(await reviewKicadBoard(new Uint8Array(await file.arrayBuffer()), file.name));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface className="pcb-dialog">
        <DialogBody>
          <DialogTitle>Review KiCad board</DialogTitle>
          <DialogContent className="pcb-profile-fields">
            <p>Inspect via types and layer spans in a KiCad board. This review produces a diagnostic report only.</p>
            <label>
              KiCad board file
              <input type="file" accept=".kicad_pcb" disabled={busy} onChange={(event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                input.value = '';
                if (file) void read(file);
              }} />
            </label>
            {busy && <p role="status">Reading KiCad via records…</p>}
            {error && <p role="alert">{error}</p>}
            {report && (
              <>
                <p role="status">
                  {report.source.filename} · {report.unsupportedVias.length} unsupported of {report.viaCount} vias
                </p>
                <p>Production export is unavailable for this review.</p>
                {!!report.unsupportedVias.length && (
                  <ol aria-label="Unsupported KiCad vias">
                    {report.unsupportedVias.slice(0, 50).map((via) => (
                      <li key={via.ordinal}>
                        {labels[via.kind]} {via.ordinal} · {via.layers.join(' → ') || 'Unknown span'}
                        {via.positionMm && ' · ' + via.positionMm.join(', ') + ' mm'}
                        {!via.validSpan && ' · Invalid layer span'}
                      </li>
                    ))}
                  </ol>
                )}
                {report.unsupportedVias.length > 50 && <p>The report includes every unsupported via.</p>}
              </>
            )}
          </DialogContent>
          <DialogActions>
            {report && (
              <Button onClick={() => saveAs(
                new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
                report.source.filename.replace(/\.kicad_pcb$/i, '') + '.via-review.json',
              )}>Download via report…</Button>
            )}
            <Button onClick={onClose}>Close</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
