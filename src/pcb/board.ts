import { validateOutline } from './geometry';
import type { BoardPoint } from './geometry';
import { isEntityId } from '../model/schematicIdentity';
import { validateBoardAssets } from './boardAssets';
import type { BoardAssets } from './boardAssets';

export const BOARD_FILE_EXTENSION = '.dpn';

export const boardFormat = {
  format: 'tinycad-pcb',
  schemaVersion: 1,
  lengthUnit: 'nm',
  angleUnit: 'microdegree',
  coordinateFrame: 'top-view-x-right-y-up-ccw',
} as const;

export interface CopperLayer {
  readonly id: 'top' | 'bottom';
  readonly order: 0 | 1;
}

type BoardFeature = 'straight-outline' | 'embedded-devices';

export interface BoardDocument extends BoardAssets {
  readonly format: typeof boardFormat.format;
  readonly schemaVersion: typeof boardFormat.schemaVersion;
  readonly lengthUnit: typeof boardFormat.lengthUnit;
  readonly angleUnit: typeof boardFormat.angleUnit;
  readonly coordinateFrame: typeof boardFormat.coordinateFrame;
  readonly boardId: string;
  readonly revision: number;
  readonly title: string;
  readonly requiredFeatures: readonly BoardFeature[];
  readonly copperLayers: readonly CopperLayer[];
  readonly outline: readonly BoardPoint[];
}

const supportedFeatures: readonly BoardFeature[] = [
  'straight-outline',
  'embedded-devices',
];
const copperStack = Object.freeze([
  Object.freeze({ id: 'top', order: 0 } as const),
  Object.freeze({ id: 'bottom', order: 1 } as const),
]);

export function createBoard(
  title: string,
  layerCount: 1 | 2,
  outline: readonly BoardPoint[],
): BoardDocument {
  if (layerCount !== 1 && layerCount !== 2)
    throw new Error('Choose one or two copper layers.');
  return readBoard({
    ...boardFormat,
    boardId: crypto.randomUUID(),
    revision: 0,
    title,
    requiredFeatures: ['straight-outline'],
    copperLayers: copperStack.slice(0, layerCount),
    outline,
  });
}

function readBoard(value: unknown): BoardDocument {
  if (!value || typeof value !== 'object')
    throw new Error('Expected a TinyCAD PCB document.');
  const board = value as BoardDocument;
  if (
    board.format !== boardFormat.format ||
    board.schemaVersion !== boardFormat.schemaVersion ||
    board.lengthUnit !== boardFormat.lengthUnit ||
    board.angleUnit !== boardFormat.angleUnit ||
    board.coordinateFrame !== boardFormat.coordinateFrame
  ) {
    throw new Error(
      'Unsupported TinyCAD PCB format, version, or coordinate frame.',
    );
  }
  if (
    !Array.isArray(board.requiredFeatures) ||
    !board.requiredFeatures.includes('straight-outline') ||
    !Array.from(board.requiredFeatures).every((feature) =>
      supportedFeatures.includes(feature),
    ) ||
    new Set(board.requiredFeatures).size !== board.requiredFeatures.length
  ) {
    throw new Error('Unsupported TinyCAD PCB feature requirements.');
  }
  if (
    !isEntityId(board.boardId) ||
    !Number.isSafeInteger(board.revision) ||
    board.revision < 0 ||
    typeof board.title !== 'string' ||
    !board.title.trim()
  ) {
    throw new Error('Invalid board identity, revision, or title.');
  }
  if (
    !Array.isArray(board.copperLayers) ||
    board.copperLayers.length < 1 ||
    board.copperLayers.length > 2 ||
    !Array.from(board.copperLayers).every(
      (layer, i) => layer?.id === copperStack[i].id && layer.order === i,
    )
  ) {
    throw new Error('Invalid physical copper layer order.');
  }
  validateOutline(board.outline);
  validateBoardAssets(board, board.requiredFeatures);
  return freezeJson({
    ...board,
    requiredFeatures: [...board.requiredFeatures].sort(),
  }) as BoardDocument;
}

// Preserve optional fields at every nesting level and keep snapshots independent of caller objects.
function freezeJson(value: unknown, depth = 0): unknown {
  if (depth > 48)
    throw new Error('PCB document exceeds supported nesting depth.');
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return value;
  if (Array.isArray(value))
    return Object.freeze(
      Array.from(value, (item) => freezeJson(item, depth + 1)),
    );
  if (
    value &&
    typeof value === 'object' &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    const record = value as Record<string, unknown>;
    return Object.freeze(
      Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, freezeJson(record[key], depth + 1)]),
      ),
    );
  }
  throw new Error('PCB document contains a non-JSON value.');
}

export function parseBoard(json: string): BoardDocument {
  return readBoard(JSON.parse(json));
}

export function serializeBoard(board: BoardDocument): string {
  return JSON.stringify(readBoard(board), null, 2) + '\n';
}

export type BoardOperation =
  | { readonly type: 'rename'; readonly title: string }
  | {
      readonly type: 'replaceOutline';
      readonly outline: readonly BoardPoint[];
    };

export interface BoardCommand {
  readonly apiVersion: 1;
  readonly boardId: string;
  readonly expectedRevision: number;
  readonly operations: readonly BoardOperation[];
}

export class BoardRevisionConflict extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Board revision conflict. Expected ${expectedRevision}, current revision is ${actualRevision}.`,
    );
    this.name = 'BoardRevisionConflict';
  }
}

export class BoardHistory {
  private current: BoardDocument;
  private readonly past: BoardDocument[] = [];
  private readonly future: BoardDocument[] = [];

  constructor(board: BoardDocument) {
    this.current = readBoard(board);
  }

  get board(): BoardDocument {
    return this.current;
  }

  apply(command: BoardCommand): BoardDocument {
    if (command.apiVersion !== 1 || command.boardId !== this.current.boardId) {
      throw new Error('Unsupported board command version or target.');
    }
    if (command.expectedRevision !== this.current.revision) {
      throw new BoardRevisionConflict(
        command.expectedRevision,
        this.current.revision,
      );
    }
    if (!command.operations.length)
      throw new Error('A board command needs at least one operation.');
    let candidate = this.current;
    for (const operation of command.operations) {
      switch (operation.type) {
        case 'rename':
          if (typeof operation.title !== 'string' || !operation.title.trim())
            throw new Error('Enter a board title.');
          candidate = { ...candidate, title: operation.title };
          break;
        case 'replaceOutline':
          validateOutline(operation.outline);
          candidate = { ...candidate, outline: operation.outline };
          break;
        default:
          throw new Error('Unsupported board operation.');
      }
    }
    const next = readBoard({
      ...candidate,
      revision: this.current.revision + 1,
    });
    this.past.push(this.current);
    this.future.length = 0;
    this.current = next;
    return next;
  }

  undo(expectedRevision: number): BoardDocument {
    return this.restore(expectedRevision, this.past, this.future);
  }

  redo(expectedRevision: number): BoardDocument {
    return this.restore(expectedRevision, this.future, this.past);
  }

  private restore(
    expectedRevision: number,
    from: BoardDocument[],
    to: BoardDocument[],
  ): BoardDocument {
    if (expectedRevision !== this.current.revision) {
      throw new BoardRevisionConflict(expectedRevision, this.current.revision);
    }
    const previous = from[from.length - 1];
    if (!previous) return this.current;
    const next = readBoard({
      ...previous,
      revision: this.current.revision + 1,
    });
    from.pop();
    to.push(this.current);
    this.current = next;
    return next;
  }
}
