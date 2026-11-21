import type { SchematicSource } from '../io/netlists/netlistGenerator';
import type { dsnPin, dsnSymbol } from '../model/dsnItem';
import { isEntityId } from '../model/schematicIdentity';
import { readControl } from '../simulation/controls';
import type { SchematicTerminal } from './circuitNets';
import { componentRoles, hasBoardConnectivity } from './circuitSnapshot';
import type {
  CircuitComponent,
  CircuitSchematicSource,
} from './circuitSnapshot';
import {
  HierarchyConnectivityError,
  stableHierarchyId,
} from './hierarchicalNetlist';
import type { HierarchicalNetlist } from './hierarchicalNetlist';
import { procurementFields, validProcurement } from './procurement';

type PhysicalRole = Exclude<CircuitComponent['role'], 'pcb-only'>;
type Signal = CircuitComponent['signals'][number];

function attribute(symbol: dsnSymbol, name: string) {
  return symbol.text.find(
    ({ description }) => description.toLowerCase() === name,
  )?.value;
}

interface Unit {
  symbol: dsnSymbol;
  source: SchematicSource;
  reference: string;
  role: PhysicalRole;
  componentBinding?: string;
  sharedPins: readonly string[];
  packageHint?: string;
  value: string;
}

export function terminalKey({ unitId, pinId }: SchematicTerminal) {
  return unitId + ':' + pinId;
}

export async function compileSchematicComponents(graph: HierarchicalNetlist) {
  const groups = new Map<string, Unit[]>();
  const references = new Map<string, string>();
  const sources: Record<string, CircuitSchematicSource> = Object.create(null);
  for (const [, symbol] of graph.symbols) {
    const source = graph.sources[symbol.unitId];
    if (!source?.unitId)
      throw new Error('A compiled unit has no schematic provenance.');
    const reference = attribute(symbol, 'ref')?.trim();
    const fail = (message: string): never => {
      throw new HierarchyConnectivityError(`${reference}: ${message}`, source);
    };
    const role =
      attribute(symbol, 'pcb role')?.trim().toLowerCase() ||
      (readControl(symbol) ? 'virtual' : 'electrical');
    if (
      role === 'pcb-only' ||
      !componentRoles.includes(role as CircuitComponent['role'])
    )
      fail(
        'Choose a valid schematic PCB Role. PCB-only components are authored on the board.',
      );
    const componentBinding = attribute(symbol, 'pcb component')
      ?.trim()
      .toLowerCase();
    if (
      (componentBinding && !isEntityId(componentBinding)) ||
      (symbol._symbol.parts > 1 && !componentBinding)
    )
      fail('Set PCB Component to the reviewed package UUID for each unit.');

    const shared = attribute(symbol, 'pcb shared pins')?.trim();
    let sharedPins: string[] = [];
    if (shared) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(shared);
      } catch {
        fail('PCB Shared Pins must be a JSON list of pin numbers.');
      }
      if (
        !Array.isArray(parsed) ||
        parsed.some((pin) => typeof pin !== 'string' || !pin) ||
        new Set(parsed).size !== parsed.length ||
        !componentBinding
      )
        fail(
          'PCB Shared Pins needs distinct pin numbers and a reviewed component UUID.',
        );
      sharedPins = (parsed as string[]).sort();
    }
    const groupKey = componentBinding
      ? JSON.stringify([
          source.documentId,
          source.instancePath,
          componentBinding,
        ])
      : symbol.unitId;
    const foldedReference = reference.toLowerCase();
    const prior = references.get(foldedReference);
    if (prior && prior !== groupKey)
      fail('The reference is already assigned to a different component.');
    references.set(foldedReference, groupKey);

    const unit: Unit = {
      symbol,
      source,
      reference,
      role: role as PhysicalRole,
      componentBinding,
      sharedPins,
      packageHint: attribute(symbol, 'package'),
      value: attribute(symbol, 'value') ?? attribute(symbol, 'name') ?? '',
    };
    const group = groups.get(groupKey);
    if (group) group.push(unit);
    else groups.set(groupKey, [unit]);
    sources[symbol.unitId] = {
      documentId: source.documentId,
      documentPath: source.documentPath,
      sheetId: source.sheetId,
      instancePath: source.instancePath,
      unitId: source.unitId,
    };
  }

  const components: CircuitComponent[] = [];
  const terminals = new Map<
    string,
    { source: SchematicSource; physical: boolean }
  >();
  const sharedSignals: Signal[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.symbol.part - b.symbol.part);
    const first = group[0];
    const { reference, role, value, componentBinding } = first;
    const { parts, heterogeneous } = first.symbol._symbol;
    const id = componentBinding
      ? await stableHierarchyId(
          'schematic-component',
          first.source.documentId,
          ...first.source.instancePath,
          componentBinding,
        )
      : first.symbol.unitId;
    const packageHints = new Set(
      group
        .map(({ packageHint }) => packageHint)
        .filter((hint) => hint?.trim()),
    );
    if (packageHints.size > 1)
      throw new HierarchyConnectivityError(
        `${reference}: conflicting package hints.`,
        first.source,
      );
    const purchasing = procurementFields.flatMap(({ id, column, names }) => {
      const matches = new Set<string>(names);
      const values = new Set(group.flatMap(({ symbol }) => symbol.text
        .filter(({ description }) => matches.has(description.trim().toLowerCase()))
        .map(({ value }) => value.trim()).filter(Boolean)));
      if (values.size > 1)
        throw new HierarchyConnectivityError(`${reference}: conflicting ${column} attributes.`, first.source);
      return values.size ? [[id, values.values().next().value]] : [];
    });
    const procurement = Object.fromEntries(purchasing);
    if (purchasing.length && !validProcurement(procurement))
      throw new HierarchyConnectivityError(`${reference}: invalid purchasing attributes.`, first.source);

    const signals: Signal[] = [];
    const sharedMembers = new Map<
      string,
      { pin: dsnPin; terminals: SchematicTerminal[] }
    >();
    const occupiedParts = new Set<number>();
    for (const unit of group) {
      const { symbol, source } = unit;
      if (
        unit.reference.toLowerCase() !== reference.toLowerCase() ||
        unit.role !== role ||
        unit.value !== value ||
        symbol._symbol.parts !== parts ||
        symbol._symbol.heterogeneous !== heterogeneous ||
        symbol.part < 0 ||
        symbol.part >= parts ||
        !Number.isInteger(symbol.part) ||
        occupiedParts.has(symbol.part) ||
        JSON.stringify(unit.sharedPins) !== JSON.stringify(first.sharedPins)
      )
        throw new HierarchyConnectivityError(
          `${reference}: conflicting multipart unit or component fields.`,
          source,
        );
      occupiedParts.add(symbol.part);
      const outline = symbol._symbol.outlines[heterogeneous ? symbol.part : 0];
      if (!outline)
        throw new HierarchyConnectivityError(
          `${reference}: missing unit outline.`,
          source,
        );
      const pinIds = new Set<string>();
      for (const { pin, part } of outline.active_points) {
        if (!heterogeneous && part !== symbol.part) continue;
        if (!isEntityId(pin.pinId) || pinIds.has(pin.pinId))
          throw new HierarchyConnectivityError(
            `${reference}: invalid or duplicate pin identity.`,
            source,
          );
        pinIds.add(pin.pinId);
        const terminal = { unitId: symbol.unitId, pinId: pin.pinId };
        if (first.sharedPins.includes(pin.number)) {
          const shared = sharedMembers.get(pin.number);
          if (shared) {
            if (
              shared.pin.name !== pin.name ||
              shared.pin.elec !== pin.elec ||
              shared.terminals.some(({ unitId }) => unitId === terminal.unitId)
            )
              throw new HierarchyConnectivityError(
                `${reference}: conflicting shared pin ${pin.number}.`,
                source,
              );
            shared.terminals.push(terminal);
          } else {
            sharedMembers.set(pin.number, { pin, terminals: [terminal] });
          }
        } else {
          signals.push({
            id: await stableHierarchyId(
              'schematic-signal',
              symbol.unitId,
              pin.pinId,
            ),
            name: pin.name || pin.number,
            number: pin.number,
            terminals: [terminal],
          });
        }
      }
    }

    if (occupiedParts.size !== parts)
      throw new HierarchyConnectivityError(
        `${reference}: review and place the missing multipart units.`,
        first.source,
      );

    for (const number of first.sharedPins) {
      const member = sharedMembers.get(number);
      if (!member || member.terminals.length < 2)
        throw new HierarchyConnectivityError(
          `${reference}: shared pin ${number} needs terminals on at least two units.`,
          first.source,
        );
      const signal = {
        id: await stableHierarchyId('schematic-shared-signal', id, number),
        name: member.pin.name || number,
        number,
        terminals: member.terminals,
      };
      signals.push(signal);
      sharedSignals.push(signal);
    }

    for (const signal of signals) {
      for (const terminal of signal.terminals) {
        const source = graph.sources[terminal.unitId];
        terminals.set(terminalKey(terminal), {
          source: { ...source, pinId: terminal.pinId },
          physical: hasBoardConnectivity(role),
        });
      }
    }
    const packageHint = packageHints.values().next().value ?? first.packageHint;
    components.push({
      id,
      reference,
      role,
      value,
      ...(packageHint === undefined ? {} : { packageHint }),
      ...(purchasing.length ? { procurement } : {}),
      units: group.map(({ symbol, source }) => ({
        id: symbol.unitId,
        sheetId: source.sheetId,
      })),
      signals,
    });
  }
  return { components, sources, terminals, sharedSignals };
}
