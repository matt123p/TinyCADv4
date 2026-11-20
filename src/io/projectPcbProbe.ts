import { boardComponentDevice } from '../pcb/deviceReview';
import type { OpenProjectDrawing } from './projectStorage';
import { readProject, readProjectBoard } from './projects';

export async function locateSchematicComponentOnBoards(
  location: Pick<
    OpenProjectDrawing,
    'id' | 'rootId' | 'entryId' | 'hierarchyTrail'
  >,
  unitId: string,
  pinId?: string,
) {
  const instancePath =
    location.hierarchyTrail?.map(({ placementId }) => placementId) ?? [];
  const sourceId = location.hierarchyTrail?.[0]?.entryId ?? location.entryId;
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
      (!associations.has(id) || associations.get(id) === sourceId),
  );
  const matches = await Promise.all(
    boards.map(async (entry) => {
      const { board, circuit } = await readProjectBoard(project, entry.id);
      if (circuit?.documentId !== sourceId || !circuit.sources)
        return undefined;
      const units = new Set(
        Object.entries(circuit.sources).flatMap(([id, source]) =>
          source.documentId === location.entryId &&
          source.unitId === unitId &&
          source.instancePath.join('/') === instancePath.join('/')
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
        return [
          {
            id: pad.id,
            label: pad.label,
            signal: signal.name,
            net: netNames.get(signalNets.get(signal.id)),
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
