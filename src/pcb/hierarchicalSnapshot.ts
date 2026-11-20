import { DocItemTypes } from '../model/dsnItem';
import { isEntityId } from '../model/schematicIdentity';
import { readControl } from '../simulation/controls';
import { reviewCircuitNets } from './circuitNets';
import type {
  CircuitNet,
  CircuitNetDraft,
  SchematicTerminal,
} from './circuitNets';
import { validateCircuitSnapshot } from './circuitSnapshot';
import type {
  CircuitComponent,
  CircuitSchematicSource,
  CircuitSnapshot,
} from './circuitSnapshot';
import type { BoardAssets } from './boardAssets';
import {
  HierarchyConnectivityError,
  stableHierarchyId,
} from './hierarchicalNetlist';
import type { HierarchicalNetlist } from './hierarchicalNetlist';

interface SnapshotOptions {
  documentId: string;
  revision: number;
  previous?: readonly CircuitNet[];
}

export type HierarchicalCircuitSnapshot = CircuitSnapshot & {
  sources: Record<string, CircuitSchematicSource>;
};

/** Project the supported physical subset from the same graph consumed by ERC and netlist export. */
export async function buildHierarchicalCircuitSnapshot(
  graph: HierarchicalNetlist,
  { documentId, revision, previous = [] }: SnapshotOptions,
): Promise<{
  snapshot: HierarchicalCircuitSnapshot;
  review: ReturnType<typeof reviewCircuitNets>;
}> {
  if (graph.unsupportedPcbSource)
    throw new HierarchyConnectivityError(
      'Review bus connectivity before building a PCB circuit snapshot.',
      graph.unsupportedPcbSource,
    );
  const components: CircuitComponent[] = [];
  const sources: HierarchicalCircuitSnapshot['sources'] = Object.create(null);
  const signalKeys = new Set<string>();
  const references = new Set<string>();
  for (const [, symbol] of graph.symbols) {
    const id = symbol.unitId;
    const reference = symbol.text.find(
      ({ description }) => description === 'Ref',
    )?.value;
    const source = graph.sources[id];
    if (
      !source ||
      !source.unitId ||
      !reference ||
      references.has(reference.toLowerCase()) ||
      symbol._symbol.parts !== 1 ||
      readControl(symbol)
    )
      throw new Error(
        `Review physical component binding for ${
          reference || '(unnamed)'
        } before building its snapshot.`,
      );
    references.add(reference.toLowerCase());
    const packageHint = symbol.text.find(
      ({ description }) => description.toLowerCase() === 'package',
    )?.value;
    const value =
      symbol.text.find(({ description }) => description === 'Value')?.value ??
      symbol.text.find(({ description }) => description === 'Name')?.value ??
      '';
    const signals = [];
    for (const { pin, part } of symbol._symbol.outlines[0].active_points) {
      if (!symbol._symbol.heterogeneous && part !== symbol.part) continue;
      if (!isEntityId(pin.pinId) || signalKeys.has(id + ':' + pin.pinId))
        throw new Error(`Review pin identity for ${reference}.`);
      signalKeys.add(id + ':' + pin.pinId);
      signals.push({
        id: await stableHierarchyId('schematic-signal', id, pin.pinId),
        name: pin.name || pin.number,
        terminals: [{ unitId: id, pinId: pin.pinId }],
      });
    }
    components.push({
      id,
      reference,
      value,
      role: 'electrical',
      units: [{ id, sheetId: source.sheetId }],
      signals,
      ...(packageHint === undefined ? {} : { packageHint }),
    });
    const { itemId, ...persistedSource } = source;
    sources[id] = { ...persistedSource, unitId: source.unitId };
  }
  const aliases = new Map<string, string[]>();
  for (const [label, net] of Object.entries(graph.labels))
    aliases.set(net, [...(aliases.get(net) ?? []), label]);
  const drafts: CircuitNetDraft[] = [];
  const noConnects: SchematicTerminal[] = [];
  for (const [net, nodes] of Object.entries(graph.nets)) {
    const terminals = new Map<string, SchematicTerminal>();
    for (const node of nodes) {
      const unitId = node.instanceUnitId;
      if (!unitId || node.parent?.NodeName !== DocItemTypes.Pin) continue;
      const pinId = node.parent.pinId;
      const key = unitId + ':' + pinId;
      if (!signalKeys.has(key))
        throw new Error('A net references an unknown physical terminal.');
      terminals.set(key, { unitId, pinId });
    }
    if (!terminals.size) continue;
    if (
      nodes.some(({ parent }) => parent?.NodeName === DocItemTypes.NoConnect)
    ) {
      if (terminals.size !== 1 || nodes.some(({ label }) => label))
        throw new Error(
          'An explicit no-connect marker shares a connected net.',
        );
      noConnects.push(...terminals.values());
    } else
      drafts.push({
        names: aliases.get(net) ?? [],
        terminals: [...terminals.values()],
      });
  }
  const review = reviewCircuitNets(previous, drafts);
  const nets = await Promise.all(
    review.nets.map(async ({ retainedId, draft }) => ({
      ...draft,
      id:
        retainedId ??
        (await stableHierarchyId(
          'schematic-net',
          documentId,
          ...draft.terminals
            .map(({ unitId, pinId }) => unitId + ':' + pinId)
            .sort(),
        )),
    })),
  );
  const snapshot: HierarchicalCircuitSnapshot = {
    documentId,
    revision,
    schemaVersion: 1,
    snapshotId: await stableHierarchyId(
      'circuit-snapshot',
      documentId,
      String(revision),
    ),
    components,
    sources,
    nets,
    noConnects,
  };
  validateCircuitSnapshot(snapshot);
  return { snapshot, review };
}

/** Match physical pads through the embedded device map and the circuit's stable IDs. */
export function boardPadSources(board: BoardAssets, snapshot: CircuitSnapshot) {
  const byId = <T extends { readonly id: string }>(items: readonly T[]) =>
    new Map(items.map((item) => [item.id.toLowerCase(), item]));
  const devices = byId(board.deviceDefinitions ?? []);
  const definitions = byId(board.footprintDefinitions ?? []);
  const components = byId(board.components ?? []);
  const circuit = byId(snapshot.components);
  const targets: {
    footprintId: string;
    padId: string;
    padLabel: string;
    reference: string;
    signal: string;
    source: CircuitSchematicSource & { pinId: string };
  }[] = [];
  for (const footprint of board.footprints ?? []) {
    const component = components.get(footprint.componentId.toLowerCase());
    const logical = circuit.get(
      (component?.logicalId ?? footprint.componentId).toLowerCase(),
    );
    const device = devices.get(footprint.deviceId.toLowerCase());
    if (!logical || !device) continue;
    const pads = byId(
      definitions.get(device.footprintId.toLowerCase())?.pads ?? [],
    );
    const signals = byId(logical.signals);
    for (const assignment of device.assignments) {
      if (assignment.kind !== 'signal') continue;
      const signal = signals.get(assignment.signalId.toLowerCase());
      const pad = pads.get(assignment.padId.toLowerCase());
      if (!pad || !signal) continue;
      for (const { unitId, pinId } of signal.terminals) {
        const source = snapshot.sources?.[unitId.toLowerCase()];
        if (source)
          targets.push({
            footprintId: footprint.id,
            padId: pad.id,
            padLabel: pad.label,
            reference: logical.reference,
            signal: signal.name,
            source: { ...source, pinId },
          });
      }
    }
  }
  return targets;
}
