import type { dsnDrawing } from '../model/dsnDrawing';
import { DocItemTypes } from '../model/dsnItem';
import {
  instanceReferenceKey,
  isReferenceDesignator,
} from '../model/schematicReferences';
import { validateBoard } from './board';
import type { BoardDocument } from './board';
import type {
  CircuitSchematicSource,
  CircuitSnapshot,
} from './circuitSnapshot';

export type ReferenceConflictChoice = 'pcb' | 'schematic';

function duplicateReferences<T extends { readonly reference?: string }>(
  components: readonly T[],
) {
  const used = new Set<string>();
  const duplicate = new Set<string>();
  for (const { reference } of components) {
    if (!reference) continue;
    const key = reference.trim().toLowerCase();
    if (used.has(key)) duplicate.add(reference);
    used.add(key);
  }
  return [...duplicate];
}

/** Save manual PCB reference changes without changing the last synchronised circuit. */
export function editBoardReferences(
  board: BoardDocument,
  edits: ReadonlyMap<string, string>,
): BoardDocument {
  const components = (board.components ?? []).map((item) => {
    if (!edits.has(item.id)) return item;
    const reference = edits.get(item.id).trim();
    if (!isReferenceDesignator(reference))
      throw new Error(
        'Enter valid reference designators without spaces or question marks.',
      );
    return { ...item, reference };
  });
  if (
    [...edits.keys()].some((id) => !components.some((item) => item.id === id))
  )
    throw new Error('A component in the proposed edit no longer exists.');
  const duplicates = duplicateReferences(components);
  if (duplicates.length)
    throw new Error(`Duplicate PCB reference: ${duplicates.join(', ')}.`);
  return validateBoard({ ...board, revision: board.revision + 1, components });
}

export function previewBackAnnotation(
  drawing: dsnDrawing,
  board: BoardDocument,
  applied: CircuitSnapshot,
  current: CircuitSnapshot,
  choices: ReadonlyMap<string, ReferenceConflictChoice> = new Map(),
) {
  if (
    drawing.documentId !== applied.documentId ||
    drawing.documentId !== current.documentId ||
    board.sourceCircuit?.documentId !== applied.documentId ||
    board.sourceCircuit?.revision !== applied.revision ||
    !applied.sources ||
    !current.sources
  )
    throw new Error(
      'The board and schematic need a matching applied circuit with source identities.',
    );
  const currentParts = new Map(
    current.components.map((part) => [part.id, part]),
  );
  const baseline = new Map(applied.components.map((part) => [part.id, part]));
  const linked = new Set<string>();
  const changes: {
    componentId: string;
    boardId: string;
    before: string;
    schematic: string;
    pcb: string;
    result?: string;
    sources: readonly CircuitSchematicSource[];
  }[] = [];
  const errors: string[] = [];
  for (const item of board.components ?? []) {
    if (item.role === 'pcb-only') continue;
    const componentId = item.logicalId ?? item.id;
    if (linked.has(componentId)) {
      errors.push(
        'Multiple board components refer to the same schematic component.',
      );
      continue;
    }
    linked.add(componentId);
    const prior = baseline.get(componentId);
    if (!prior) {
      errors.push(
        `${item.reference ?? item.id}: schematic component link needs repair.`,
      );
      continue;
    }
    const pcb = item.reference ?? prior.reference;
    if (pcb === prior.reference) continue;
    const part = currentParts.get(componentId);
    const sources = part?.units.map(({ id }) => current.sources[id]) ?? [];
    if (
      !part ||
      sources.length !== prior.units.length ||
      !part.units.every(({ id }) => prior.units.some((unit) => unit.id === id))
    ) {
      errors.push(
        `${pcb}: original schematic units no longer match the board link.`,
      );
      continue;
    }
    const choice = choices.get(componentId);
    const result =
      part.reference !== prior.reference && part.reference !== pcb
        ? choice === 'pcb'
          ? pcb
          : choice === 'schematic'
          ? part.reference
          : undefined
        : pcb;
    changes.push({
      componentId,
      boardId: item.id,
      before: prior.reference,
      schematic: part.reference,
      pcb,
      result,
      sources,
    });
  }

  const selected = new Map(
    changes
      .filter(({ result }) => !!result)
      .map((change) => [change.componentId, change]),
  );
  const boardEdits = new Map(
    changes
      .filter(({ result }) => !!result)
      .map(({ boardId, result }) => [boardId, result]),
  );
  const schematicDuplicates = duplicateReferences(
    current.components.map((part) => ({
      reference: selected.get(part.id)?.result ?? part.reference,
    })),
  );
  if (schematicDuplicates.length)
    errors.push(
      `Duplicate schematic reference: ${schematicDuplicates.join(', ')}.`,
    );
  const boardDuplicates = duplicateReferences(
    (board.components ?? []).map((part) => ({
      reference: boardEdits.get(part.id) ?? part.reference,
    })),
  );
  if (boardDuplicates.length)
    errors.push(`Duplicate PCB reference: ${boardDuplicates.join(', ')}.`);
  if (changes.some(({ result }) => result && !isReferenceDesignator(result)))
    errors.push(
      'Use valid reference designators without spaces or question marks.',
    );

  return {
    changes,
    errors,
    canApply:
      !!changes.length &&
      !errors.length &&
      changes.every(({ result }) => result !== undefined),
  };
}

export function applyBackAnnotation(
  drawing: dsnDrawing,
  board: BoardDocument,
  applied: CircuitSnapshot,
  current: CircuitSnapshot,
  choices?: ReadonlyMap<string, ReferenceConflictChoice>,
) {
  const review = previewBackAnnotation(
    drawing,
    board,
    applied,
    current,
    choices,
  );
  if (!review.canApply)
    throw new Error(
      'Resolve reference conflicts before applying back annotation.',
    );
  const local = new Map<string, string>();
  const instances = new Map(
    (drawing.instanceReferences ?? []).map((reference) => [
      instanceReferenceKey(reference),
      reference,
    ]),
  );
  const references = new Map(
    review.changes.map(({ componentId, result }) => [componentId, result]),
  );
  const boardEdits = new Map(
    review.changes.map(({ boardId, result }) => [boardId, result]),
  );
  for (const { componentId, schematic, result, sources } of review.changes) {
    if (schematic === result) continue;
    for (const { instancePath, unitId } of sources) {
      if (instancePath.length) {
        const entry = { instancePath, componentId, reference: result };
        instances.set(instanceReferenceKey(entry), entry);
      } else local.set(unitId, result);
    }
  }
  const nextDrawing = {
    ...drawing,
    ...(instances.size ? { instanceReferences: [...instances.values()] } : {}),
    sheets: drawing.sheets.map((sheet) => ({
      ...sheet,
      items: sheet.items.map((item) =>
        item.NodeName === DocItemTypes.Symbol && local.has(item.unitId)
          ? {
              ...item,
              text: item.text.map((field) =>
                field.description === 'Ref'
                  ? { ...field, value: local.get(item.unitId) }
                  : field,
              ),
            }
          : item,
      ),
    })),
  };
  const appliedCircuit: CircuitSnapshot = {
    ...applied,
    snapshotId: crypto.randomUUID(),
    revision: applied.revision + 1,
    components: applied.components.map((part) =>
      references.has(part.id)
        ? { ...part, reference: references.get(part.id) }
        : part,
    ),
  };
  const nextBoard = validateBoard({
    ...editBoardReferences(board, boardEdits),
    requiredFeatures: [
      ...new Set([...board.requiredFeatures, 'applied-circuit' as const]),
    ],
    sourceCircuit: {
      ...board.sourceCircuit,
      revision: appliedCircuit.revision,
    },
    appliedCircuit,
  });
  return { drawing: nextDrawing, board: nextBoard };
}
