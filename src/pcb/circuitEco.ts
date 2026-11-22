import { BoardRevisionConflict, validateBoard } from './board';
import type { BoardDocument } from './board';
import type { BoardComponent, BoardNet } from './boardAssets';
import {
  circuitConnectivityDigest,
  hasBoardConnectivity,
} from './circuitSnapshot';
import type { CircuitSnapshot } from './circuitSnapshot';
import { reviewCircuitCopper } from './circuitEcoCopper';
import { reviewCircuitNets } from './circuitNets';
import { canonicalDeviceJson } from './deviceLibrary';
import type { DeviceRevision } from './deviceLibrary';
import {
  boardComponentDevice,
  previewDeviceReview,
  withReviewedDevice,
} from './deviceReview';
import type { DeviceBindings, DeviceReview } from './deviceReview';
import type { PolygonKernel } from './polygonKernel';
import { stableHierarchyId } from './hierarchicalNetlist';
import { terminalKey } from './schematicComponents';

type ComponentChange = {
  readonly id: string;
  readonly reference: string;
  readonly kind: 'add' | 'remove' | 'update' | 'retain-mechanical';
  readonly canRetainMechanical?: boolean;
  readonly fields: readonly string[];
  readonly lostPads: readonly string[];
  readonly lostDrills?: readonly {
    readonly pad: string;
    readonly widthNm: number;
    readonly lengthNm: number;
    readonly plated: boolean;
  }[];
};

export interface CircuitDeviceSelection {
  readonly revision: DeviceRevision;
  readonly bindings: DeviceBindings;
}

export async function previewCircuitEco(
  board: BoardDocument,
  previous: CircuitSnapshot | undefined,
  proposed: CircuitSnapshot,
  {
    selectedDevices = new Map(),
    retainedMechanical = new Set(),
    loadKernel,
  }: {
    selectedDevices?: ReadonlyMap<string, CircuitDeviceSelection>;
    retainedMechanical?: ReadonlySet<string>;
    loadKernel?: () => Promise<PolygonKernel>;
  } = {},
) {
  const source = board.sourceCircuit;
  if (
    (source === undefined) !== (previous === undefined) ||
    (previous &&
      (previous.documentId !== proposed.documentId ||
        previous.documentId !== source.documentId ||
        previous.revision !== source.revision ||
        (await circuitConnectivityDigest(previous)) !==
          source.connectivityDigest ||
        (board.appliedCircuit &&
          canonicalDeviceJson(board.appliedCircuit) !==
            canonicalDeviceJson(previous)))) ||
    proposed.revision !== (previous ? previous.revision + 1 : 1)
  )
    throw new Error(
      'The circuit preview does not start from the applied board revision.',
    );
  const digest = await circuitConnectivityDigest(proposed);
  const netReview = reviewCircuitNets(previous?.nets ?? [], proposed.nets);
  proposed.nets.forEach(({ id }, index) => {
    const { retainedId } = netReview.nets[index];
    if (
      (retainedId && id !== retainedId) ||
      (!retainedId && previous?.nets.some((net) => net.id === id))
    )
      throw new Error(
        'The proposal changes the identity of an existing net membership.',
      );
  });

  const oldComponents = new Map(
    previous?.components.map((part) => [part.id, part]),
  );
  const previousNetIds = new Set(previous?.nets.map(({ id }) => id));
  const newNetIds = new Set(proposed.nets.map(({ id }) => id));
  const terminalOwners = new Map(
    proposed.nets.flatMap(({ id, terminals }) =>
      terminals.map((terminal) => [terminalKey(terminal), id] as const),
    ),
  );
  const existing = new Map<string, BoardComponent>();
  for (const part of board.components ?? []) {
    if (part.role === 'pcb-only') continue;
    const logical = part.logicalId ?? part.id;
    if (existing.has(logical))
      throw new Error(
        'More than one board component is linked to the same schematic component.',
      );
    existing.set(logical, part);
  }

  const changes: ComponentChange[] = [];
  const unresolved: { id: string; reference: string; reason: string }[] = [];
  const pendingBackAnnotations: {
    id: string;
    schematic: string;
    board: string;
  }[] = [];
  const conflicts: { id: string; schematic: string; board: string }[] = [];
  const physical = new Map(
    proposed.components
      .filter(({ role }) => hasBoardConnectivity(role) && role !== 'pcb-only')
      .map((part) => [part.id, part]),
  );
  const removedBoardIds = new Set<string>();
  const mechanical: BoardComponent[] = [];
  for (const [id, part] of existing) {
    if (physical.has(id)) continue;
    const { footprint, placement } = boardComponentDevice(board, id);
    const canRetainMechanical = !!(footprint && placement);
    if (canRetainMechanical && retainedMechanical.has(id)) {
      const { logicalId, units, ...object } = part;
      mechanical.push({ ...object, role: 'pcb-only', signals: [] });
      changes.push({
        id,
        reference: part.reference ?? oldComponents.get(id)?.reference ?? id,
        kind: 'retain-mechanical',
        fields: [],
        lostPads: [],
        canRetainMechanical,
      });
      continue;
    }
    removedBoardIds.add(part.id);
    const lostDrills = (footprint?.pads ?? []).flatMap(({ label, stack }) => {
      const drill = stack?.drill;
      return drill
        ? [
            {
              pad: label,
              widthNm: drill.widthNm,
              lengthNm:
                Math.round(
                  Math.hypot(
                    drill.end.x - drill.start.x,
                    drill.end.y - drill.start.y,
                  ),
                ) + drill.widthNm,
              plated: drill.plated,
            },
          ]
        : [];
    });
    changes.push({
      id,
      reference: part.reference ?? oldComponents.get(id)?.reference ?? id,
      kind: 'remove',
      fields: [],
      lostPads: footprint?.pads.map(({ label }) => label) ?? [],
      ...(lostDrills.length ? { lostDrills } : {}),
      ...(canRetainMechanical ? { canRetainMechanical } : {}),
    });
  }

  const components: BoardComponent[] = (board.components ?? [])
    .filter(({ role }) => role === 'pcb-only')
    .map((part) =>
      part.signals?.some(
        ({ netId }) => previousNetIds.has(netId) && !newNetIds.has(netId),
      )
        ? {
            ...part,
            signals: part.signals.filter(
              ({ netId }) => !previousNetIds.has(netId) || newNetIds.has(netId),
            ),
          }
        : part,
    );
  components.push(...mechanical);
  const boardOnlyIds = new Set(components.map(({ id }) => id));
  for (const [id, part] of physical) {
    const prior = oldComponents.get(id);
    const pcb = existing.get(id);
    const { procurement: oldProcurement, ...previousBoardPart } = pcb ?? {};
    const { device } = boardComponentDevice(board, id);
    const version = [part.signals.map(({ id }) => id), device?.signalIds ?? []];
    if (
      (prior?.packageHint !== part.packageHint && !!prior) ||
      !device ||
      canonicalDeviceJson([...version[0]].sort()) !==
        canonicalDeviceJson([...version[1]].sort())
    )
      unresolved.push({
        id,
        reference: part.reference,
        reason: !device
          ? 'Choose a reviewed device.'
          : 'Review the changed package or signal mapping.',
      });

    let reference = part.reference;
    if (prior && pcb?.reference && pcb.reference !== prior.reference) {
      reference = pcb.reference;
      if (
        part.reference !== prior.reference &&
        part.reference !== pcb.reference
      )
        conflicts.push({ id, schematic: part.reference, board: pcb.reference });
      else if (part.reference === prior.reference)
        pendingBackAnnotations.push({
          id,
          schematic: part.reference,
          board: pcb.reference,
        });
    }
    const signals = part.signals.flatMap(({ id: signalId, terminals }) => {
      const nets = new Set(
        terminals
          .map((terminal) => terminalOwners.get(terminalKey(terminal)))
          .filter(Boolean),
      );
      if (nets.size > 1)
        throw new Error(
          `Signal ${signalId} belongs to more than one intended net.`,
        );
      const [netId] = nets;
      return netId ? [{ signalId, netId }] : [];
    });
    const fields = pcb
      ? [
          ...(reference !== (pcb.reference ?? prior?.reference)
            ? ['Reference designator']
            : []),
          ...(part.value !== (pcb.value ?? prior?.value) ? ['Value'] : []),
          ...(canonicalDeviceJson(part.procurement) !== canonicalDeviceJson(oldProcurement)
            ? ['Purchasing details'] : []),
          ...(part.role !== (pcb.role ?? prior?.role) ? ['Physical role'] : []),
          ...(part.packageHint !== prior?.packageHint ? ['Package hint'] : []),
          ...(canonicalDeviceJson(signals) !==
          canonicalDeviceJson(pcb.signals ?? [])
            ? ['Signal-to-net bindings']
            : []),
        ]
      : [];
    if (!pcb || fields.length)
      changes.push({
        id,
        reference,
        kind: pcb ? 'update' : 'add',
        fields,
        lostPads: [],
      });
    components.push({
      ...previousBoardPart,
      id:
        pcb?.id ??
        (boardOnlyIds.has(id)
          ? await stableHierarchyId('board-component', board.boardId, id)
          : id),
      logicalId: id,
      reference,
      value: part.value,
      ...(part.procurement ? { procurement: part.procurement } : {}),
      role: part.role as BoardComponent['role'],
      units: part.units,
      signals,
    });
  }
  const refs = new Set<string>();
  const duplicateReferences: string[] = [];
  for (const { reference } of components) {
    if (!reference) continue;
    const key = reference.trim().toLowerCase();
    if (refs.has(key)) duplicateReferences.push(reference);
    refs.add(key);
  }

  const nets: BoardNet[] = (board.nets ?? []).filter(
    ({ id }) => !previousNetIds.has(id) && !newNetIds.has(id),
  );
  const oldNets = new Map(board.nets?.map((net) => [net.id, net]));
  const renamedNets: { id: string; before: string; after: string }[] = [];
  for (const { id, names } of proposed.nets) {
    const prior = oldNets.get(id);
    const name =
      names.find((name) => name.trim()) ?? prior?.name ?? `Net ${id}`;
    const aliases = names.filter((alias) => alias !== name && alias.trim());
    if (prior && prior.name !== name)
      renamedNets.push({ id, before: prior.name, after: name });
    nets.push({ ...prior, id, name, aliases });
  }
  const {
    snapshotId: ignoredId,
    revision: ignoredRevision,
    ...comparison
  } = proposed;
  const priorComparison =
    previous &&
    Object.fromEntries(
      Object.entries(previous).filter(
        ([key]) => key !== 'snapshotId' && key !== 'revision',
      ),
    );
  const unchanged =
    !!previous &&
    changes.length === 0 &&
    !renamedNets.length &&
    canonicalDeviceJson(priorComparison) === canonicalDeviceJson(comparison);

  let candidate: BoardDocument = {
    ...board,
    requiredFeatures: [
      ...new Set([...board.requiredFeatures, 'applied-circuit' as const]),
    ],
    sourceCircuit: {
      documentId: proposed.documentId,
      revision: proposed.revision,
      connectivityDigest: digest,
    },
    appliedCircuit: proposed,
    components,
    nets,
    ...(board.footprints
      ? {
          footprints: board.footprints.filter(
            ({ componentId }) => !removedBoardIds.has(componentId),
          ),
        }
      : {}),
  };
  const deviceChanges: DeviceReview[] = [];
  for (const [componentId, { revision, bindings }] of selectedDevices) {
    const device = await previewDeviceReview(
      candidate,
      proposed,
      componentId,
      revision,
      bindings,
    );
    candidate = withReviewedDevice(candidate, device);
    deviceChanges.push(device);
  }
  const copper = await reviewCircuitCopper(board, candidate, loadKernel);
  return {
    expected: board,
    candidate: copper.candidate,
    affectedCopper: copper.affected,
    shorts: copper.shorts,
    opens: copper.opens,
    changes,
    netReview,
    renamedNets,
    unresolved: unresolved.filter(({ id }) => !selectedDevices.has(id)),
    deviceChanges,
    conflicts,
    pendingBackAnnotations,
    duplicateReferences,
    unchanged: unchanged && !deviceChanges.length,
  };
}

export type CircuitEco = Awaited<ReturnType<typeof previewCircuitEco>>;

export function applyCircuitEco(
  board: BoardDocument,
  review: CircuitEco,
  { allowUnassigned = false } = {},
): BoardDocument {
  if (
    board.boardId !== review.expected.boardId ||
    board.revision !== review.expected.revision ||
    canonicalDeviceJson(board) !== canonicalDeviceJson(review.expected)
  )
    throw new BoardRevisionConflict(review.expected.revision, board.revision);
  if (review.conflicts.length || review.duplicateReferences.length)
    throw new Error(
      'Resolve reference designator conflicts before applying the circuit update.',
    );
  if (review.unchanged) return board;
  if (review.unresolved.some(({ id }) => !allowUnassigned ||
    review.candidate.components?.some((part) => part.logicalId === id && part.deviceId)))
    throw new Error(
      'Resolve device mappings before applying the circuit update.',
    );
  return validateBoard({ ...review.candidate, revision: board.revision + 1 });
}
