import { decodeDrawing } from './dsnCodec';
import { buildHierarchicalNetlist, stableHierarchyId } from '../pcb/hierarchicalNetlist';
import { buildHierarchicalCircuitSnapshot } from '../pcb/hierarchicalSnapshot';
import { reviewCircuitNets } from '../pcb/circuitNets';
import type { CircuitNetDraft, SchematicTerminal } from '../pcb/circuitNets';
import { validateCircuitSnapshot } from '../pcb/circuitSnapshot';
import type { CircuitComponent, CircuitSnapshot } from '../pcb/circuitSnapshot';

async function readProtel(text: string, documentId: string, revision: number, previous?: CircuitSnapshot) {
  const components = new Map<string, CircuitComponent & { signals: CircuitComponent['signals'][number][] }>();
  const lines = text.trim().split(/\r?\n/).map((line) => line.trim());
  const drafts: CircuitNetDraft[] = [];
  for (let index = 0; index < lines.length;) {
    const opening = lines[index++];
    if (!opening) continue;
    if (opening !== '[' && opening !== '(') throw new Error('Choose a TinyCAD Protel-format netlist.');
    const end = lines.indexOf(opening === '[' ? ']' : ')', index);
    if (end === -1) throw new Error('A Protel netlist block is incomplete.');
    const fields = lines.slice(index, end);
    index = end + 1;
    if (opening === '[') {
      const [reference, packageHint = '', value = ''] = fields;
      if (!reference || components.has(reference.toLowerCase())) throw new Error('The netlist contains an invalid or duplicate component reference.');
      const id = await stableHierarchyId('netlist-component', documentId, reference.toLowerCase());
      components.set(reference.toLowerCase(), {
        id, reference, packageHint, value, role: 'electrical',
        units: [{ id: await stableHierarchyId('netlist-unit', id), sheetId: documentId }],
        signals: [],
      });
      continue;
    }
    const [name, ...members] = fields;
    const terminals: SchematicTerminal[] = [];
    for (const member of members.filter(Boolean)) {
      const split = member.indexOf('-');
      const component = split > 0 && components.get(member.slice(0, split).toLowerCase());
      const number = member.slice(split + 1);
      if (!component || !number) throw new Error(`Unknown terminal ${member} in net ${name}.`);
      const id = await stableHierarchyId('netlist-signal', component.id, number);
      const terminal = { unitId: component.units[0].id, pinId: id };
      component.signals.push({ id, name: number, number, terminals: [terminal] });
      terminals.push(terminal);
    }
    if (!name || !terminals.length) throw new Error('A net must have a name and at least one terminal.');
    drafts.push({ names: [name], terminals });
  }
  if (!components.size) throw new Error('The netlist contains no components.');
  const nets = await Promise.all(reviewCircuitNets(previous?.nets ?? [], drafts).nets.map(async ({ draft, retainedId }) => ({
    ...draft,
    id: retainedId ?? await stableHierarchyId('netlist-net', documentId,
      ...draft.terminals.map(({ unitId, pinId }) => unitId + ':' + pinId).sort()),
  })));
  const snapshot: CircuitSnapshot = {
    schemaVersion: 1, documentId, revision, components: [...components.values()],
    snapshotId: await stableHierarchyId('circuit-snapshot', documentId, String(revision)),
    nets, noConnects: [],
  };
  validateCircuitSnapshot(snapshot);
  return snapshot;
}

export async function readBoardCircuitSource(file: File, previous?: CircuitSnapshot): Promise<CircuitSnapshot> {
  const revision = (previous?.revision ?? 0) + 1;
  if (/\.net$/i.test(file.name)) {
    const documentId = await stableHierarchyId('netlist-document', file.name.toLowerCase());
    return readProtel(await file.text(), documentId, revision, previous);
  }
  if (!/\.d[sz]n$/i.test(file.name)) throw new Error('Choose a TinyCAD schematic or Protel netlist.');
  const drawing = await decodeDrawing(await file.arrayBuffer());
  const documentId = drawing.documentId ?? await stableHierarchyId('schematic-document', file.name.toLowerCase());
  const graph = await buildHierarchicalNetlist({ path: file.name, drawing: { ...drawing, documentId } }, async () => {
    throw new Error('Open the schematic and its linked sheets in a project to update the PCB.');
  });
  return (await buildHierarchicalCircuitSnapshot(graph, { documentId, revision, previous: previous?.nets })).snapshot;
}
