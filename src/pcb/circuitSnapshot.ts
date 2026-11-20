import { digest } from '../util/sha256';
import { isEntityId } from '../model/schematicIdentity';
import { reviewCircuitNets } from './circuitNets';
import type { CircuitNet, SchematicTerminal } from './circuitNets';
import { validProjectName } from '../../shared/projectFiles';
import type { SchematicSource } from '../io/netlists/netlistGenerator';

const componentRoles = [
  'electrical',
  'dnp',
  'virtual',
  'off-board',
  'pcb-only',
  'net-tie',
] as const;

export interface CircuitComponent {
  readonly id: string;
  readonly reference: string;
  readonly value: string;
  readonly role: (typeof componentRoles)[number];
  readonly packageHint?: string;
  readonly units: readonly { id: string; sheetId: string }[];
  readonly signals: readonly {
    id: string;
    name: string;
    terminals: readonly SchematicTerminal[];
  }[];
}

export interface CircuitSnapshot {
  readonly schemaVersion: 1;
  readonly snapshotId: string;
  readonly documentId: string;
  readonly revision: number;
  readonly components: readonly CircuitComponent[];
  readonly nets: readonly CircuitNet[];
  readonly noConnects: readonly SchematicTerminal[];
  readonly sources?: Readonly<Record<string, CircuitSchematicSource>>;
}

export type CircuitSchematicSource = Omit<
  SchematicSource,
  'itemId' | 'unitId' | 'pinId'
> & {
  unitId: string;
};

function terminalKey(terminal: SchematicTerminal): string {
  if (!isEntityId(terminal?.unitId) || !isEntityId(terminal?.pinId))
    throw new Error('Invalid circuit terminal identity.');
  return `${terminal.unitId.toLowerCase()}:${terminal.pinId.toLowerCase()}`;
}

function addId(ids: Set<string>, id: string): void {
  if (!isEntityId(id) || ids.has(id.toLowerCase()))
    throw new Error('Invalid or duplicate circuit entity identity.');
  ids.add(id.toLowerCase());
}

export function validateCircuitSnapshot(
  value: unknown,
): asserts value is CircuitSnapshot {
  const snapshot = value as CircuitSnapshot;
  if (
    snapshot?.schemaVersion !== 1 ||
    !isEntityId(snapshot.snapshotId) ||
    !isEntityId(snapshot.documentId) ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 0 ||
    !Array.isArray(snapshot.components) ||
    !Array.isArray(snapshot.nets) ||
    !Array.isArray(snapshot.noConnects)
  )
    throw new Error('Invalid or unsupported circuit snapshot.');

  const componentIds = new Set<string>();
  const unitIds = new Set<string>();
  const sheetsByUnit = new Map<string, string>();
  const signalIds = new Set<string>();
  const terminals = new Set<string>();
  for (const component of snapshot.components) {
    addId(componentIds, component?.id);
    if (
      typeof component.reference !== 'string' ||
      typeof component.value !== 'string' ||
      (component.packageHint !== undefined &&
        typeof component.packageHint !== 'string') ||
      !componentRoles.includes(component.role) ||
      !Array.isArray(component.units) ||
      !Array.isArray(component.signals) ||
      (component.role === 'pcb-only'
        ? component.units.length !== 0
        : component.units.length === 0)
    ) {
      throw new Error('Invalid circuit component, units, or physical role.');
    }
    const componentUnits = new Set<string>();
    for (const unit of component.units) {
      addId(unitIds, unit?.id);
      if (!isEntityId(unit.sheetId))
        throw new Error('Invalid schematic sheet identity.');
      componentUnits.add(unit.id.toLowerCase());
      sheetsByUnit.set(unit.id.toLowerCase(), unit.sheetId);
    }
    for (const signal of component.signals) {
      addId(signalIds, signal?.id);
      if (typeof signal.name !== 'string' || !Array.isArray(signal.terminals))
        throw new Error('Invalid circuit signal.');
      for (const terminal of signal.terminals) {
        const key = terminalKey(terminal);
        if (
          !componentUnits.has(terminal.unitId.toLowerCase()) ||
          terminals.has(key)
        )
          throw new Error('Invalid or duplicate signal terminal.');
        terminals.add(key);
      }
    }
  }

  if (snapshot.sources !== undefined) {
    if (
      !snapshot.sources ||
      typeof snapshot.sources !== 'object' ||
      Array.isArray(snapshot.sources) ||
      Object.keys(snapshot.sources).length !== sheetsByUnit.size
    )
      throw new Error('Invalid circuit source provenance.');
    for (const [id, source] of Object.entries(snapshot.sources)) {
      if (
        !isEntityId(id) ||
        id !== id.toLowerCase() ||
        !isEntityId(source?.documentId) ||
        !isEntityId(source?.unitId) ||
        !isEntityId(source?.sheetId) ||
        source.sheetId !== sheetsByUnit.get(id) ||
        typeof source.documentPath !== 'string' ||
        !/\.d[sz]n$/i.test(source.documentPath) ||
        !source.documentPath.split('/').every(validProjectName) ||
        !Array.isArray(source.instancePath) ||
        source.instancePath.length > 64 ||
        !source.instancePath.every(isEntityId) ||
        (!source.instancePath.length &&
          (source.documentId !== snapshot.documentId || source.unitId !== id))
      )
        throw new Error('Invalid circuit source provenance.');
    }
  }

  for (const net of snapshot.nets) {
    if (
      !Array.isArray(net?.names) ||
      !net.names.every((name: unknown) => typeof name === 'string') ||
      !Array.isArray(net.terminals)
    ) {
      throw new Error('Invalid circuit net.');
    }
  }
  reviewCircuitNets(snapshot.nets, []);
  const connected = new Set<string>();
  for (const terminal of snapshot.nets.flatMap((net) => net.terminals)) {
    const key = terminalKey(terminal);
    if (!terminals.has(key))
      throw new Error('Circuit net refers to an unknown terminal.');
    connected.add(key);
  }
  const noConnects = new Set<string>();
  for (const terminal of snapshot.noConnects) {
    const key = terminalKey(terminal);
    if (!terminals.has(key) || connected.has(key) || noConnects.has(key))
      throw new Error('Invalid explicit no-connect terminal.');
    noConnects.add(key);
  }
}

/** Aliases, component labels, and input order are outside the connectivity identity. */
export async function circuitConnectivityDigest(
  snapshot: CircuitSnapshot,
): Promise<string> {
  validateCircuitSnapshot(snapshot);
  const content = {
    components: snapshot.components
      .map((component) => [
        component.id.toLowerCase(),
        component.role,
        component.signals
          .map((signal) => [
            signal.id.toLowerCase(),
            signal.terminals.map(terminalKey).sort(),
          ])
          .sort(([a], [b]) => String(a).localeCompare(String(b), 'en')),
      ])
      .sort(([a], [b]) => String(a).localeCompare(String(b), 'en')),
    nets: snapshot.nets
      .map((net) => [
        net.id.toLowerCase(),
        net.terminals.map(terminalKey).sort(),
      ])
      .sort(([a], [b]) => String(a).localeCompare(String(b), 'en')),
    noConnects: snapshot.noConnects.map(terminalKey).sort(),
  };
  return `sha256:${await digest(
    new TextEncoder().encode(JSON.stringify(content)),
  )}`;
}
