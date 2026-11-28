import React, { useRef, useState } from 'react';
import {
  Button,
  Checkbox,
  Input,
  Select,
  Textarea,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from '@fluentui/react-components';
import { saveAs } from 'file-saver';
import { openExternalUrl } from '../../util/navigation';
import { isFootprintDatasheetUrl } from '../../pcb/boardAssets';
import { createBoardModelAsset } from '../../pcb/boardCodec';
import {
  decodeFootprintLibrary,
  encodeFootprintLibrary,
  footprintDefinition,
  footprintLibraryExtension,
  importFootprintLibrary,
  inspectFootprintDimensions,
  makeFootprintPad,
  publishFootprintDevice,
  translateFootprintOrigin,
} from '../../pcb/footprintLibrary';
import type {
  FootprintDeviceMapping,
  FootprintLibrary,
} from '../../pcb/footprintLibrary';
import { boardCoordinateFields, boardInputLength } from '../pcb/boardNumberInput';
import type { starterFootprints } from '../../io/starterFootprints';
import type { PadStack } from '../../pcb/padstack';
import { footprintAssemblyMarks, footprintAssemblyNotesLimit } from '../../pcb/footprintDetails';
import type { FootprintAssembly, FootprintModel } from '../../pcb/footprintDetails';
import FootprintModelTransformEditor from './FootprintModelTransformEditor';
import FootprintLayoutTools from './FootprintLayoutTools';
import FootprintArtworkEditor from './FootprintArtworkEditor';
import { DeviceFootprintPreview } from './DeviceFootprintPreview';
import type { SvgViewportHandle } from '../svg/SvgViewport';

type PadDraft = {
  label: string;
  x: string;
  y: string;
  profile: Parameters<typeof makeFootprintPad>[0]['profile'];
  polygon: string;
  radius: string;
  width: string;
  height: string;
  hole: string;
  slot: string;
  plated: boolean;
};

const initialPad: PadDraft = {
  label: '1',
  x: '0',
  y: '0',
  profile: 'round',
  polygon: '',
  radius: '0.25',
  width: '1.6',
  height: '1.6',
  hole: '0',
  slot: '0',
  plated: true,
};
const emptyFootprint = (): FootprintLibrary => ({
  format: 'tinycad-footprint',
  version: 1,
  provenance: { kind: 'authored', source: 'TinyCAD footprint editor' },
  definition: {
    id: crypto.randomUUID(),
    name: 'Footprint',
    revision: '1',
    definitionDigest: '',
    pads: [],
  },
});
const mm = (length: number) => String(length / 1_000_000);
const nm = (text: string) => boardInputLength(text, 'mm');

export default function FootprintEditorDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  const footprintSvg = useRef<HTMLDivElement>(null);
  const footprintViewport = useRef<SvgViewportHandle>(null);
  const [file, setFile] = useState<FootprintLibrary>(emptyFootprint);
  const [starter, setStarter] =
    useState<Awaited<ReturnType<typeof starterFootprints>>>();
  const [starterId, setStarterId] = useState('');
  const starterDraft = starter?.find(({ id }) => id === starterId);
  const [messages, setMessages] = useState<
    readonly { severity: string; location: string; message: string }[]
  >([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [minimumAnnulus, setMinimumAnnulus] = useState('0.15');
  const [checks, setChecks] =
    useState<ReturnType<typeof inspectFootprintDimensions>>();
  const [publish, setPublish] = useState(false);
  const [device, setDevice] = useState({
    packageName: '',
    width: '',
    height: '',
    license: '',
    reviewer: '',
    evidence: '',
  });
  const [mappings, setMappings] = useState(
    new Map<string, FootprintDeviceMapping>(),
  );
  const [selected, setSelected] = useState('');
  const [surface, setSurface] = useState<'copper' | 'mask' | 'paste'>('copper');
  const [face, setFace] = useState<'top' | 'bottom'>('top');
  const [padDraft, setPadDraft] = useState(initialPad);
  const { definition } = file;
  const pad = definition.pads.find(({ id }) => id === selected);

  function updateDefinition(fields: Partial<FootprintLibrary['definition']>) {
    setChecks(undefined);
    setFile((old) => ({
      ...old,
      definition: { ...old.definition, ...fields },
    }));
  }

  function updateAssembly(fields: Partial<FootprintAssembly>) {
    const { marker, notes } = { ...definition.assembly, ...fields };
    updateDefinition({
      assembly: marker || notes ? {
        ...(marker ? { marker } : {}),
        ...(notes ? { notes } : {}),
      } : undefined,
    });
  }

  function updatePad(
    fields: Partial<FootprintLibrary['definition']['pads'][number]>,
  ) {
    updateDefinition({
      pads: definition.pads.map((item) =>
        item.id === selected ? { ...item, ...fields } : item,
      ),
    });
  }

  async function run(task: () => void | Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function open(input: File) {
    setMappings(new Map());
    if (input.name.toLowerCase().endsWith('.kicad_mod')) {
      if (input.size > 256_000)
        throw new Error('KiCad footprint exceeds the input size limit.');
      const imported = await importFootprintLibrary(
        await input.text(),
        input.name,
      );
      setMessages(imported.issues);
      if (!imported.footprint) return;
      setFile(imported.footprint);
      setSelected(imported.footprint.definition.pads[0]?.id ?? '');
      return;
    }
    if (input.size > 48 * 1024 * 1024)
      throw new Error('Native footprint exceeds the input size limit.');
    const opened = await decodeFootprintLibrary(
      new Uint8Array(await input.arrayBuffer()),
    );
    setFile(opened);
    setMessages(opened.issues ?? []);
    setSelected(opened.definition.pads[0]?.id ?? '');
  }

  function geometry(replace = false) {
    const created = makeFootprintPad({
      id: replace ? pad.id : crypto.randomUUID(),
      label: replace ? pad.label : padDraft.label,
      positionNm: replace
        ? pad.positionNm
        : { x: nm(padDraft.x), y: nm(padDraft.y) },
      profile: padDraft.profile,
      widthNm: nm(padDraft.width),
      heightNm: nm(padDraft.height),
      drillWidthNm: nm(padDraft.hole),
      drillLengthNm: Math.max(nm(padDraft.hole), nm(padDraft.slot)),
      plated: padDraft.plated,
      ...(padDraft.profile === 'roundrect'
        ? { cornerRadiusNm: nm(padDraft.radius) }
        : {}),
      ...(padDraft.profile === 'polygon'
        ? {
            polygon: padDraft.polygon
              .trim()
              .split(/\n+/)
              .map((line) => {
                const [x, y] = boardCoordinateFields(line, 2);
                return { x: nm(x), y: nm(y) };
              }),
          }
        : {}),
    });
    return created;
  }

  function addPad(replace = false) {
    const created = geometry(replace);
    if (replace) updatePad({ stack: created.stack });
    else updateDefinition({ pads: [...definition.pads, created] });
    setSelected(created.id);
  }

  function changeSurface(remove = false) {
    const stack: PadStack = pad.stack ?? { copper: {} };
    const layers = { ...stack[surface] };
    if (remove) delete layers[face];
    else {
      const shape = geometry(true).stack.copper.top;
      if (!shape)
        throw new Error('Choose a copper pad shape for this surface.');
      layers[face] = shape;
    }
    updatePad({ stack: { ...stack, [surface]: layers } });
  }

  function changeDrill(remove = false) {
    const stack: PadStack = pad.stack ?? { copper: {} };
    const { drill, ...surfaces } = stack;
    if (remove) updatePad({ stack: surfaces });
    else {
      const next = geometry(true).stack.drill;
      if (!next) throw new Error('Enter a positive drill width.');
      updatePad({
        stack: { ...surfaces, drill: { ...next, plated: padDraft.plated } },
      });
    }
  }

  async function attachModel(input: File, index?: number) {
    const attachments = definition.models ?? [];
    if (index === undefined && attachments.length >= 32)
      throw new Error('A footprint can have up to 32 model attachments.');
    if (input.size > 32 * 1024 * 1024)
      throw new Error('STEP file exceeds the input size limit.');
    const data = new Uint8Array(await input.arrayBuffer());
    if (
      !new TextDecoder()
        .decode(data.subarray(0, 1024))
        .includes('ISO-10303-21;')
    )
      throw new Error('Choose a STEP Part 21 file.');
    const asset = await createBoardModelAsset(data, input.name);
    const model: FootprintModel = {
      kind: 'step',
      source: input.name,
      quality: 'imported-unreviewed',
      offsetNm: [0, 0, 0],
      rotationMicrodegree: [0, 0, 0],
      scale: [1, 1, 1],
      assetId: asset.id,
    };
    const models =
      index === undefined
        ? [...attachments, model]
        : attachments.map((model, i) =>
            i === index
              ? {
                  ...model,
                  quality: 'imported-unreviewed' as const,
                  assetId: asset.id,
                }
              : model,
          );
    updateModels(models, asset);
  }

  function updateModels(
    models: readonly FootprintModel[],
    added?: FootprintLibrary['assets'][number],
  ) {
    const referenced = new Set(models.map(({ assetId }) => assetId));
    setChecks(undefined);
    setFile((current) => {
      const assets = (current.assets ?? []).filter(({ id }) =>
        referenced.has(id),
      );
      if (added && !assets.some(({ id }) => id === added.id))
        assets.push(added);
      return {
        ...current,
        assets,
        definition: { ...current.definition, models },
      };
    });
  }

  async function save(asDevice = false) {
    const { definitionDigest, datasheetUrl, ...fields } = definition;
    const url = datasheetUrl?.trim();
    const valid = await footprintDefinition({
      ...fields,
      ...(url ? { datasheetUrl: url } : {}),
    });
    const updated = { ...file, definition: valid };
    const bytes = asDevice
      ? await publishFootprintDevice(updated, {
          ...device,
          widthNm: nm(device.width),
          heightNm: nm(device.height),
          mappings,
        })
      : await encodeFootprintLibrary(updated);
    saveAs(
      new Blob([new Uint8Array(bytes).buffer], { type: 'application/json' }),
      valid.name.replace(/[^\p{L}\p{N}_.()+-]+/gu, '-') +
        (asDevice ? '.tcdevice.json' : footprintLibraryExtension),
    );
  }

  function exportPrintSvg() {
    const preview = footprintSvg.current?.querySelector('svg');
    if (!preview)
      throw new Error(
        'Add footprint geometry before exporting the print view.',
      );
    const view = preview.getAttribute('data-fit-view-box');
    const [, , width, height] = view.split(/\s+/).map(Number);
    const print = preview.cloneNode(true) as SVGSVGElement;
    print.setAttribute('viewBox', view);
    print.removeAttribute('data-fit-view-box');
    print.removeAttribute('data-view-box');
    const scene = print.querySelector(':scope > [data-svg-drawing]');
    if (scene) scene.replaceWith(...scene.childNodes);
    print.setAttribute('width', mm(width) + 'mm');
    print.setAttribute('height', mm(height) + 'mm');
    const drawing = new XMLSerializer().serializeToString(print);
    saveAs(
      new Blob([drawing], { type: 'image/svg+xml' }),
      'footprint-1-to-1.svg',
    );
  }

  const duplicateLabels = definition.pads
    .map(({ label }) => label)
    .filter((label, i, labels) => !!label && labels.indexOf(label) < i);

  return (
    <Dialog
      open
      onOpenChange={(_, data) => {
        if (!data.open && !busy) onClose();
      }}
    >
      <DialogSurface className="pcb-dialog pcb-dialog-wide">
        <DialogBody>
          <DialogTitle>Footprint editor</DialogTitle>
          <DialogContent>
            <fieldset disabled={busy}>
              <legend>Footprint</legend>
              <p>
                {starter ? (
                  <>
                    <label>
                      Starter footprint draft{' '}
                      <Select
                        value={starterId}
                        onChange={(event) => setStarterId(event.target.value)}
                      >
                        <option value="">Choose a package</option>
                        {starter.map(({ id, footprint }) => (
                          <option key={id} value={id}>
                            {footprint.definition.name}
                          </option>
                        ))}
                      </Select>
                    </label>{' '}
                    <Button
                      disabled={!starterDraft}
                      onClick={(): void => {
                        if (!starterDraft) return;
                        void run(async () => {
                          const { openStarterFootprint } = await import(
                            '../../io/starterFootprints'
                          );
                          const entry = starterDraft;
                          const draft = await openStarterFootprint(entry);
                          setFile(draft);
                          setMessages([]);
                          setMappings(
                            new Map(
                              draft.definition.pads.flatMap<
                                [string, FootprintDeviceMapping]
                              >(({ id, label }) => {
                                if (
                                  entry.documentation?.mechanicalPads?.includes(
                                    label,
                                  )
                                )
                                  return [
                                    [id, { kind: 'mechanical' } as const],
                                  ];
                                const terminal =
                                  entry.documentation?.pinoutByPad[label];
                                return terminal
                                  ? [
                                      [
                                        id,
                                        { kind: 'signal', terminal } as const,
                                      ],
                                    ]
                                  : [];
                              }),
                            ),
                          );
                          setDevice({
                            packageName: entry.documentation?.partNumber ?? '',
                            width: mm(entry.bodyNm[0]),
                            height: mm(entry.bodyNm[1]),
                            license: '',
                            reviewer: '',
                            evidence: entry.documentation
                              ? [
                                  entry.documentation.sourceRevision,
                                  entry.documentation.package,
                                  entry.documentation.pinout,
                                  entry.assemblyProcess,
                                ].join(' · ')
                              : '',
                          });
                          setChecks(undefined);
                          setSelected(draft.definition.pads[0]?.id ?? '');
                        });
                      }}
                    >
                      Open starter draft
                    </Button>
                    {starterDraft && (
                      <span>
                        {' '}
                        · Intended assembly · {starterDraft.assemblyProcess}
                      </span>
                    )}
                  </>
                ) : (
                  <Button
                    onClick={(): void => {
                      void run(async () => {
                        const { starterFootprints } = await import(
                          '../../io/starterFootprints'
                        );
                        setStarter(await starterFootprints());
                      });
                    }}
                  >
                    Browse starter footprint drafts
                  </Button>
                )}
              </p>

              <label>
                Open footprint{' '}
                <input
                  type="file"
                  accept=".kicad_mod,.tcfootprint.json"
                  onChange={(event) => {
                    const input = event.currentTarget.files[0];
                    event.currentTarget.value = '';
                    if (input) void run(() => open(input));
                  }}
                />
              </label>
              <p>
                <label>
                  Name{' '}
                  <Input
                    value={definition.name}
                    onChange={(event) =>
                      updateDefinition({ name: event.target.value })
                    }
                  />
                </label>{' '}
                <label>
                  Revision{' '}
                  <Input
                    value={definition.revision}
                    onChange={(event) =>
                      updateDefinition({ revision: event.target.value })
                    }
                  />
                </label>
              </p>
              <p>
                <label>
                  Datasheet URL{' '}
                  <Input
                    type="url"
                    value={definition.datasheetUrl ?? ''}
                    onChange={(event) =>
                      updateDefinition({ datasheetUrl: event.target.value })
                    }
                  />
                </label>{' '}
                {isFootprintDatasheetUrl(definition.datasheetUrl?.trim()) && (
                  <Button
                    appearance="subtle"
                    onClick={() =>
                      openExternalUrl(definition.datasheetUrl.trim())
                    }
                  >
                    Open datasheet
                  </Button>
                )}
              </p>
              <details>
                <summary>Assembly drawing</summary>
                <label>
                  Assembly marker{' '}
                  <Select
                    disabled={!definition.pads.length}
                    value={definition.assembly?.marker?.kind ?? ''}
                    onChange={(event) => {
                      const kind = event.target.value as FootprintAssembly['marker']['kind'] | '';
                      updateAssembly({ marker: kind ? {
                        kind,
                        padId: definition.assembly?.marker?.padId ?? pad?.id ?? definition.pads[0].id,
                      } : undefined });
                    }}
                  >
                    <option value="">No marker</option>
                    {Object.entries(footprintAssemblyMarks).map(([kind, { name }]) =>
                      <option key={kind} value={kind}>{name}</option>)}
                  </Select>
                </label>
                {definition.assembly?.marker && (
                  <label>
                    Marked pad{' '}
                    <Select
                      value={definition.assembly.marker.padId}
                      onChange={(event) => updateAssembly({ marker: {
                        ...definition.assembly.marker, padId: event.target.value,
                      } })}
                    >
                      {definition.pads.map(({ id, label }, index) =>
                        <option key={id} value={id}>{label || 'Unlabelled'} · {index + 1}</option>)}
                    </Select>
                  </label>
                )}
                <label>
                  Assembly notes{' '}
                  <Textarea value={definition.assembly?.notes ?? ''} maxLength={footprintAssemblyNotesLimit}
                    onChange={(event) => updateAssembly({ notes: event.target.value })}
                    onBlur={(event) => updateAssembly({ notes: event.target.value.trim() })}
                  />
                </label>
              </details>
              {!!messages.length && (
                <ul aria-label="KiCad import report">
                  {messages.map(({ severity, location, message }, index) => (
                    <li key={index}>
                      {severity === 'blocker' ? 'Blocked' : 'Review'} ·{' '}
                      {location} · {message}
                    </li>
                  ))}
                </ul>
              )}
              {!!duplicateLabels.length && (
                <p>
                  Repeated pad labels{' '}
                  {Array.from(new Set(duplicateLabels)).join(', ')}. Review each
                  pad separately when mapping a device.
                </p>
              )}
              {definition.pads.length > 0 && (
                <div ref={footprintSvg}>
                  <DeviceFootprintPreview
                    key={definition.id}
                    footprint={definition}
                    selected={selected}
                    viewportRef={footprintViewport}
                    onSelectPad={setSelected}
                    ruler
                  />
                  <Button onClick={() => footprintViewport.current?.fit()}>Fit footprint</Button>
                </div>
              )}
              {!!definition.pads.length && (
                <label>
                  Pad{' '}
                  <Select
                    value={selected}
                    onChange={(event) => setSelected(event.target.value)}
                  >
                    <option value="">Choose a pad</option>
                    {definition.pads.map(({ id, label }, index) => (
                      <option key={id} value={id}>
                        {label || 'Unlabelled'} · {index + 1}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              {pad && (
                <p key={pad.id}>
                  <label>
                    Pad label{' '}
                    <Input
                      value={pad.label}
                      onChange={(event) =>
                        updatePad({ label: event.target.value })
                      }
                    />
                  </label>{' '}
                  <label>
                    Pad X (mm){' '}
                    <Input
                      key={String(pad.id) + 'x' + pad.positionNm.x}
                      defaultValue={mm(pad.positionNm.x)}
                      onBlur={(event) => {
                        const value = event.target.value;
                        void run(() =>
                          updatePad({
                            positionNm: { ...pad.positionNm, x: nm(value) },
                          }),
                        );
                      }}
                    />
                  </label>{' '}
                  <label>
                    Pad Y (mm){' '}
                    <Input
                      key={String(pad.id) + 'y' + pad.positionNm.y}
                      defaultValue={mm(pad.positionNm.y)}
                      onBlur={(event) => {
                        const value = event.target.value;
                        void run(() =>
                          updatePad({
                            positionNm: { ...pad.positionNm, y: nm(value) },
                          }),
                        );
                      }}
                    />
                  </label>{' '}
                  <Button
                    size="small"
                    onClick={() => {
                      const duplicate = { ...pad, id: crypto.randomUUID() };
                      updateDefinition({
                        pads: [...definition.pads, duplicate],
                      });
                      setSelected(duplicate.id);
                    }}
                  >
                    Duplicate pad
                  </Button>{' '}
                  <Button
                    size="small"
                    onClick={() => {
                      const assembly = definition.assembly;
                      updateDefinition({
                        pads: definition.pads.filter(({ id }) => id !== pad.id),
                        ...(assembly?.marker?.padId.toLowerCase() === pad.id.toLowerCase()
                          ? { assembly: assembly.notes ? { notes: assembly.notes } : undefined }
                          : {}),
                      });
                      setSelected('');
                    }}
                  >
                    Remove pad
                  </Button>{' '}
                  <Button
                    size="small"
                    onClick={(): void => {
                      void run(() =>
                        updateDefinition(
                          translateFootprintOrigin(definition, pad.positionNm),
                        ),
                      );
                    }}
                  >
                    Use pad as origin
                  </Button>
                </p>
              )}
            </fieldset>
            <FootprintLayoutTools
              pads={definition.pads}
              selected={selected}
              busy={busy}
              run={run}
              onChange={(pads) => updateDefinition({ pads })}
            />
            <fieldset disabled={busy}>
              <legend>Add pad or hole</legend>
              <p>
                <label>
                  New pad label{' '}
                  <Input
                    value={padDraft.label}
                    onChange={(event) =>
                      setPadDraft({ ...padDraft, label: event.target.value })
                    }
                  />
                </label>{' '}
                <label>
                  Shape{' '}
                  <Select
                    aria-label="Pad shape"
                    value={padDraft.profile}
                    onChange={(event) =>
                      setPadDraft({
                        ...padDraft,
                        profile: event.target.value as PadDraft['profile'],
                      })
                    }
                  >
                    <option value="round">Round</option>
                    <option value="rectangle">Rectangle</option>
                    <option value="oval">Oval</option>
                    <option value="roundrect">Rounded rectangle</option>
                    <option value="polygon">Polygon</option>
                    <option value="hole">Non-plated hole or slot</option>
                  </Select>
                </label>
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {Object.entries({
                  x: 'X',
                  y: 'Y',
                  width: 'Width',
                  height: 'Height',
                  hole: 'Drill width',
                  slot: 'Slot length',
                }).map(([key, label]) => (
                  <label key={key}>
                    {label} (mm){' '}
                    <Input
                      size="small"
                      value={padDraft[key as keyof PadDraft] as string}
                      onChange={(event) =>
                        setPadDraft({ ...padDraft, [key]: event.target.value })
                      }
                    />
                  </label>
                ))}
              </div>
              {padDraft.profile === 'roundrect' && (
                <p>
                  <label>
                    Corner radius (mm){' '}
                    <Input
                      value={padDraft.radius}
                      onChange={(event) =>
                        setPadDraft({ ...padDraft, radius: event.target.value })
                      }
                    />
                  </label>
                </p>
              )}
              {padDraft.profile === 'polygon' && (
                <p>
                  <label>
                    Local vertices (one X Y pair per line in mm)
                    <br />
                    <Textarea
                      value={padDraft.polygon}
                      onChange={(event) =>
                        setPadDraft({
                          ...padDraft,
                          polygon: event.target.value,
                        })
                      }
                    />
                  </label>
                </p>
              )}
              <p>
                <label>
                  <Checkbox
                    checked={padDraft.plated}
                    onChange={(event) =>
                      setPadDraft({ ...padDraft, plated: event.target.checked })
                    }
                  />{' '}
                  Plated drill
                </label>{' '}
                <Button
                  onClick={(): void => {
                    void run(() => addPad());
                  }}
                >
                  Add pad
                </Button>{' '}
                <Button
                  disabled={!pad}
                  onClick={(): void => {
                    void run(() => addPad(true));
                  }}
                >
                  Replace selected pad geometry
                </Button>
              </p>
            </fieldset>
            {pad && (
              <fieldset disabled={busy}>
                <legend>Selected pad surfaces and drill</legend>
                <p>
                  <label>
                    Surface{' '}
                    <Select
                      value={surface}
                      onChange={(event) =>
                        setSurface(event.target.value as typeof surface)
                      }
                    >
                      <option value="copper">Copper</option>
                      <option value="mask">Mask</option>
                      <option value="paste">Paste</option>
                    </Select>
                  </label>{' '}
                  <label>
                    Face{' '}
                    <Select
                      value={face}
                      onChange={(event) =>
                        setFace(event.target.value as typeof face)
                      }
                    >
                      <option value="top">Top</option>
                      <option value="bottom">Bottom</option>
                    </Select>
                  </label>{' '}
                  <Button
                    size="small"
                    onClick={(): void => {
                      void run(() => changeSurface());
                    }}
                  >
                    Set surface from pad shape
                  </Button>{' '}
                  <Button
                    size="small"
                    disabled={!pad.stack?.[surface]?.[face]}
                    onClick={() => changeSurface(true)}
                  >
                    Remove surface
                  </Button>
                </p>
                <p>
                  <Button
                    size="small"
                    onClick={(): void => {
                      void run(() => changeDrill());
                    }}
                  >
                    Set drill from dimensions
                  </Button>{' '}
                  <Button
                    size="small"
                    disabled={!pad.stack?.drill}
                    onClick={() => changeDrill(true)}
                  >
                    Remove drill
                  </Button>
                </p>
              </fieldset>
            )}
            <FootprintArtworkEditor
              key={definition.id}
              busy={busy}
              run={run}
              graphics={definition.graphics ?? []}
              onChange={(graphics) => updateDefinition({ graphics })}
            />
            <fieldset disabled={busy}>
              <legend>STEP models</legend>
              <label>
                Add STEP model{' '}
                <input
                  type="file"
                  accept=".step,.stp"
                  onChange={(event) => {
                    const input = event.currentTarget.files[0];
                    event.currentTarget.value = '';
                    if (input) void run(() => attachModel(input));
                  }}
                />
              </label>
              {(definition.models ?? []).map((model, index) => (
                <div
                  key={model.source + ':' + index}
                  style={{ marginBlock: 8 }}
                >
                  <label>
                    {model.source}
                    {model.assetId
                      ? ' · Embedded'
                      : ' · Select local STEP file'}{' '}
                    <input
                      type="file"
                      accept=".step,.stp"
                      onChange={(event) => {
                        const input = event.currentTarget.files[0];
                        event.currentTarget.value = '';
                        if (input) void run(() => attachModel(input, index));
                      }}
                    />
                  </label>
                  {model.assetId && (
                    <label>
                      {' '}
                      Model license{' '}
                      <Input
                        value={
                          file.assets?.find(({ id }) => id === model.assetId)
                            ?.license ?? ''
                        }
                        onChange={(event) => {
                          const license = event.target.value;
                          setFile((old) => ({
                            ...old,
                            assets: old.assets?.map((asset) =>
                              asset.id === model.assetId
                                ? { ...asset, license }
                                : asset,
                            ),
                          }));
                        }}
                      />
                    </label>
                  )}
                  <Button
                    size="small"
                    onClick={() =>
                      updateModels(
                        definition.models.filter((_, i) => index !== i),
                      )
                    }
                  >
                    Remove {model.source}
                  </Button>
                  <FootprintModelTransformEditor
                    key={
                      model.offsetNm.join(',') +
                      model.rotationMicrodegree.join(',') +
                      model.scale.join(',')
                    }
                    model={model}
                    run={run}
                    onChange={(modified) =>
                      updateDefinition({
                        models: definition.models.map((value, i) =>
                          i === index ? modified : value,
                        ),
                      })
                    }
                  />
                </div>
              ))}
            </fieldset>
            <fieldset disabled={busy || !definition.pads.length}>
              <legend>Dimensions</legend>
              <label>
                Minimum annular ring (mm){' '}
                <Input
                  value={minimumAnnulus}
                  size="small"
                  onChange={(event) => {
                    setMinimumAnnulus(event.target.value);
                    setChecks(undefined);
                  }}
                />
              </label>{' '}
              <Button
                onClick={(): void => {
                  void run(async () => {
                    const { projectPcbKernel } = await import(
                      '../../io/projectPcbKernel'
                    );
                    setChecks(
                      inspectFootprintDimensions(
                        definition,
                        await projectPcbKernel(),
                        nm(minimumAnnulus),
                      ),
                    );
                  });
                }}
              >
                Check footprint dimensions
              </Button>
              {checks &&
                (checks.length ? (
                  <ul aria-label="Footprint findings">
                    {checks.map(({ location, message }, index) => (
                      <li key={index}>
                        {location} · {message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p role="status">No findings for these dimension checks.</p>
                ))}
            </fieldset>
            {publish && (
              <fieldset disabled={busy}>
                <legend>Reviewed device</legend>
                {Object.entries({
                  packageName: 'Package name',
                  width: 'Body width (mm)',
                  height: 'Body height (mm)',
                  license: 'Device license',
                  reviewer: 'Reviewed by',
                  evidence: 'Review evidence',
                }).map(([key, label]) => (
                  <p key={key}>
                    <label>
                      {label}{' '}
                      <Input
                        value={device[key as keyof typeof device]}
                        onChange={(event) =>
                          setDevice({ ...device, [key]: event.target.value })
                        }
                      />
                    </label>
                  </p>
                ))}
                <ul aria-label="Pad assignments">
                  {definition.pads.map(({ id, label }, index) => {
                    const map = mappings.get(id);
                    return (
                      <li key={id}>
                        {label || 'Unlabelled'} · {index + 1}{' '}
                        <Select
                          aria-label={`Assignment for pad ${label} (${
                            index + 1
                          })`}
                          value={map?.kind ?? ''}
                          onChange={(event) => {
                            const kind = event.target.value as
                              | FootprintDeviceMapping['kind']
                              | '';
                            setMappings((old) => {
                              const next = new Map(old);
                              if (kind === 'signal')
                                next.set(id, { kind, terminal: '' });
                              else if (kind) next.set(id, { kind });
                              else next.delete(id);
                              return next;
                            });
                          }}
                        >
                          <option value="">Choose assignment</option>
                          <option value="signal">Signal</option>
                          <option value="nc">No connect</option>
                          <option value="reserved">Reserved</option>
                          <option value="mechanical">Mechanical</option>
                        </Select>{' '}
                        {map?.kind === 'signal' && (
                          <Input
                            aria-label={`Terminal for pad ${label} (${
                              index + 1
                            })`}
                            value={map.terminal}
                            onChange={(event) => {
                              const terminal = event.target.value;
                              setMappings((old) =>
                                new Map(old).set(id, {
                                  kind: 'signal',
                                  terminal,
                                }),
                              );
                            }}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
                <Button
                  disabled={busy}
                  onClick={(): void => {
                    void run(() => save(true));
                  }}
                >
                  Export reviewed device
                </Button>
              </fieldset>
            )}
            {error && <p role="alert">{error}</p>}
          </DialogContent>
          <DialogActions>
            <Button
              appearance="primary"
              disabled={busy || !definition.pads.length}
              onClick={(): void => {
                void run(() => save());
              }}
            >
              Export footprint
            </Button>
            <Button
              disabled={busy || !definition.pads.length}
              aria-expanded={publish}
              onClick={() => setPublish(!publish)}
            >
              {publish ? 'Hide device mapping' : 'Map as device'}
            </Button>
            <Button
              disabled={busy || !definition.pads.length}
              onClick={(): void => {
                void run(exportPrintSvg);
              }}
            >
              Export 1:1 SVG
            </Button>
            <Button disabled={busy} onClick={onClose}>
              Close
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
