import { boardComponentDevice } from '../pcb/deviceReview';
import type { OpenProjectDrawing } from './projectStorage';
import { readProject, readProjectBoard } from './projects';

export interface BoardWorkspaceProbe {
  componentId: string;
  padId?: string;
  netId?: string;
}

export async function locateSchematicComponentOnBoards(
  location: Pick<
    OpenProjectDrawing,
    'id' | 'rootId' | 'entryId' | 'hierarchyTrail'
  >,
  unitId: string,
  pinId?: string,
) {
  const trail = location.hierarchyTrail ?? [];
  const placements = trail.map(({ placementId }) => placementId);
  // A board rooted at a child uses the path relative to that child.
  const sourcePaths = new Map(
    trail.map(({ entryId }, depth) => [
      entryId,
      placements.slice(depth).join('/'),
    ]),
  );
  sourcePaths.set(location.entryId, '');
  const project = await readProject(location.id, location.rootId);
  const associations = new Map(
    project.settings.associations?.map(({ schematic, board }) => [
      board,
      schematic,
    ]),
  );
  const boards = project.settings.entries.filter(
    ({ kind, id }) =>
      kind === 'board' &&
      (!associations.has(id) || sourcePaths.has(associations.get(id))),
  );
  const matches = await Promise.all(
    boards.map(async (entry) => {
      const { board, circuit } = await readProjectBoard(project, entry.id);
      const path = sourcePaths.get(circuit?.documentId);
      if (path === undefined || !circuit.sources) return undefined;
      const units = new Set(
        Object.entries(circuit.sources).flatMap(([id, source]) =>
          source.documentId === location.entryId &&
          source.unitId === unitId &&
          source.instancePath.join('/') === path
            ? [id]
            : [],
        ),
      );
      const part = circuit.components.find(({ units: members }) =>
        members.some(({ id }) => units.has(id)),
      );
      if (!part) return undefined;
      const {
        part: pcb,
        placement,
        device,
        footprint,
      } = boardComponentDevice(board, part.id);
      if (!pcb) return undefined;
      const signalIds = new Set(
        part.signals
          .filter(({ terminals }) =>
            terminals.some(
              (item) =>
                units.has(item.unitId) && (!pinId || item.pinId === pinId),
            ),
          )
          .map(({ id }) => id),
      );
      const netNames = new Map(board.nets?.map(({ id, name }) => [id, name]));
      const signals = new Map(
        part.signals.map((signal) => [signal.id, signal]),
      );
      const signalNets = new Map(
        pcb.signals?.map(({ signalId, netId }) => [signalId, netId]),
      );
      const definitions = new Map(footprint?.pads.map((pad) => [pad.id, pad]));
      const pads = (device?.assignments ?? []).flatMap((binding) => {
        if (binding.kind !== 'signal' || !signalIds.has(binding.signalId))
          return [];
        const signal = signals.get(binding.signalId);
        const pad = definitions.get(binding.padId);
        if (!pad || !signal) return [];
        const netId = signalNets.get(signal.id);
        return [
          {
            id: pad.id,
            label: pad.label,
            signal: signal.name,
            netId,
            net: netNames.get(netId),
          },
        ];
      });
      return {
        path: entry.path,
        boardId: entry.id,
        componentId: pcb.id,
        reference: pcb.reference ?? part.reference,
        footprint,
        placement,
        pads,
      };
    }),
  );
  return matches.filter(Boolean);
}

export type BoardProbeMatch = Awaited<
  ReturnType<typeof locateSchematicComponentOnBoards>
>[number];
