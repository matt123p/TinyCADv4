import type { dsnDrawing } from '../model/dsnDrawing';
import type { BoardInstancePort, dsnSymbol, dsnSymbolHint } from '../model/dsnItem';
import type { ProjectLink } from '../pcb/projectSettings';
import { createSheetSnapshot, mergeSheetSnapshots } from '../web-worker/netlistState';
import { childInterface, isChildPlacement } from './hierarchyDrawing';
import { linkedBoardSource, readProjectSchematic } from './projectHierarchy';
import { readProjectBoard } from './projects';
import type { readProject } from './projects';

type Project = Awaited<ReturnType<typeof readProject>>;

export const boardInstancePorts = (item: dsnSymbol) =>
  item._symbol.outlines[0].active_points.map(({ pin }) => ({ id: pin.pinId, name: pin.name.trim() }));

export async function boardInstanceArtwork(drawing: dsnDrawing, board: ProjectLink) {
  const artwork = await childInterface(drawing, board.path);
  return { ...artwork, uid: artwork.uid + ':' + board.id };
}

const endpointKey = ({ componentId, signalId }: Pick<BoardInstancePort, 'componentId' | 'signalId'>) =>
  componentId + ':' + signalId;

interface BoardEndpoint {
  componentId: string;
  signalId: string;
  reference: string;
  pin: string;
  pads: string[];
  net?: string;
}

export async function readBoardInterface(project: Project, boardId: string) {
  const links = linkedBoardSource(project, boardId);
  if (!project.files.has(links.board.path))
    throw new Error(`Missing or ambiguous project PCB: ${links.board.path}`);
  const { board, circuit } = await readProjectBoard(project, boardId);
  if (circuit?.documentId !== links.source.id)
    throw new Error(`Apply the PCB's source schematic before mapping ports in ${links.board.path}.`);
  const devices = new Map(board.deviceDefinitions?.map((device) => [device.id, device]));
  const footprints = new Map(board.footprintDefinitions?.map((footprint) => [footprint.id, footprint]));
  const components = new Map(circuit.components.map((component) => [component.id, component]));
  const nets = new Map(board.nets?.map(({ id, name }) => [id, name]));
  const endpoints = new Map<string, BoardEndpoint>();
  for (const part of board.components ?? []) {
    if (part.role === 'pcb-only' || part.role === 'dnp') continue;
    const logical = components.get(part.logicalId ?? part.id);
    const device = devices.get(part.deviceId);
    if (!logical || !device) continue;
    const labels = new Map(footprints.get(device.footprintId)?.pads.map(({ id, label }) => [id, label]));
    const bindings = new Map(part.signals?.map(({ signalId, netId }) => [signalId, netId]));
    for (const signal of logical.signals) {
      const pads = device.assignments.flatMap((assignment) =>
        assignment.kind === 'signal' && assignment.signalId === signal.id && labels.has(assignment.padId)
          ? [labels.get(assignment.padId)] : [],
      );
      if (!pads.length) continue;
      const endpoint = {
        componentId: logical.id, signalId: signal.id, reference: part.reference ?? logical.reference,
        pin: [signal.number, signal.name].filter((name, index, names) => name && names.indexOf(name) === index).join(' · '),
        pads, net: nets.get(bindings.get(signal.id)),
      };
      endpoints.set(endpointKey(endpoint), endpoint);
    }
  }
  return { ...links, endpoints };
}

export async function reviewProjectSystem(project: Project, drawing: dsnDrawing) {
  const sheets = drawing.sheets.filter((sheet) => !sheet.hierarchicalSymbol && sheet.kind !== 'simulation');
  const instances = new Map<string, dsnSymbol>();
  for (const sheet of sheets) {
    for (const item of sheet.items) {
      if (!isChildPlacement(item)) continue;
      if (!item.hierarchy.boardInstance)
        throw new Error('Use board instances for the system drawing. Keep circuit child designs in the individual board sources.');
      if (!item.unitId || instances.has(item.unitId))
        throw new Error('A board instance is missing a unique placement identity.');
      instances.set(item.unitId, item);
    }
  }
  const interfaces = new Map<string, ReturnType<typeof readBoardInterface>>();
  const artwork = new Map<string, ReturnType<typeof boardInstanceArtwork>>();
  const ports = new Map<string, {
    instance: string;
    name: string;
    board: string;
    endpoint?: BoardEndpoint;
  }>();
  const problems: string[] = [];
  for (const item of instances.values()) {
    const { boardId, ports: mappings } = item.hierarchy.boardInstance;
    const instance = item.text.find(({ description }) => description === 'Ref')?.value || 'Board';
    try {
      if (!interfaces.has(boardId)) interfaces.set(boardId, readBoardInterface(project, boardId));
      const { board, source, endpoints } = await interfaces.get(boardId);
      if (source.id !== item.hierarchy.documentId)
        throw new Error('The source association changed. Replace this board instance.');
      if (!artwork.has(boardId))
        artwork.set(boardId, readProjectSchematic(project, source).then((drawing) => boardInstanceArtwork(drawing, board)));
      if (item._symbol.uid !== (await artwork.get(boardId)).uid)
        throw new Error('Reload the board interface before reviewing connections.');
      const pinMappings = new Map(mappings.map((mapping) => [mapping.portId, mapping]));
      for (const { id, name } of boardInstancePorts(item)) {
        const mapping = pinMappings.get(id);
        const endpoint = mapping && endpoints.get(endpointKey(mapping));
        if (!endpoint)
          problems.push(`${instance} · ${name}: ${mapping ? 'mapped PCB pad is unavailable' : 'map this port to a PCB pad'}.`);
        ports.set(item.unitId + ':' + id, { instance, name, board: board.path, endpoint });
      }
    } catch (error) {
      problems.push(`${instance}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const graph = mergeSheetSnapshots(sheets.map((sheet) => createSheetSnapshot({
    ...sheet,
    items: sheet.items.map((item) => 'hints' in item ? { ...item, hints: [] as dsnSymbolHint[] } : item),
  }, true)));
  const labels = new Map<string, string[]>();
  for (const [label, net] of Object.entries(graph.labels)) {
    const names = labels.get(net) ?? [];
    names.push(label);
    labels.set(net, names);
  }
  const networks = Object.entries(graph.nets).flatMap(([id, nodes]) => {
    const members = nodes.flatMap(({ port }) => {
      const member = port && ports.get(port.placementId + ':' + port.pinId);
      return member ? [member] : [];
    });
    return members.length ? [{ id, name: labels.get(id)?.join(' / ') ?? 'Net ' + id, members }] : [];
  });
  return { problems, networks };
}
