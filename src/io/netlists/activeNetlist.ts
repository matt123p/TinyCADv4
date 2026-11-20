import { hasChildPlacements } from '../hierarchyDrawing';
import { wkrGenerateNetlist } from '../../web-worker/worker';
import type { docDrawing } from '../../state/undo/undo';
import type { CircuitSnapshot } from '../../pcb/circuitSnapshot';
import type { dsnDrawing } from '../../model/dsnDrawing';
import type { OpenProjectAction } from '../projects';

export async function generateActiveNetlist(state: docDrawing) {
  const { drawing } = state.docStore.present;
  if (!hasChildPlacements(drawing)) return wkrGenerateNetlist(drawing);
  const location = state.altStore.file.project;
  if (!location)
    throw new Error(
      'Open this schematic from its project to compile its child designs.',
    );
  return generateProjectHierarchy(location, drawing);
}

async function generateProjectHierarchy(
  location: OpenProjectAction['location'],
  drawing: dsnDrawing,
) {
  const [{ readProject }, { resolveChild }, { buildHierarchicalNetlist }] =
    await Promise.all([
      import('../projects'),
      import('../projectHierarchy'),
      import('../../pcb/hierarchicalNetlist'),
    ]);
  const project = await readProject(location.id, location.rootId);
  const root = project.settings.entries.find(
    ({ id, kind }) => kind === 'schematic' && id === location.entryId,
  );
  if (!root || drawing.documentId !== root.id)
    throw new Error('The hierarchy root no longer matches its project link.');
  return buildHierarchicalNetlist(
    { path: root.path, drawing },
    async (parent, link) => {
      const child = await resolveChild(
        project,
        { rootId: location.rootId, documentPath: parent.path },
        link,
      );
      if (!child.entry)
        throw new Error(
          `Add ${child.path} to this project to persist its schematic identities.`,
        );
      return { path: child.path, drawing: child.drawing };
    },
  );
}

export async function reviewProjectCircuit(
  location: OpenProjectAction['location'],
  drawing: dsnDrawing,
  previous: CircuitSnapshot,
) {
  if (drawing.documentId !== previous.documentId)
    throw new Error('The active schematic and the board source do not match.');
  const { buildHierarchicalCircuitSnapshot } = await import(
    '../../pcb/hierarchicalSnapshot'
  );
  const graph = await generateProjectHierarchy(location, drawing);
  return buildHierarchicalCircuitSnapshot(graph, {
    documentId: previous.documentId,
    revision: previous.revision + 1,
    previous: previous.nets,
  });
}

/** Expand the same resolved circuit used by ERC and netlist exports. */
export function generateActiveBom() {
  return async (
    dispatch: import('redux').Dispatch,
    getState: () => docDrawing,
  ) => {
    const { actionBomGenerate, actionSelectDialog } = await import(
      '../../state/dispatcher/AppDispatcher'
    );
    const initial = getState();
    if (!hasChildPlacements(initial.docStore.present.drawing)) {
      dispatch(actionBomGenerate());
      return;
    }
    const stillCurrent = () =>
      getState().altStore.file === initial.altStore.file &&
      getState().docStore.present.drawing === initial.docStore.present.drawing;
    try {
      const graph = await generateActiveNetlist(initial);
      if (!stillCurrent()) return;
      const groups = new Map<
        string,
        import('../../model/dsnBomEntry').dsnBomEntry
      >();
      const seen = new Set<string>();
      for (const [, symbol] of graph.symbols) {
        const reference = symbol.text.find(
          (field) => field.description === 'Ref',
        )?.value;
        const name =
          symbol.text.find((field) => field.description === 'Name')?.value ||
          '';
        const key = name.toLowerCase();
        const member = JSON.stringify([key, reference.toLowerCase()]);
        if (seen.has(member)) continue;
        seen.add(member);
        const entry = groups.get(key) ?? {
          Name: name,
          References: [],
          Quantity: 0,
        };
        entry.References.push(reference);
        entry.Quantity += 1;
        groups.set(key, entry);
      }
      for (const entry of groups.values())
        entry.References.sort((a, b) => a.localeCompare(b));
      dispatch(
        actionBomGenerate(
          [...groups.values()].sort((a, b) => a.Name.localeCompare(b.Name)),
        ),
      );
    } catch (error) {
      if (stillCurrent())
        dispatch(actionSelectDialog('io_failure', { message: String(error) }));
    }
  };
}
