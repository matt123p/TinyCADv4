import { Input, Select } from '@fluentui/react-components';
import React, { useState } from 'react';
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import type { BoardDocument } from '../../pcb/board';
import { readLibraryDevice, maxDeviceLibraryBytes } from '../../pcb/deviceLibrary';
import { addStandaloneDevice, addStandaloneNet, assignStandaloneSignal, standalonePadSignals } from '../../pcb/standaloneCircuit';

export default function BoardConnectionsDialog({ board, selected, onCommit, onClose }: {
  board: BoardDocument;
  selected: string;
  onCommit(candidate: BoardDocument): void;
  onClose(): void;
}) {
  const [componentId, setComponentId] = useState(selected || board.components?.[0]?.id || '');
  const [padId, setPadId] = useState('');
  const [netId, setNetId] = useState('');
  const [netName, setNetName] = useState('');
  const [reference, setReference] = useState('');
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string }>();
  const signals = standalonePadSignals(board, componentId);
  const signal = signals.find(({ id }) => id === padId);

  async function run(action: () => Promise<void> | void) {
    setBusy(true);
    setFeedback(undefined);
    try {
      await action();
    } catch (error) {
      setFeedback({ error: true, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function assign() {
    const candidate = assignStandaloneSignal(board, componentId, padId, netId);
    const { reviewCircuitCopper } = await import('../../pcb/circuitEcoCopper');
    const review = await reviewCircuitCopper(board, candidate, async () =>
      (await import('../../io/projectPcbKernel')).projectPcbKernel(),
    );
    onCommit(review.candidate);
    const affected = !!(review.affected.length || review.shorts.length || review.opens.length);
    setFeedback({
      error: false,
      message: affected
        ? 'Pad assignment updated. Run design checks to review affected copper.'
        : 'Pad assignment updated.',
    });
  }

  return (
    <Dialog open onOpenChange={(_, data) => !data.open && !busy && onClose()}>
      <DialogSurface className="pcb-dialog">
        <DialogBody>
          <DialogTitle>PCB connections</DialogTitle>
          <DialogContent className="pcb-profile-fields">
            <form className="pcb-connection-form" aria-label="Create a board net" onSubmit={(event) => {
              event.preventDefault();
              void run(() => {
                onCommit(addStandaloneNet(board, netName));
                setNetName('');
                setFeedback({ error: false, message: 'Board net added.' });
              });
            }}>
              <label>Net name<Input required value={netName} disabled={busy} onChange={(event) => setNetName(event.target.value)} /></label>
              <Button type="submit" disabled={busy || !netName.trim()}>Add net</Button>
            </form>
            <form className="pcb-connection-form" aria-label="Assign component pads" onSubmit={(event) => {
              event.preventDefault();
              void run(assign);
            }}>
              <label>
                Component
                <Select aria-label="Component" value={componentId} disabled={busy} onChange={(event) => {
                  setComponentId(event.target.value);
                  setPadId('');
                  setNetId('');
                }}>
                  <option value="">Choose a component</option>
                  {board.components?.map(({ id, reference: label }) =>
                    <option key={id} value={id}>{label || id}</option>,
                  )}
                </Select>
              </label>
              <label>
                Electrical pads
                <Select aria-label="Electrical pads" value={padId} disabled={busy || !signals.length} onChange={(event) => {
                  setPadId(event.target.value);
                  setNetId(signals.find(({ id }) => id === event.target.value)?.netId ?? '');
                }}>
                  <option value="">Choose pads</option>
                  {signals.map(({ id, pads }) => <option key={id} value={id}>{pads.join(', ')}</option>)}
                </Select>
              </label>
              <label>
                Assign to net
                <Select aria-label="Assign to net" value={netId} disabled={busy || !signal} onChange={(event) => setNetId(event.target.value)}>
                  <option value="">Unassigned</option>
                  {board.nets?.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                </Select>
              </label>
              <Button type="submit" disabled={busy || !signal || signal.netId === netId}>Apply pad assignment</Button>
            </form>
            <form className="pcb-connection-form" aria-label="Import a reviewed device" onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              if (!file) return;
              void run(async () => {
                if (file.size > maxDeviceLibraryBytes) throw new Error('Device file exceeds the size limit.');
                const revision = await readLibraryDevice(new Uint8Array(await file.arrayBuffer()));
                onCommit(await addStandaloneDevice(board, revision, reference));
                form.reset();
                setFile(undefined);
                setReference('');
                setFeedback({ error: false, message: 'Device added to unplaced components.' });
              });
            }}>
              <label>Reviewed device file<input type="file" required disabled={busy} accept=".tcdevice.json" onChange={(event) => setFile(event.target.files?.[0])} /></label>
              <label>Component reference<Input required value={reference} disabled={busy} onChange={(event) => setReference(event.target.value)} /></label>
              <Button type="submit" disabled={busy || !file || !reference.trim()}>Add device</Button>
            </form>
            {feedback && <p role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
          </DialogContent>
          <DialogActions><Button disabled={busy} onClick={onClose}>Done</Button></DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
