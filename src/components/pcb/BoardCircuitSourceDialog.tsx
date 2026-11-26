import React, { useState } from 'react';
import {
  Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
} from '@fluentui/react-components';
import { readBoardCircuitSource } from '../../io/boardCircuitSource';
import { projectPcbKernel } from '../../io/projectPcbKernel';
import type { BoardDocument } from '../../pcb/board';
import { applyCircuitEco, previewCircuitEco } from '../../pcb/circuitEco';
import type { CircuitDeviceSelection, CircuitEco } from '../../pcb/circuitEco';
import type { CircuitSnapshot } from '../../pcb/circuitSnapshot';
import { maxDeviceLibraryBytes, readLibraryDevice } from '../../pcb/deviceLibrary';

export default function BoardCircuitSourceDialog({ board, onApply, onClose }: {
  board: BoardDocument;
  onApply(board: BoardDocument): void;
  onClose(): void;
}) {
  const [sourceFile, setSourceFile] = useState<File>();
  const [proposed, setProposed] = useState<CircuitSnapshot>();
  const [review, setReview] = useState<CircuitEco>();
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [devices, setDevices] = useState(new Map<string, CircuitDeviceSelection>());
  const heading = React.useRef<HTMLHeadingElement>(null);
  const previous = board.appliedCircuit;
  const unresolvedMappings = review?.unresolved.some(({ id }) =>
    review.candidate.components?.some((part) => part.logicalId === id && part.deviceId));

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    try { await task(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }

  async function load() {
    if (review) {
      setReviewing(true);
      return;
    }
    const snapshot = await readBoardCircuitSource(sourceFile, previous);
    const next = await previewCircuitEco(board, previous, snapshot, { loadKernel: projectPcbKernel });
    setDevices(new Map());
    setProposed(snapshot);
    setReview(next);
    setReviewing(true);
  }

  async function chooseDevice(id: string, file: File) {
    if (file.size > maxDeviceLibraryBytes) throw new Error('Device file exceeds the size limit.');
    const revision = await readLibraryDevice(new Uint8Array(await file.arrayBuffer()));
    const component = proposed.components.find((part) => part.id === id);
    const bindings = revision.definition.terminals.map(({ id: terminalId, name }) => {
      const matches = component.signals.filter((signal) => signal.number === name || signal.name === name);
      if (matches.length !== 1) throw new Error(`Device terminal ${name} must match exactly one schematic pin by number or name.`);
      return { terminalId, signalId: matches[0].id };
    });
    const selectedDevices = new Map(devices).set(id, { revision, bindings });
    setReview(await previewCircuitEco(board, previous, proposed, { selectedDevices, loadKernel: projectPcbKernel }));
    setDevices(selectedDevices);
  }

  React.useEffect(() => {
    heading.current?.focus();
  }, [reviewing]);

  return <Dialog open onOpenChange={(_, { open }) => { if (!open && !busy) onClose(); }}>
    <DialogSurface className={reviewing ? 'pcb-dialog' : 'pcb-dialog pcb-dialog-compact'}>
      <DialogBody>
        <DialogTitle ref={heading} tabIndex={-1}>Import schematic or netlist</DialogTitle>
        <DialogContent>
          <div hidden={reviewing}>
            <p>Choose a TinyCAD schematic (.dsn or .dzn) or TinyCAD Protel netlist (.net).</p>
            <label>Circuit source <input type="file" accept=".dsn,.dzn,.net" disabled={busy}
              onChange={(event) => {
                setSourceFile(event.target.files?.[0]);
                setReview(undefined);
                setError('');
              }} /></label>
          </div>
          {reviewing && review && <section aria-label="Circuit review">
            <p className="pcb-review-source">{sourceFile.name}</p>
            <p>{proposed.components.length} {proposed.components.length === 1 ? 'component' : 'components'}, {proposed.nets.length} {proposed.nets.length === 1 ? 'net' : 'nets'}</p>
            {review.unchanged && <p>The PCB already has this connectivity.</p>}
            {review.changes.length > 0 && <ul>{review.changes.map(({ id, reference, kind }) =>
              <li key={id}>{reference} · {kind}</li>)}</ul>}
            {review.affectedCopper.length > 0 && <p>{review.affectedCopper.length} copper changes require review.</p>}
            {review.duplicateReferences.length > 0 && <p role="alert">Duplicate references: {review.duplicateReferences.join(', ')}</p>}
            {review.conflicts.length > 0 && <p role="alert">Resolve conflicting schematic and PCB reference changes before applying.</p>}
            {review.unresolved.length > 0 && <>
              <p>Choose reviewed device files for footprints. Components without devices stay unplaced.</p>
              <ul>{review.unresolved.map(({ id, reference }) => <li key={id}>
                <label>{reference} device <input type="file" accept=".tcdevice.json" disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void run(() => chooseDevice(id, file));
                  }} /></label>
              </li>)}</ul>
            </>}
          </section>}
          {busy && <p role="status">Reviewing circuit…</p>}
          {error && <p role="alert">{error}</p>}
        </DialogContent>
        <DialogActions>
          {reviewing && <Button disabled={busy} onClick={() => {
            setError('');
            setReviewing(false);
          }}>Back</Button>}
          <Button disabled={busy} onClick={onClose}>Cancel</Button>
          {reviewing ? <Button appearance="primary" disabled={busy || !review || review.unchanged ||
            !!review.conflicts.length || !!review.duplicateReferences.length || unresolvedMappings}
            onClick={(): void => {
              void run(async () => {
                onApply(applyCircuitEco(board, review, { allowUnassigned: true }));
                onClose();
              });
            }}>Apply to PCB</Button> : (
            <Button appearance="primary" disabled={!sourceFile || busy} onClick={() => { void run(load); }}>
              Review circuit
            </Button>
          )}
        </DialogActions>
      </DialogBody>
    </DialogSurface>
  </Dialog>;
}
