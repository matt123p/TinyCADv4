import React, { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
} from '@fluentui/react-components';
import type { CircuitSchematicSource } from '../../pcb/circuitSnapshot';
import type { ReferenceConflictChoice } from '../../pcb/referenceEco';
import type {
  BoardReferenceEdit,
  ProjectBackAnnotation,
  ProjectReferenceUndo,
} from '../../io/projectReferenceEco';

export type ReferenceDialogState =
  | { kind: 'edit'; operation: BoardReferenceEdit }
  | { kind: 'annotate'; operation: ProjectBackAnnotation };

export default function ProjectReferenceDialog({
  state,
  onClose,
  onApplied,
  onLocate,
}: {
  state: ReferenceDialogState;
  onClose: () => void;
  onApplied: (undo: ProjectReferenceUndo) => void;
  onLocate: (source: CircuitSchematicSource) => Promise<void>;
}) {
  const [edits, setEdits] = useState(new Map<string, string>());
  const [choices, setChoices] = useState(
    new Map<string, ReferenceConflictChoice>(),
  );
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const review =
    state.kind === 'annotate' ? state.operation.preview(choices) : undefined;

  async function run(action: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      await action();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

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
            {state.kind === 'edit'
              ? 'Edit PCB references'
              : 'Update Schematic from PCB'}
          </DialogTitle>
          <DialogContent style={{ overflowY: 'auto', maxHeight: '65vh' }}>
            {state.kind === 'edit' ? (
              <>
                <p>{state.operation.title}</p>
                <Input
                  value={filter}
                  aria-label="Filter references"
                  onChange={(_, data) => setFilter(data.value)}
                />
                <ul aria-label="PCB component references">
                  {state.operation.components
                    .filter(
                      ({ reference }) =>
                        !filter ||
                        reference?.toLowerCase().includes(filter.toLowerCase()),
                    )
                    .map(({ id, reference, value }) => (
                      <li key={id}>
                        <label>
                          {reference || id}
                          {value ? ' · ' + value : ''}{' '}
                          <Input
                            disabled={busy}
                            aria-label={'Reference for ' + (reference || id)}
                            value={edits.get(id) ?? reference ?? ''}
                            onChange={(_, data) =>
                              setEdits((previous) => {
                                const next = new Map(previous);
                                if (data.value === (reference ?? ''))
                                  next.delete(id);
                                else next.set(id, data.value);
                                return next;
                              })
                            }
                          />
                        </label>
                      </li>
                    ))}
                </ul>
              </>
            ) : (
              <>
                <p>
                  {state.operation.source} → {state.operation.target}
                </p>
                {!review.changes.length && !review.errors.length && (
                  <p role="status">
                    There are no PCB reference changes to apply.
                  </p>
                )}
                {!!review.changes.length && (
                  <ul aria-label="Reference changes">
                    {review.changes.map(
                      ({
                        componentId,
                        before,
                        pcb,
                        schematic,
                        result,
                        sources,
                      }) => (
                        <li key={componentId}>
                          {before} → {result ?? pcb}{' '}
                          {schematic !== before && schematic !== pcb && (
                            <label>
                              Resolve {before}{' '}
                              <select
                                disabled={busy}
                                aria-label={'Resolve ' + before}
                                value={choices.get(componentId) ?? ''}
                                onChange={(event) => {
                                  const choice = event.target.value as
                                    | ReferenceConflictChoice
                                    | '';
                                  setChoices((previous) => {
                                    const next = new Map(previous);
                                    if (choice) next.set(componentId, choice);
                                    else next.delete(componentId);
                                    return next;
                                  });
                                }}
                              >
                                <option value="">Choose a reference</option>
                                <option value="pcb">PCB · {pcb}</option>
                                <option value="schematic">
                                  Schematic · {schematic}
                                </option>
                              </select>
                            </label>
                          )}
                          <ul>
                            {sources.map((source, index) => (
                              <li key={source.unitId}>
                                <Button
                                  appearance="subtle"
                                  size="small"
                                  disabled={busy}
                                  onClick={(): void => {
                                    void run(() => onLocate(source));
                                  }}
                                >
                                  {source.documentPath} · unit {index + 1}
                                </Button>
                              </li>
                            ))}
                          </ul>
                        </li>
                      ),
                    )}
                  </ul>
                )}
                {!!review.errors.length && (
                  <ul aria-label="Reference issues">
                    {review.errors.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {error && <p role="alert">{error}</p>}
          </DialogContent>
          <DialogActions>
            <Button
              appearance="primary"
              disabled={
                busy || (state.kind === 'edit' ? !edits.size : !review.canApply)
              }
              onClick={(): void => {
                void run(async () => {
                  if (state.kind === 'edit') await state.operation.apply(edits);
                  else onApplied(await state.operation.apply(choices));
                });
              }}
            >
              {state.kind === 'edit'
                ? 'Save PCB references'
                : 'Apply reference changes'}
            </Button>
            <Button disabled={busy} onClick={onClose}>
              Cancel
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
