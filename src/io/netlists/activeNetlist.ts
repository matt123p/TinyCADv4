import { DocItemTypes } from '../../model/dsnItem';
import { hasChildPlacements } from '../hierarchyDrawing';
import { wkrGenerateNetlist } from '../../web-worker/worker';
import type { docDrawing } from '../../state/undo/undo';
import type { CircuitSnapshot } from '../../pcb/circuitSnapshot';
import type { dsnDrawing } from '../../model/dsnDrawing';
import type { OpenProjectAction } from '../projects';

export async function generateActiveNetlist(state: docDrawing) {
  const { drawing } = state.docStore.present;
  const location = state.altStore.file.project;
  const references = location?.instanceReferencesByUnit;
  const effective =
    references && Object.keys(references).length
      ? {
          ...drawing,
          sheets: drawing.sheets.map((sheet) => ({
            ...sheet,
            items: sheet.items.map((item) =>
              item.NodeName === DocItemTypes.Symbol && references[item.unitId]
                ? {
                    ...item,
                    text: item.text.map((field) =>
                      field.description === 'Ref'
                        ? { ...field, value: references[item.unitId] }
                        : field,
                    ),
                  }
                : item,
            ),
          })),
        }
      : drawing;
  // The incremental worker cache belongs to the drawing, so compile instance overrides separately.
  if (effective === drawing && !hasChildPlacements(drawing))
    return wkrGenerateNetlist(drawing);
  if (!location)
    throw new Error(
      'Open this schematic from its project to compile its child designs.',
    );
  return generateProjectHierarchy(location, effective);
}

async function generateProjectHierarchy(
  location: Pick<OpenProjectAction['location'], 'id' | 'rootId' | 'entryId'>,
  drawing: dsnDrawing,
  observe?: (path: string, source: dsnDrawing) => void,
  openDrawing?: (id: string) => dsnDrawing | undefined,
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
  observe?.(root.path, drawing);
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
      const drawing = openDrawing?.(child.entry.id) ?? child.drawing;
      observe?.(child.path, drawing);
      return { path: child.path, drawing };
    },
  );
}

export async function reviewProjectCircuit(
  location: Pick<OpenProjectAction['location'], 'id' | 'rootId' | 'entryId'>,
  drawing: dsnDrawing,
  previous: CircuitSnapshot,
  observe?: (path: string, source: dsnDrawing) => void,
  openDrawing?: (id: string) => dsnDrawing | undefined,
) {
  if (
    drawing.documentId !== location.entryId ||
    (previous && drawing.documentId !== previous.documentId)
  )
    throw new Error('The active schematic and the board source do not match.');
  const { buildHierarchicalCircuitSnapshot } = await import(
    '../../pcb/hierarchicalSnapshot'
  );
  const graph = await generateProjectHierarchy(
    location,
    drawing,
    observe,
    openDrawing,
  );
  return buildHierarchicalCircuitSnapshot(graph, {
    documentId: drawing.documentId,
    revision: previous ? previous.revision + 1 : 1,
    previous: previous?.nets,
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
    if (
      !hasChildPlacements(initial.docStore.present.drawing) &&
      !Object.keys(
        initial.altStore.file.project?.instanceReferencesByUnit ?? {},
      ).length
    ) {
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
