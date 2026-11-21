import type { BoardDocument } from './board';
import type { DeviceRevision } from './deviceLibrary';
import { embedLibraryDevice, withReviewedDevice } from './deviceReview';

function assertStandalone(board: BoardDocument) {
  if (board.sourceCircuit)
    throw new Error('Update connectivity from the linked schematic.');
}

export function addStandaloneNet(board: BoardDocument, name: string): BoardDocument {
  assertStandalone(board);
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a net name.');
  if (board.nets?.some((net) =>
    [net.name, ...(net.aliases ?? [])].some((label) => label.toLowerCase() === trimmed.toLowerCase()),
  )) throw new Error('That name already belongs to a board net.');
  return { ...board, nets: [...(board.nets ?? []), { id: crypto.randomUUID(), name: trimmed }] };
}

export function standalonePadSignals(board: BoardDocument, componentId: string) {
  const component = board.components?.find(({ id }) => id === componentId);
  const placement = board.footprints?.find((item) => item.componentId === componentId);
  const device = board.deviceDefinitions?.find(({ id }) => id === (component?.deviceId ?? placement?.deviceId));
  const footprint = board.footprintDefinitions?.find(({ id }) => id === device?.footprintId);
  const labels = new Map(footprint?.pads.map(({ id, label }) => [id, label || id]));
  const groups = new Map<string, string[]>();
  for (const assignment of device?.assignments ?? []) {
    if (assignment.kind !== 'signal') continue;
    const label = labels.get(assignment.padId);
    if (!label) continue;
    const group = groups.get(assignment.signalId) ?? [];
    group.push(label);
    groups.set(assignment.signalId, group);
  }
  const nets = new Map(component?.signals?.map(({ signalId, netId }) => [signalId, netId]));
  return [...groups].map(([id, pads]) => ({ id, pads, netId: nets.get(id) ?? '' }));
}

export function assignStandaloneSignal(
  board: BoardDocument,
  componentId: string,
  signalId: string,
  netId: string,
): BoardDocument {
  assertStandalone(board);
  const signal = standalonePadSignals(board, componentId).find(({ id }) => id === signalId);
  if (!signal) throw new Error('Choose an electrical pad.');
  if (netId && !board.nets?.some(({ id }) => id === netId))
    throw new Error('Choose a board net.');
  if (signal.netId === netId) return board;
  return {
    ...board,
    components: (board.components ?? []).map((component) => {
      if (component.id !== componentId) return component;
      const signals = (component.signals ?? []).filter((item) => item.signalId !== signalId);
      if (netId) signals.push({ signalId, netId });
      return { ...component, signals };
    }),
  };
}

export async function addStandaloneDevice(
  board: BoardDocument,
  revision: DeviceRevision,
  reference: string,
): Promise<BoardDocument> {
  assertStandalone(board);
  const trimmed = reference.trim();
  if (!trimmed) throw new Error('Enter a component reference.');
  if (board.components?.some((item) => item.reference?.trim().toLowerCase() === trimmed.toLowerCase()))
    throw new Error('That component reference is already in use.');
  const id = crypto.randomUUID();
  const { definition } = revision;
  const signalIds = definition.terminals.map((terminal) => terminal.id);
  const bindings = signalIds.map((signalId) => ({ terminalId: signalId, signalId }));
  const { device, footprint } = await embedLibraryDevice(board.boardId, revision.digest, revision, signalIds, bindings);
  return withReviewedDevice(board, {
    component: { id, reference: trimmed, role: 'pcb-only', deviceId: device.id, value: definition.name },
    device,
    footprint,
    models: definition.models ?? [],
    previous: {},
  });
}
