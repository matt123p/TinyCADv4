import type { BoardDocument } from './board';
import type { BoardIssue } from './boardChecks';
import { hasBoardConnectivity } from './circuitSnapshot';
import type { CircuitSnapshot } from './circuitSnapshot';
import { canonicalJson } from '../util/canonicalJson';
import { digest } from '../util/sha256';

export type ProjectCircuitInput =
  | { state: 'resolved'; snapshot: CircuitSnapshot; applied?: CircuitSnapshot }
  | { state: 'unavailable'; detail: string }
  | { state: 'unlinked' };

export type SchematicCheckEvidence =
  | { state: 'current' | 'pending'; documentId: string; digest: string }
  | { state: 'unavailable'; detail: string }
  | { state: 'unlinked' };

export function comparableCircuit({
  snapshotId,
  revision,
  ...content
}: CircuitSnapshot) {
  return canonicalJson(content);
}

export async function checkProjectCircuit(
  board: BoardDocument,
  input: ProjectCircuitInput,
): Promise<{ evidence: SchematicCheckEvidence; issues: BoardIssue[] }> {
  if (input.state === 'unlinked') return { evidence: input, issues: [] };
  if (input.state === 'unavailable')
    return {
      evidence: input,
      issues: [
        { code: 'schematic-unavailable', objects: [], message: input.detail },
      ],
    };
  const content = comparableCircuit(input.snapshot);
  const applied = board.appliedCircuit ?? input.applied;
  const current = applied && comparableCircuit(applied) === content;
  const evidence: SchematicCheckEvidence = {
    state: current ? 'current' : 'pending',
    documentId: input.snapshot.documentId,
    digest: await digest(new TextEncoder().encode(content)),
  };
  const issues = checkAppliedCircuit(board, input.snapshot);
  if (!current)
    issues.unshift({
      code: 'schematic-update-pending',
      objects: [],
      message: applied
        ? 'The project schematic changed since the last PCB update. Review schematic changes.'
        : 'The associated schematic has not been applied to this board. Review schematic changes.',
    });
  return { evidence, issues };
}

export function checkAppliedCircuit(
  board: BoardDocument,
  snapshot = board.appliedCircuit,
): BoardIssue[] {
  if (!snapshot) return [];
  const issues: BoardIssue[] = [];
  const required = new Map(
    snapshot.components
      .filter(({ role }) => hasBoardConnectivity(role))
      .map((component) => [component.id, component]),
  );
  const placed = new Map<
    string,
    NonNullable<BoardDocument['components']>[number]
  >();
  for (const part of board.components ?? []) {
    const id = part.logicalId ?? part.id;
    if (part.role === 'pcb-only' && !required.has(id)) continue;
    const previous = placed.get(id);
    if (previous) {
      issues.push({
        code: 'duplicate-component',
        objects: [previous.id, part.id, id],
        message:
          'Multiple board components map to the same schematic component.',
      });
    } else placed.set(id, part);
  }
  const terminalOwners = new Map(
    snapshot.nets.flatMap(({ id, terminals }) =>
      terminals.map(({ unitId, pinId }) => [unitId + ':' + pinId, id] as const),
    ),
  );
  for (const [id, expected] of required) {
    const part = placed.get(id);
    if (!part) {
      issues.push({
        code: 'missing-component',
        objects: [id],
        message: expected.reference + ' is missing from the board circuit.',
      });
      continue;
    }
    if (part.reference !== expected.reference) {
      issues.push({
        code: 'reference-divergence',
        objects: [part.id, id],
        message:
          'Board and schematic references differ for ' +
          expected.reference +
          '.',
      });
    }
    if (part.role !== expected.role || part.value !== expected.value) {
      issues.push({
        code: 'component-divergence',
        objects: [part.id, id],
        message:
          'Board role or value differs from the schematic for ' +
          expected.reference +
          '.',
      });
    }
    if (canonicalJson(part.procurement) !== canonicalJson(expected.procurement)) {
      issues.push({
        code: 'procurement-divergence',
        objects: [part.id, id],
        message: 'Board purchasing details differ from the schematic for ' + expected.reference + '.',
      });
    }
    const bindings = new Map(
      part.signals?.map(({ signalId, netId }) => [signalId, netId]),
    );
    for (const { id: signalId, name, terminals } of expected.signals) {
      const nets = new Set(
        terminals
          .map(({ unitId, pinId }) => terminalOwners.get(unitId + ':' + pinId))
          .filter(Boolean),
      );
      if (nets.size > 1 || [...nets][0] !== bindings.get(signalId)) {
        issues.push({
          code: 'net-divergence',
          objects: [part.id, signalId, ...nets],
          signalIds: [signalId],
          message:
            expected.reference +
            ' ' +
            name +
            ' does not match the schematic net.',
        });
      }
      bindings.delete(signalId);
    }
    for (const signalId of bindings.keys()) {
      issues.push({
        code: 'unexpected-signal',
        objects: [part.id, signalId],
        message:
          'Board has a signal outside the schematic for ' +
          expected.reference +
          '.',
      });
    }
  }
  for (const [id, part] of placed) {
    if (required.has(id)) continue;
    issues.push({
      code: 'unexpected-component',
      objects: [part.id],
      message:
        (part.reference || id) +
        ' is outside the schematic and lacks the PCB-only role.',
    });
  }
  return issues;
}
