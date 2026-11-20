import { BoardRevisionConflict, validateBoard } from './board';
import type { BoardDocument } from './board';
import type {
  BoardComponent,
  EmbeddedDevice,
  EmbeddedFootprint,
} from './boardAssets';
import {
  circuitConnectivityDigest,
  hasBoardConnectivity,
} from './circuitSnapshot';
import type { CircuitComponent, CircuitSnapshot } from './circuitSnapshot';
import { canonicalDeviceJson, deviceDigest } from './deviceLibrary';
import type { DeviceRevision } from './deviceLibrary';
import { stableHierarchyId } from './hierarchicalNetlist';
import { validatePadMap } from './footprint';
import type { PadAssignment } from './footprint';

export type DeviceBindings = NonNullable<EmbeddedDevice['library']>['bindings'];

export function boardComponentDevice(board: BoardDocument, logicalId: string) {
  const part = board.components?.find(
    ({ id, logicalId: logical }) => (logical ?? id) === logicalId,
  );
  const placement =
    part &&
    board.footprints?.find(({ componentId }) => componentId === part.id);
  const device = board.deviceDefinitions?.find(
    ({ id }) => id === (part?.deviceId ?? placement?.deviceId),
  );
  const footprint = board.footprintDefinitions?.find(
    ({ id }) => id === device?.footprintId,
  );
  return { part, placement, device, footprint };
}

export function deviceMappingIssues(
  component: CircuitComponent,
  library: DeviceRevision,
  bindings: DeviceBindings,
) {
  const source = library.definition;
  const slots = new Map(source.terminals.map(({ id, name }) => [id, name]));
  const signals = new Map(component.signals.map(({ id, name }) => [id, name]));
  const usedSlots = new Set<string>();
  const usedSignals = new Set<string>();
  const errors: string[] = [];
  for (const { terminalId, signalId } of bindings) {
    if (!slots.has(terminalId))
      errors.push('A binding refers to an unknown device terminal.');
    else if (usedSlots.has(terminalId))
      errors.push(
        `Device terminal ${slots.get(terminalId)} is assigned more than once.`,
      );
    if (!signals.has(signalId))
      errors.push(
        `Choose a schematic signal for ${
          slots.get(terminalId) ?? 'the terminal'
        }.`,
      );
    else if (usedSignals.has(signalId))
      errors.push(
        `Schematic signal ${signals.get(signalId)} is assigned more than once.`,
      );
    usedSlots.add(terminalId);
    usedSignals.add(signalId);
  }
  for (const [id, name] of slots)
    if (!usedSlots.has(id))
      errors.push(`Device terminal ${name} needs a signal.`);
  for (const [id, name] of signals)
    if (!usedSignals.has(id))
      errors.push(`Schematic signal ${name} needs a pad mapping.`);
  return errors;
}

export async function previewDeviceReview(
  board: BoardDocument,
  circuit: CircuitSnapshot,
  componentId: string,
  revision: DeviceRevision,
  bindings: DeviceBindings,
) {
  const currentSource = board.sourceCircuit;
  if (
    !currentSource ||
    currentSource.documentId !== circuit.documentId ||
    currentSource.revision !== circuit.revision ||
    currentSource.connectivityDigest !==
      (await circuitConnectivityDigest(circuit))
  )
    throw new Error('The circuit does not match the applied board revision.');
  const component = circuit.components.find(({ id }) => id === componentId);
  if (
    !component ||
    !hasBoardConnectivity(component.role) ||
    component.role === 'pcb-only'
  )
    throw new Error('Choose a schematic component with a physical board role.');
  const issues = deviceMappingIssues(component, revision, bindings);
  if (issues.length) throw new Error(issues.join(' '));

  const definition = revision.definition;
  const previous = boardComponentDevice(board, componentId);
  if (
    previous.device?.library?.id === definition.id &&
    previous.device.revision === definition.revision &&
    previous.device.library.digest !== revision.digest
  )
    throw new Error(
      'The library revision has changed contents. Publish it under a new revision.',
    );
  const slotSignals = new Map(
    bindings.map(({ terminalId, signalId }) => [terminalId, signalId]),
  );
  const assignments: PadAssignment[] = definition.assignments.map(
    (assignment) =>
      assignment.kind === 'signal'
        ? { ...assignment, signalId: slotSignals.get(assignment.signalId) }
        : assignment,
  );
  const signalIds = component.signals.map(({ id }) => id);
  const mapErrors = validatePadMap(
    signalIds,
    definition.footprint.pads,
    assignments,
  );
  if (mapErrors.length) throw new Error(mapErrors.join(' '));
  const footprint: EmbeddedFootprint = {
    ...definition.footprint,
    id: await stableHierarchyId(
      'library-footprint',
      definition.footprint.id,
      definition.footprint.definitionDigest,
    ),
  };
  const fields = {
    id: await stableHierarchyId(
      'reviewed-board-device',
      board.boardId,
      componentId,
    ),
    revision: definition.revision,
    packageName: definition.packageNames[0],
    packageSource: definition.source,
    footprintId: footprint.id,
    signalIds,
    assignments,
    library: {
      id: definition.id,
      digest: revision.digest,
      footprintId: definition.footprint.id,
      evidence: definition.review.evidence,
      reviewer: definition.review.by,
      license: definition.license,
      bindings: [...bindings].sort((a, b) =>
        a.terminalId.localeCompare(b.terminalId),
      ),
    },
  };
  const device: EmbeddedDevice = {
    ...fields,
    definitionDigest: await deviceDigest(fields),
  };
  const before = new Map(previous.footprint?.pads.map((pad) => [pad.id, pad]));
  const after = new Map(footprint.pads.map((pad) => [pad.id, pad]));
  const oldMap = new Map(
    previous.device?.assignments.map((item) => [item.padId, item]),
  );
  const newMap = new Map(assignments.map((item) => [item.padId, item]));
  const padChanges = [...new Set([...before.keys(), ...after.keys()])].flatMap(
    (id) => {
      const oldPad = before.get(id);
      const newPad = after.get(id);
      const changes: string[] = [];
      if (!oldPad) changes.push('Added');
      else if (!newPad) changes.push('Removed');
      else {
        if (oldPad.label !== newPad.label) changes.push('Label');
        if (
          canonicalDeviceJson(oldPad.positionNm) !==
          canonicalDeviceJson(newPad.positionNm)
        )
          changes.push('Position');
        if (
          canonicalDeviceJson(oldPad.stack) !==
          canonicalDeviceJson(newPad.stack)
        )
          changes.push('Padstack or drill');
        if (
          canonicalDeviceJson(oldMap.get(id)) !==
          canonicalDeviceJson(newMap.get(id))
        )
          changes.push('Signal or pad role');
      }
      return changes.length
        ? [{ id, label: newPad?.label ?? oldPad?.label, changes }]
        : [];
    },
  );
  const knownNets = new Set(board.nets?.map(({ id }) => id));
  const terminalNets = new Map(
    circuit.nets
      .filter(({ id }) => knownNets.has(id))
      .flatMap(({ id, terminals }) =>
        terminals.map(
          (terminal) => [terminal.unitId + ':' + terminal.pinId, id] as const,
        ),
      ),
  );
  const newComponent: BoardComponent = {
    id: componentId,
    logicalId: component.id,
    reference: component.reference,
    value: component.value,
    role: component.role as BoardComponent['role'],
    units: component.units,
    signals: component.signals.flatMap(({ id, terminals }) => {
      const netId = terminals
        .map((terminal) =>
          terminalNets.get(terminal.unitId + ':' + terminal.pinId),
        )
        .find(Boolean);
      return netId ? [{ signalId: id, netId }] : [];
    }),
  };
  return {
    expected: board,
    component: { ...(previous.part ?? newComponent), deviceId: device.id },
    previous,
    device,
    footprint,
    models: definition.models ?? [],
    padChanges,
    graphicsChanged:
      canonicalDeviceJson(previous.footprint?.graphics ?? []) !==
      canonicalDeviceJson(footprint.graphics ?? []),
    modelsChanged:
      canonicalDeviceJson(previous.footprint?.models ?? []) !==
      canonicalDeviceJson(footprint.models ?? []),
  };
}

export type DeviceReview = Awaited<ReturnType<typeof previewDeviceReview>>;

export function applyDeviceReview(
  board: BoardDocument,
  review: DeviceReview,
): BoardDocument {
  if (
    board.boardId !== review.expected.boardId ||
    board.revision !== review.expected.revision ||
    canonicalDeviceJson(board) !== canonicalDeviceJson(review.expected)
  )
    throw new BoardRevisionConflict(review.expected.revision, board.revision);

  const { component, device, footprint } = review;
  const components = [
    ...(board.components ?? []).filter(({ id }) => id !== component.id),
    component,
  ];
  const footprints = (board.footprints ?? []).map((placement) =>
    placement.componentId === component.id
      ? { ...placement, deviceId: device.id }
      : placement,
  );
  const usedDevices = new Set([
    ...components.map((item) => item.deviceId),
    ...footprints.map((item) => item.deviceId),
  ]);
  const deviceDefinitions = [
    ...(board.deviceDefinitions ?? []).filter(
      ({ id }) =>
        id !== device.id &&
        (id !== review.previous.device?.id || usedDevices.has(id)),
    ),
    device,
  ];
  const usedFootprints = new Set(
    deviceDefinitions.map(({ footprintId }) => footprintId),
  );
  const footprintDefinitions = [
    ...(board.footprintDefinitions ?? []).filter(
      ({ id }) =>
        id !== footprint.id &&
        (id !== review.previous.footprint?.id || usedFootprints.has(id)),
    ),
    footprint,
  ];
  const previousAssets = new Set(
    review.previous.footprint?.models?.map(({ assetId }) => assetId) ?? [],
  );
  const usedAssets = new Set(
    footprintDefinitions.flatMap(
      (item) => item.models?.map(({ assetId }) => assetId) ?? [],
    ),
  );
  const assets = new Map(
    [...(board.modelAssets ?? []), ...review.models].map((asset) => [
      asset.id,
      asset,
    ]),
  );
  const requiredFeatures = board.requiredFeatures.filter(
    (feature) =>
      feature !== 'embedded-devices' && feature !== 'physical-padstacks',
  );
  return validateBoard({
    ...board,
    revision: board.revision + 1,
    components,
    footprints,
    deviceDefinitions,
    footprintDefinitions,
    modelAssets: [...assets.values()].filter(
      ({ id }) => !previousAssets.has(id) || usedAssets.has(id),
    ),
    requiredFeatures: [
      ...requiredFeatures,
      'embedded-devices',
      ...(footprintDefinitions.some((item) =>
        item.pads.some((pad) => pad.stack),
      )
        ? ['physical-padstacks']
        : []),
    ],
  });
}
