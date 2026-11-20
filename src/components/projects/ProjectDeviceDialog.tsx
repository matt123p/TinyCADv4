import React, { useEffect, useState } from 'react';
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
import { saveAs } from 'file-saver';
import type { ProjectDeviceReview } from '../../io/projectDevices';
import { hasBoardConnectivity } from '../../pcb/circuitSnapshot';
import {
  boardComponentDevice,
  deviceMappingIssues,
  previewDeviceReview,
} from '../../pcb/deviceReview';
import type { DeviceBindings, DeviceReview } from '../../pcb/deviceReview';
import {
  deviceLibraryExtension,
  maxDeviceLibraryBytes,
  searchLibraryDevices,
  writeLibraryDevice,
} from '../../pcb/deviceLibrary';
import type { LibraryDevice } from '../../pcb/deviceLibrary';
import {
  DeviceFootprintPreview,
  SchematicTerminalPreview,
} from './DeviceMappingPreview';

export default function ProjectDeviceDialog({
  review,
  onClose,
}: {
  review: ProjectDeviceReview;
  onClose: () => void;
}) {
  const { board, circuit } = review;
  const components = circuit.components.filter(
    ({ role }) => hasBoardConnectivity(role) && role !== 'pcb-only',
  );
  const [componentId, setComponentId] = useState(components[0]?.id ?? '');
  const [catalogue, setCatalogue] = useState(review.catalogue);
  const [deviceKey, setDeviceKey] = useState('');
  const [selectedPad, setSelectedPad] = useState('');
  const [bindings, setBindings] = useState<DeviceBindings>([]);
  const [proposal, setProposal] = useState<DeviceReview>();
  const [query, setQuery] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [pitch, setPitch] = useState('');
  const [padCount, setPadCount] = useState('');
  const [mount, setMount] = useState<LibraryDevice['mount'] | ''>('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [pinSource, setPinSource] =
    useState<Awaited<ReturnType<ProjectDeviceReview['readUnit']>>>();
  const [pinSourceError, setPinSourceError] = useState('');
  const [selectedTerminal, setSelectedTerminal] = useState(0);
  const part = components.find(({ id }) => id === componentId);
  const current = boardComponentDevice(board, componentId);
  const criteria = searchLibraryDevices(catalogue.devices, {
    packageHint: part?.packageHint,
    query,
    mount: mount || undefined,
    maxWidthNm: width ? Number(width) * 1_000_000 : undefined,
    maxHeightNm: height ? Number(height) * 1_000_000 : undefined,
    pitchNm: pitch ? Math.round(Number(pitch) * 1_000_000) : undefined,
    padCount: padCount ? Number(padCount) : undefined,
  });
  const candidates = [
    ...criteria.exact,
    ...criteria.matches.filter((item) => !criteria.exact.includes(item)),
  ];
  const chosen = candidates.find(({ digest }) => digest === deviceKey);
  const pads = chosen?.definition.footprint.pads ?? [];
  const selectedAssignment = chosen?.definition.assignments.find(
    ({ padId }) => padId === selectedPad,
  );
  const selectedSignal =
    selectedAssignment?.kind === 'signal'
      ? part?.signals.find(
          ({ id }) =>
            id ===
            bindings.find(
              ({ terminalId }) => terminalId === selectedAssignment.signalId,
            )?.signalId,
        )
      : undefined;
  const terminal =
    selectedSignal?.terminals[selectedTerminal] ?? selectedSignal?.terminals[0];
  const issues =
    part && chosen ? deviceMappingIssues(part, chosen, bindings) : [];

  useEffect(() => {
    setPinSource(undefined);
    setPinSourceError('');
    if (!terminal) return;
    let current = true;
    review.readUnit(terminal.unitId).then(
      (source) => {
        if (current) setPinSource(source);
      },
      (error) => {
        if (current) setPinSourceError(String(error));
      },
    );
    return () => {
      current = false;
    };
  }, [review, terminal]);

  async function run(action: () => Promise<void>) {
    setStatus('');
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
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
      <DialogSurface style={{ maxWidth: 960 }}>
        <DialogBody>
          <DialogTitle>Review PCB devices</DialogTitle>
          <DialogContent style={{ maxHeight: '68vh', overflowY: 'auto' }}>
            <fieldset
              disabled={busy || !!proposal}
              style={{ border: 0, padding: 0, margin: 0 }}
            >
              <label>
                Component{' '}
                <select
                  aria-label="Component"
                  value={componentId}
                  onChange={(event) => {
                    setComponentId(event.target.value);
                    setDeviceKey('');
                    setBindings([]);
                    setSelectedPad('');
                  }}
                >
                  {components.map((component) => (
                    <option key={component.id} value={component.id}>
                      {component.reference} · {component.value}
                    </option>
                  ))}
                </select>
              </label>
              {current.device && (
                <p>
                  Applied device {current.device.packageName} ·{' '}
                  {current.device.revision}
                </p>
              )}
              <p>
                <label>
                  Add device library file{' '}
                  <input
                    type="file"
                    accept={deviceLibraryExtension}
                    onChange={(event) => {
                      const file = event.target.files[0];
                      event.target.value = '';
                      if (file)
                        void run(async () => {
                          if (file.size > maxDeviceLibraryBytes)
                            throw new Error(
                              'Device file exceeds the size limit.',
                            );
                          setCatalogue(
                            await review.addLibrary(
                              file.name,
                              new Uint8Array(await file.arrayBuffer()),
                            ),
                          );
                        });
                    }}
                  />
                </label>
              </p>
              {catalogue.warnings.length > 0 && (
                <ul>
                  {catalogue.warnings.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Input
                  aria-label="Search devices"
                  placeholder="Search devices"
                  value={query}
                  onChange={(_, data) => setQuery(data.value)}
                />
                <Input
                  aria-label="Maximum body width in mm"
                  placeholder="Max width (mm)"
                  type="number"
                  min={0}
                  value={width}
                  onChange={(_, data) => setWidth(data.value)}
                />
                <Input
                  aria-label="Maximum body height in mm"
                  placeholder="Max height (mm)"
                  type="number"
                  min={0}
                  value={height}
                  onChange={(_, data) => setHeight(data.value)}
                />
                <Input
                  aria-label="Pad pitch in mm"
                  placeholder="Pitch (mm)"
                  type="number"
                  min={0}
                  value={pitch}
                  onChange={(_, data) => setPitch(data.value)}
                />
                <Input
                  aria-label="Pad count"
                  placeholder="Pad count"
                  type="number"
                  min={1}
                  value={padCount}
                  onChange={(_, data) => setPadCount(data.value)}
                />
                <select
                  aria-label="Mount style"
                  value={mount}
                  onChange={(event) =>
                    setMount(event.target.value as typeof mount)
                  }
                >
                  <option value="">Any mount style</option>
                  <option value="surface-mount">Surface mount</option>
                  <option value="through-hole">Through hole</option>
                  <option value="mixed">Mixed</option>
                </select>
              </div>
              <p>
                {part?.packageHint
                  ? `Package hint ${part.packageHint} · ${criteria.exact.length} matching revisions`
                  : 'No package hint. Choose a reviewed device.'}
              </p>
              <label>
                Device revision{' '}
                <select
                  aria-label="Device revision"
                  value={chosen?.digest ?? ''}
                  onChange={(event) => {
                    const candidate = candidates.find(
                      ({ digest }) => digest === event.target.value,
                    );
                    setDeviceKey(event.target.value);
                    setSelectedPad('');
                    setBindings(
                      candidate &&
                        current.device?.library?.id === candidate.definition.id
                        ? current.device.library.bindings
                        : [],
                    );
                  }}
                >
                  <option value="">Choose a device</option>
                  {candidates.map(({ definition, digest }) => (
                    <option key={digest} value={digest}>
                      {definition.name} · {definition.revision} ·{' '}
                      {definition.footprint.pads.length} pads
                    </option>
                  ))}
                </select>
              </label>
              {chosen && part && (
                <>
                  <p>
                    Reviewed by {chosen.definition.review.by} ·{' '}
                    {chosen.definition.review.evidence}
                  </p>
                  <table style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Footprint pad</th>
                        <th>Assignment</th>
                        <th>Schematic signal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pads.map((pad, index) => {
                        const assignment = chosen.definition.assignments.find(
                          ({ padId }) => padId === pad.id,
                        );
                        const slot =
                          assignment.kind === 'signal' &&
                          chosen.definition.terminals.find(
                            ({ id }) => id === assignment.signalId,
                          );
                        return (
                          <tr key={pad.id}>
                            <td>
                              <Button
                                size="small"
                                appearance={
                                  selectedPad === pad.id ? 'primary' : 'subtle'
                                }
                                onClick={() => {
                                  setSelectedPad(pad.id);
                                  setSelectedTerminal(0);
                                }}
                              >
                                {pad.label} ({index + 1})
                              </Button>
                            </td>
                            <td>{slot ? slot.name : assignment.kind}</td>
                            <td>
                              {slot && (
                                <select
                                  aria-label={`Signal for pad ${pad.label} (${
                                    index + 1
                                  })`}
                                  value={
                                    bindings.find(
                                      ({ terminalId }) =>
                                        terminalId === slot.id,
                                    )?.signalId ?? ''
                                  }
                                  onFocus={() => {
                                    setSelectedPad(pad.id);
                                    setSelectedTerminal(0);
                                  }}
                                  onChange={(event) => {
                                    setSelectedPad(pad.id);
                                    setSelectedTerminal(0);
                                    const signalId = event.target.value;
                                    setBindings((old) => [
                                      ...old.filter(
                                        ({ terminalId }) =>
                                          terminalId !== slot.id,
                                      ),
                                      ...(signalId
                                        ? [{ terminalId: slot.id, signalId }]
                                        : []),
                                    ]);
                                  }}
                                >
                                  <option value="">Choose signal</option>
                                  {part.signals.map((signal) => (
                                    <option key={signal.id} value={signal.id}>
                                      {signal.number
                                        ? `${signal.number} · `
                                        : ''}
                                      {signal.name} ·{' '}
                                      {signal.terminals
                                        .map(
                                          ({ unitId }) =>
                                            part.units.findIndex(
                                              ({ id }) => id === unitId,
                                            ) + 1,
                                        )
                                        .join(', ')}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!!issues.length && (
                    <ul>
                      {issues.map((issue, index) => (
                        <li key={index}>{issue}</li>
                      ))}
                    </ul>
                  )}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 12,
                    }}
                  >
                    <div>
                      <strong>Schematic</strong>
                      {!!selectedSignal &&
                        selectedSignal.terminals.length > 1 && (
                          <select
                            aria-label="Source terminal"
                            value={selectedTerminal}
                            onChange={(event) =>
                              setSelectedTerminal(Number(event.target.value))
                            }
                          >
                            {selectedSignal.terminals.map((source, index) => (
                              <option
                                key={source.unitId + source.pinId}
                                value={index}
                              >
                                {circuit.sources?.[source.unitId]?.documentPath}{' '}
                                · unit{' '}
                                {part.units.findIndex(
                                  ({ id }) => id === source.unitId,
                                ) + 1}
                              </option>
                            ))}
                          </select>
                        )}
                      {pinSource && terminal && (
                        <SchematicTerminalPreview
                          unit={pinSource}
                          pinId={terminal.pinId}
                        />
                      )}
                      {pinSourceError && <p role="alert">{pinSourceError}</p>}
                    </div>
                    <div>
                      <strong>Footprint</strong>
                      <DeviceFootprintPreview
                        footprint={chosen.definition.footprint}
                        selected={selectedPad}
                      />
                    </div>
                  </div>
                </>
              )}
            </fieldset>
            {status && <p role="alert">{status}</p>}
            {proposal && (
              <section aria-label="Proposed device changes">
                <h3>Proposed changes</h3>
                <p>
                  {proposal.previous.device?.revision ?? 'Unassigned'} →{' '}
                  {proposal.device.revision}
                </p>
                {proposal.padChanges.length > 0 && (
                  <ul>
                    {proposal.padChanges.map(({ id, label, changes }) => (
                      <li key={id}>
                        {label} · {changes.join(', ')}
                      </li>
                    ))}
                  </ul>
                )}
                {proposal.graphicsChanged && <p>Footprint artwork changed.</p>}
                {proposal.modelsChanged && <p>Model attachments changed.</p>}
                {proposal.previous.footprint && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 12,
                    }}
                  >
                    <div>
                      Applied footprint
                      <DeviceFootprintPreview
                        footprint={proposal.previous.footprint}
                        selected={selectedPad}
                      />
                    </div>
                    <div>
                      Proposed footprint
                      <DeviceFootprintPreview
                        footprint={proposal.footprint}
                        selected={selectedPad}
                      />
                    </div>
                  </div>
                )}
              </section>
            )}
          </DialogContent>
          <DialogActions>
            {proposal ? (
              <>
                <Button disabled={busy} onClick={() => setProposal(undefined)}>
                  Back
                </Button>
                <Button
                  appearance="primary"
                  disabled={busy}
                  onClick={(): void =>
                    void run(async () => {
                      await review.apply(proposal);
                      onClose();
                    })
                  }
                >
                  Apply reviewed device
                </Button>
              </>
            ) : (
              <>
                <Button
                  disabled={busy || !chosen}
                  onClick={(): void =>
                    void run(async () => {
                      const data = await writeLibraryDevice(chosen.definition);
                      saveAs(
                        new Blob([new Uint8Array(data).buffer], {
                          type: 'application/json',
                        }),
                        chosen.definition.id + deviceLibraryExtension,
                      );
                    })
                  }
                >
                  Export library device
                </Button>
                <Button
                  appearance="primary"
                  disabled={busy || !chosen || !!issues.length || !part}
                  onClick={(): void =>
                    void run(async () => {
                      setProposal(
                        await previewDeviceReview(
                          board,
                          circuit,
                          part.id,
                          chosen,
                          bindings,
                        ),
                      );
                    })
                  }
                >
                  Preview device changes
                </Button>
              </>
            )}
            <Button disabled={busy} onClick={onClose}>
              Close
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
