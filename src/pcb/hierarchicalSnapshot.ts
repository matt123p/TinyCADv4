import { DocItemTypes } from '../model/dsnItem';
import { reviewCircuitNets } from './circuitNets';
import type {
  CircuitNet,
  CircuitNetDraft,
  SchematicTerminal,
} from './circuitNets';
import { validateCircuitSnapshot } from './circuitSnapshot';
import type {
  CircuitSchematicSource,
  CircuitSnapshot,
} from './circuitSnapshot';
import {
  HierarchyConnectivityError,
  stableHierarchyId,
} from './hierarchicalNetlist';
import type { HierarchicalNetlist } from './hierarchicalNetlist';
import { compileSchematicComponents, terminalKey } from './schematicComponents';

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
  const { components, sources, terminals, sharedSignals } =
    await compileSchematicComponents(graph);
  const aliases = new Map<string, string[]>();
  for (const [label, net] of Object.entries(graph.labels))
    aliases.set(net, [...(aliases.get(net) ?? []), label]);
  const drafts: CircuitNetDraft[] = [];
  const noConnects: SchematicTerminal[] = [];
  const noConnect = Symbol('no-connect');
  const connections = new Map<string, string | typeof noConnect>();
  for (const [net, nodes] of Object.entries(graph.nets)) {
    const pinNodes = nodes.filter(
      ({ instanceUnitId, parent }) =>
        instanceUnitId && parent?.NodeName === DocItemTypes.Pin,
    );
    const markers = nodes.filter(
      ({ parent }) => parent?.NodeName === DocItemTypes.NoConnect,
    );
    const range = nodes.find(
      ({ label, parent }) =>
        parent?.NodeName === DocItemTypes.Label &&
        /\(\d+\s*:\s*\d+\)$/.test(label?.trim()),
    );
    if (range?.source)
      throw new HierarchyConnectivityError(
        'Use a scalar wire label for each PCB bus member.',
        range.source,
      );

    if (markers.length) {
      const marker = markers[0];
      const pin = pinNodes[0];
      if (
        markers.length !== 1 ||
        pinNodes.length !== 1 ||
        nodes.some(({ label, port }) => label || port) ||
        marker.source?.sheetId !== pin?.source?.sheetId ||
        marker.a?.[0] !== pin?.a?.[0] ||
        marker.a?.[1] !== pin?.a?.[1]
      )
        throw new HierarchyConnectivityError(
          'An explicit no-connect must be attached to exactly one otherwise unconnected pin.',
          marker.source,
        );
    }

    const members = new Map<string, SchematicTerminal>();
    const identity = markers.length ? noConnect : net;
    for (const node of pinNodes) {
      if (node.parent.NodeName !== DocItemTypes.Pin) continue;
      const terminal = {
        unitId: node.instanceUnitId,
        pinId: node.parent.pinId,
      };
      const key = terminalKey(terminal);
      const source = terminals.get(key);
      if (!source)
        throw new HierarchyConnectivityError(
          'A net references an unknown schematic terminal.',
          node.source,
        );
      if (connections.has(key) && connections.get(key) !== identity)
        throw new HierarchyConnectivityError(
          'A terminal belongs to more than one schematic net.',
          source.source,
        );
      if (source.physical) members.set(key, terminal);
      connections.set(key, identity);
    }
    if (!members.size) continue;
    if (markers.length) noConnects.push(...members.values());
    else
      drafts.push({
        names: aliases.get(net) ?? [],
        terminals: [...members.values()],
      });
  }
  for (const signal of sharedSignals) {
    const [first, ...rest] = signal.terminals.map(terminalKey);
    const connection = connections.get(first);
    if (
      connection === undefined ||
      rest.some((key) => connections.get(key) !== connection)
    )
      throw new HierarchyConnectivityError(
        `Shared pin ${signal.number} has inconsistent net or no-connect assignments.`,
        terminals.get(first).source,
      );
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

export { boardPadSources } from './boardPadSources';

export function boardNetSources(snapshot: CircuitSnapshot, netId: string) {
  const net = snapshot.nets.find(
    ({ id }) => id.toLowerCase() === netId.toLowerCase(),
  );
  if (!net) return [];
  const members = new Set(
    net.terminals.map((terminal) => terminalKey(terminal).toLowerCase()),
  );
  return snapshot.components.flatMap(({ reference, signals }) =>
    signals.flatMap(({ name, number, terminals }) =>
      terminals.flatMap((terminal) => {
        const { unitId, pinId } = terminal;
        const source = snapshot.sources?.[unitId.toLowerCase()];
        const id = terminalKey(terminal).toLowerCase();
        return source && members.has(id)
          ? [
              {
                id,
                reference,
                signal: name,
                number,
                source: { ...source, pinId },
              },
            ]
          : [];
      }),
    ),
  );
}
