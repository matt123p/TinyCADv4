import React, { useState } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from '@fluentui/react-components';
import type {
  ProjectCircuitEco,
  ProjectCircuitUndo,
} from '../../io/projectCircuitEco';
import type { ProjectDeviceReview } from '../../io/projectDevices';
import ProjectDeviceDialog from './ProjectDeviceDialog';

export default function ProjectCircuitDialog({
  update,
  onClose,
  onApplied,
  onCreated,
}: {
  update: ProjectCircuitEco;
  onClose: () => void;
  onApplied: (undo: ProjectCircuitUndo) => void;
  onCreated: (boardId: string) => void;
}) {
  const [replacement, setReplacement] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState(update.review);
  const [deviceReview, setDeviceReview] = useState<ProjectDeviceReview>();
  const { sourcePath, targetPath, creating } = update;
  const {
    changes,
    unresolved,
    conflicts,
    pendingBackAnnotations,
    duplicateReferences,
    netReview,
    renamedNets,
    deviceChanges,
    affectedCopper,
    shorts,
  } = review;
  const hasBlockers =
    unresolved.length || conflicts.length || duplicateReferences.length;
  const resolvedComponents = (review.candidate.components ?? []).filter(
    (component) =>
      component.role !== 'pcb-only' &&
      component.deviceId &&
      !unresolved.some(({ id }) => id === component.logicalId),
  );
  const netNames = new Map(
    review.candidate.nets.map(({ id, name }) => [id, name]),
  );
  const netChanges = netReview.nets
    .map((net, index) => ({
      ...net,
      id: review.candidate.appliedCircuit.nets[index].id,
    }))
    .filter(({ retainedId }) => !retainedId);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function openMapping(id: string) {
    void run(async () =>
      setDeviceReview(await update.reviewDevice(review, id, setReview)),
    );
  }

  if (deviceReview)
    return (
      <ProjectDeviceDialog
        review={deviceReview}
        onClose={() => setDeviceReview(undefined)}
      />
    );

  return (
    <Dialog
      open
      onOpenChange={(_, data) => {
        if (!data.open && !busy) onClose();
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>
            {creating
              ? 'Create PCB from Schematic'
              : 'Update PCB from Schematic'}
          </DialogTitle>
          <DialogContent style={{ maxHeight: '65vh', overflowY: 'auto' }}>
            <p>
              {sourcePath} → {targetPath}
            </p>
            {review.unchanged ? (
              <p role="status">
                {pendingBackAnnotations.length
                  ? 'PCB references differ from the schematic.'
                  : 'The board is current.'}
              </p>
            ) : (
              <>
                {!!changes.length && (
                  <ul aria-label="Component changes">
                    {changes.map(
                      ({
                        id,
                        reference,
                        kind,
                        fields,
                        lostPads,
                        lostDrills,
                        canRetainMechanical,
                      }) => (
                        <li key={id}>
                          {kind === 'add'
                            ? 'Add'
                            : kind === 'remove'
                            ? 'Remove'
                            : kind === 'retain-mechanical'
                            ? 'Retain as mechanical'
                            : 'Update'}{' '}
                          {reference}
                          {!!fields.length && <> · {fields.join(', ')}</>}
                          {canRetainMechanical && (
                            <div>
                              <Checkbox
                                label={`Keep ${reference} as PCB-only mechanical`}
                                disabled={busy}
                                checked={kind === 'retain-mechanical'}
                                onChange={(): void => {
                                  void run(async () =>
                                    setReview(
                                      await update.toggleMechanical(id),
                                    ),
                                  );
                                }}
                              />
                            </div>
                          )}
                          {!!lostPads.length && (
                            <> · Removes pads {lostPads.join(', ')}</>
                          )}
                          {!!lostDrills?.length && (
                            <ul>
                              {lostDrills.map(
                                ({ pad, widthNm, lengthNm, plated }, index) => (
                                  <li key={index}>
                                    Pad {pad} ·{' '}
                                    {plated ? 'Plated' : 'Non-plated'}{' '}
                                    {lengthNm === widthNm ? 'hole' : 'slot'}{' '}
                                    {widthNm / 1_000_000} mm
                                    {lengthNm !== widthNm && (
                                      <> × {lengthNm / 1_000_000} mm</>
                                    )}
                                  </li>
                                ),
                              )}
                            </ul>
                          )}
                        </li>
                      ),
                    )}
                  </ul>
                )}
                {!!(
                  netChanges.length ||
                  netReview.removedIds.length ||
                  renamedNets.length
                ) && (
                  <ul aria-label="Net changes">
                    {netChanges.map(({ id, affectedPreviousIds }, index) => (
                      <li key={index}>
                        Add net {netNames.get(id) ?? id}
                        {!!affectedPreviousIds.length && (
                          <>
                            {' '}
                            · Changes membership of {
                              affectedPreviousIds.length
                            }{' '}
                            previous{' '}
                            {affectedPreviousIds.length === 1 ? 'net' : 'nets'}
                          </>
                        )}
                      </li>
                    ))}
                    {netReview.removedIds.map((id) => (
                      <li key={id}>
                        Retire net{' '}
                        {review.expected.nets?.find((net) => net.id === id)
                          ?.name ?? id}
                      </li>
                    ))}
                    {renamedNets.map(({ id, before, after }) => (
                      <li key={id}>
                        Rename net {before} → {after}
                      </li>
                    ))}
                  </ul>
                )}
                {!!deviceChanges.length && (
                  <ul aria-label="Reviewed device changes">
                    {deviceChanges.map(({ component, device, padChanges }) => (
                      <li key={component.id}>
                        {component.reference} · {device.packageName} ·{' '}
                        {device.revision}
                        {!!padChanges.length && (
                          <ul>
                            {padChanges.map(({ id, label, changes }) => (
                              <li key={id}>
                                {label} · {changes.join(', ')}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {!!(affectedCopper.length || shorts.length) && (
                  <ul aria-label="Affected copper">
                    {affectedCopper.map(({ id, unassigned }) => (
                      <li key={id}>
                        {id} ·{' '}
                        {unassigned
                          ? 'Net assignment needs review'
                          : 'Copper needs review'}
                      </li>
                    ))}
                    {shorts.map(({ netIds }, index) => (
                      <li key={index}>
                        Short between intended nets {netIds.join(', ')}
                      </li>
                    ))}
                  </ul>
                )}
                {!!hasBlockers && (
                  <ul aria-label="Issues to resolve">
                    {unresolved.map(({ id, reference, reason }) => (
                      <li key={id}>
                        {reference} · {reason}{' '}
                        <Button
                          size="small"
                          disabled={busy}
                          onClick={() => openMapping(id)}
                        >
                          Review device for {reference}
                        </Button>
                      </li>
                    ))}
                    {conflicts.map(({ id, schematic, board }) => (
                      <li key={id}>
                        Conflicting references · Schematic {schematic} · PCB{' '}
                        {board}
                      </li>
                    ))}
                    {duplicateReferences.map((ref) => (
                      <li key={ref}>Duplicate reference {ref}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {!!pendingBackAnnotations.length && (
              <ul aria-label="PCB reference changes">
                {pendingBackAnnotations.map(({ id, schematic, board }) => (
                  <li key={id}>
                    Schematic {schematic} · PCB {board}
                  </li>
                ))}
              </ul>
            )}
            {!!resolvedComponents.length && (
              <p>
                <select
                  aria-label="Component to replace"
                  value={replacement}
                  disabled={busy}
                  onChange={(event) => setReplacement(event.target.value)}
                >
                  <option value="">Choose a component</option>
                  {resolvedComponents.map(({ logicalId, reference }) => (
                    <option key={logicalId} value={logicalId}>
                      {reference}
                    </option>
                  ))}
                </select>{' '}
                <Button
                  disabled={busy || !replacement}
                  onClick={() => openMapping(replacement)}
                >
                  Review replacement device
                </Button>
              </p>
            )}
            {error && <p role="alert">{error}</p>}
          </DialogContent>
          <DialogActions>
            {!review.unchanged && (
              <Button
                appearance="primary"
                disabled={busy || !!hasBlockers}
                onClick={(): void => {
                  void run(async () => {
                    const undo = await update.apply(review);
                    if (undo) onApplied(undo);
                    onClose();
                    if (creating) onCreated(update.boardId);
                  });
                }}
              >
                {creating ? 'Create linked PCB' : 'Apply circuit update'}
              </Button>
            )}
            <Button disabled={busy} onClick={onClose}>
              {review.unchanged ? 'Close' : 'Cancel'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
