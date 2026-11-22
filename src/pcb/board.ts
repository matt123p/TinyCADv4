import { validateBoardJumpers } from './boardJumpers';
import { validateBoardAnnotations } from './boardAnnotations';
import type { BoardAnnotations } from './boardAnnotations';
import type { BoardWireJumper } from './boardJumpers';
import { validatePlacementAreas } from './placementAreas';
import type { PlacementArea } from './placementAreas';
import type { RouteRules } from './routing';
import { validateOutline } from './geometry';
import type { BoardPoint } from './geometry';
import { isEntityId } from '../model/schematicIdentity';
import { validateBoardAssets } from './boardAssets';
import type { BoardAssets } from './boardAssets';
import { validateBoardMechanical } from './boardMechanical';
import type { BoardMechanicalHole } from './boardMechanical';
import { validateBoardRouting } from './boardRouting';
import type { BoardTrack, BoardVia } from './boardRouting';
import { validateBoardFabrication } from './fabricationProfiles';
import type { BoardFabrication } from './fabricationProfiles';
import { validateBoardRules } from './boardRules';
import type { BoardNetClass, CopperClearanceRule, NetRoutingRules } from './boardRules';
import { validateBoardWaivers } from './boardWaivers';
import type { BoardWaiver } from './boardWaivers';
import { validateBoardZones } from './boardZones';
import type { BoardZone } from './boardZones';
import { validateRoutingRegions } from './routingRegions';
import type { RoutingRegion } from './routingRegions';
import { profileRegion } from './contours';
import type { BoardProfile } from './contours';

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

type BoardFeature =
  | 'straight-outline'
  | 'analytic-profile'
  | 'embedded-devices'
  | 'physical-padstacks'
  | 'applied-circuit'
  | 'routed-copper'
  | 'mechanical-holes'
  | 'copper-zones'
  | 'check-waivers'
  | 'fabrication-settings'
  | 'placement-areas'
  | 'routing-regions'
  | 'wire-jumpers'
  | 'board-annotations'
  | 'release-parent';

export interface BoardReleaseParent {
  readonly id: string;
  readonly revision: number;
  readonly boardSha256: string;
}

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
  readonly outline?: readonly BoardPoint[];
  readonly profile?: BoardProfile;
  readonly tracks?: readonly BoardTrack[];
  readonly vias?: readonly BoardVia[];
  readonly mechanicalHoles?: readonly BoardMechanicalHole[];
  readonly zones?: readonly BoardZone[];
  readonly placementAreas?: readonly PlacementArea[];
  readonly routingRegions?: readonly RoutingRegion[];
  readonly jumpers?: readonly BoardWireJumper[];
  readonly waivers?: readonly BoardWaiver[];
  readonly fabrication?: BoardFabrication;
  readonly annotations?: BoardAnnotations;
  readonly releaseParent?: BoardReleaseParent;
}

const supportedFeatures: readonly BoardFeature[] = [
  'straight-outline',
  'analytic-profile',
  'embedded-devices',
  'physical-padstacks',
  'applied-circuit',
  'routed-copper',
  'mechanical-holes',
  'copper-zones',
  'check-waivers',
  'fabrication-settings',
  'placement-areas',
  'routing-regions',
  'wire-jumpers',
  'board-annotations',
  'release-parent',
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
  return validateBoard({
    ...boardFormat,
    boardId: crypto.randomUUID(),
    revision: 0,
    title,
    requiredFeatures: ['straight-outline'],
    copperLayers: copperStack.slice(0, layerCount),
    outline,
  });
}

// Track only snapshots that this validator has checked and recursively frozen.
const validatedBoards = new WeakSet<BoardDocument>();

export function validateBoard(value: unknown): BoardDocument {
  if (!value || typeof value !== 'object')
    throw new Error('Expected a TinyCAD PCB document.');
  const board = value as BoardDocument;
  if (validatedBoards.has(board)) return board;
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
  const parent = board.releaseParent;
  if (
    (parent !== undefined) !== board.requiredFeatures.includes('release-parent') ||
    (parent !== undefined && (!parent ||
      !/^[a-f0-9]{64}$/.test(parent.id) ||
      !/^[a-f0-9]{64}$/.test(parent.boardSha256) ||
      !Number.isSafeInteger(parent.revision) || parent.revision < 0 ||
      parent.revision >= board.revision))
  )
    throw new Error('Invalid PCB manufacturing release parent.');
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
  if (board.requiredFeatures.includes('analytic-profile')) {
    if (
      !board.profile ||
      board.outline !== undefined ||
      board.requiredFeatures.includes('straight-outline')
    ) {
      throw new Error('An analytic profile is the sole board outline.');
    }
    profileRegion(board.profile);
  } else {
    if (
      board.profile !== undefined ||
      !board.requiredFeatures.includes('straight-outline')
    ) {
      throw new Error('A board needs a declared outline feature.');
    }
    validateOutline(board.outline);
  }
  validateBoardAssets(board, board.requiredFeatures);
  validateBoardRouting(board);
  validateBoardMechanical(board);
  validateBoardZones(board);
  validatePlacementAreas(board);
  validateBoardJumpers(board);
  validateBoardAnnotations(board);
  validateBoardWaivers(board);
  validateBoardFabrication(board);
  validateBoardRules(board);
  validateRoutingRegions(board);
  const snapshot = freezeJson({
    ...board,
    requiredFeatures: [...board.requiredFeatures].sort(),
  }) as BoardDocument;
  validatedBoards.add(snapshot);
  return snapshot;
}

const frozenJsonDepth = new WeakMap<object, number>();

// Only reuse objects frozen here. A subtree moved deeper must pass the depth
// check again, including its optional fields.
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
  if (typeof value !== 'object')
    throw new Error('PCB document contains a non-JSON value.');
  const knownDepth = frozenJsonDepth.get(value);
  if (knownDepth !== undefined && depth <= knownDepth) return value;

  let snapshot: object;
  if (Array.isArray(value)) {
    snapshot = Array.from(value, (item) => freezeJson(item, depth + 1));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new Error('PCB document contains a non-JSON value.');
    const record = value as Record<string, unknown>;
    const fields: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const field = freezeJson(record[key], depth + 1);
      if (key === '__proto__')
        Object.defineProperty(fields, key, { value: field, enumerable: true });
      else fields[key] = field;
    }
    snapshot = fields;
  }
  Object.freeze(snapshot);
  frozenJsonDepth.set(snapshot, depth);
  return snapshot;
}

export type BoardOperation =
  | { readonly type: 'rename'; readonly title: string }
  | { readonly type: 'setCopperLayers'; readonly count: 1 | 2 }
  | { readonly type: 'addMechanicalHole'; readonly hole: BoardMechanicalHole }
  | { readonly type: 'removeMechanicalHole'; readonly id: string }
  | { readonly type: 'setRules'; readonly rules: RouteRules }
  | { readonly type: 'setNetClass'; readonly netClass: BoardNetClass }
  | { readonly type: 'removeNetClass'; readonly id: string }
  | { readonly type: 'setNetRouting'; readonly id: string; readonly classId?: string; readonly rules?: NetRoutingRules }
  | { readonly type: 'setClearanceRule'; readonly rule: CopperClearanceRule }
  | { readonly type: 'removeClearanceRule'; readonly id: string }
  | { readonly type: 'setFabrication'; readonly fabrication: BoardFabrication }
  | { readonly type: 'addWaiver'; readonly waiver: BoardWaiver }
  | { readonly type: 'removeWaiver'; readonly id: string }
  | { readonly type: 'setZone'; readonly zone: BoardZone }
  | { readonly type: 'removeZone'; readonly id: string }
  | { readonly type: 'setPlacementArea'; readonly area: PlacementArea }
  | { readonly type: 'removePlacementArea'; readonly id: string }
  | { readonly type: 'setRoutingRegion'; readonly region: RoutingRegion }
  | { readonly type: 'removeRoutingRegion'; readonly id: string }
  | { readonly type: 'setAnnotations'; readonly annotations?: BoardAnnotations }
  | { readonly type: 'setWireJumper'; readonly jumper: BoardWireJumper }
  | { readonly type: 'removeWireJumper'; readonly id: string }
  | {
      readonly type: 'replaceOutline';
      readonly outline: readonly BoardPoint[];
    }
  | { readonly type: 'replaceProfile'; readonly profile: BoardProfile };

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
    this.current = validateBoard(board);
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
        case 'addMechanicalHole':
          candidate = {
            ...candidate,
            requiredFeatures: candidate.mechanicalHoles
              ? candidate.requiredFeatures
              : [...candidate.requiredFeatures, 'mechanical-holes'],
            mechanicalHoles: [
              ...(candidate.mechanicalHoles ?? []),
              operation.hole,
            ],
          };
          break;
        case 'removeMechanicalHole':
          if (!candidate.mechanicalHoles?.some(({ id }) => id === operation.id))
            throw new Error('The hole to remove is no longer on the board.');
          candidate = {
            ...candidate,
            mechanicalHoles: (candidate.mechanicalHoles ?? []).filter(
              ({ id }) => id !== operation.id,
            ),
          };
          break;
        case 'setRules':
          candidate = { ...candidate, rules: operation.rules };
          break;
        case 'setNetClass': {
          const classes = candidate.netClasses ?? [];
          const { netClass } = operation;
          candidate = {
            ...candidate,
            netClasses: classes.some(({ id }) => id === netClass.id)
              ? classes.map((entry) => entry.id === netClass.id ? netClass : entry)
              : [...classes, netClass],
          };
          break;
        }
        case 'removeNetClass': {
          if (!candidate.netClasses?.some(({ id }) => id === operation.id))
            throw new Error('The net class no longer exists.');
          candidate = {
            ...candidate,
            netClasses: candidate.netClasses.filter(({ id }) => id !== operation.id),
            ...(candidate.clearanceRules && {
              clearanceRules: candidate.clearanceRules.filter(
                ({ firstClass, secondClass }) => firstClass !== operation.id && secondClass !== operation.id,
              ),
            }),
            ...(candidate.routingRegions && {
              routingRegions: candidate.routingRegions.filter(({ classId }) => classId !== operation.id),
            }),
            nets: candidate.nets?.map((net) => {
              const { classId, ...rest } = net;
              return classId === operation.id ? rest : net;
            }),
          };
          break;
        }
        case 'setNetRouting':
          if (!candidate.nets?.some(({ id }) => id === operation.id))
            throw new Error('The PCB net no longer exists.');
          candidate = { ...candidate, nets: candidate.nets.map((net) => {
            if (net.id !== operation.id) return net;
            const { classId, routingRules, ...rest } = net;
            return {
              ...rest,
              ...(operation.classId ? { classId: operation.classId } : {}),
              ...(operation.rules && Object.keys(operation.rules).length ? { routingRules: operation.rules } : {}),
            };
          }) };
          break;
        case 'setClearanceRule': {
          const rules = candidate.clearanceRules ?? [];
          candidate = {
            ...candidate,
            clearanceRules: rules.some(({ id }) => id === operation.rule.id)
              ? rules.map((entry) => entry.id === operation.rule.id ? operation.rule : entry)
              : [...rules, operation.rule],
          };
          break;
        }
        case 'removeClearanceRule':
          if (!candidate.clearanceRules?.some(({ id }) => id === operation.id))
            throw new Error('The copper clearance rule no longer exists.');
          candidate = {
            ...candidate,
            clearanceRules: candidate.clearanceRules.filter(({ id }) => id !== operation.id),
          };
          break;
        case 'setFabrication':
          candidate = {
            ...candidate,
            requiredFeatures: candidate.fabrication
              ? candidate.requiredFeatures
              : [...candidate.requiredFeatures, 'fabrication-settings'],
            fabrication: operation.fabrication,
          };
          break;
        case 'setRoutingRegion': {
          const regions = candidate.routingRegions ?? [];
          const { region } = operation;
          candidate = {
            ...candidate,
            requiredFeatures: candidate.routingRegions ? candidate.requiredFeatures
              : [...candidate.requiredFeatures, 'routing-regions'],
            routingRegions: regions.some(({ id }) => id === region.id)
              ? regions.map((entry) => entry.id === region.id ? region : entry)
              : [...regions, region],
          };
          break;
        }
        case 'removeRoutingRegion': {
          if (!candidate.routingRegions?.some(({ id }) => id === operation.id))
            throw new Error('The routing region no longer exists.');
          const { routingRegions, ...rest } = candidate;
          const remaining = routingRegions.filter(({ id }) => id !== operation.id);
          candidate = remaining.length ? { ...candidate, routingRegions: remaining } : {
            ...rest, requiredFeatures: candidate.requiredFeatures.filter((feature) => feature !== 'routing-regions'),
          };
          break;
        }
        case 'addWaiver':
          candidate = {
            ...candidate,
            requiredFeatures: candidate.waivers
              ? candidate.requiredFeatures
              : [...candidate.requiredFeatures, 'check-waivers'],
            waivers: [...(candidate.waivers ?? []), operation.waiver],
          };
          break;
        case 'removeWaiver':
          if (!candidate.waivers?.some(({ id }) => id === operation.id))
            throw new Error('The waiver no longer exists.');
          candidate = {
            ...candidate,
            waivers: candidate.waivers.filter(({ id }) => id !== operation.id),
          };
          break;
        case 'setZone': {
          const zones = candidate.zones ?? [];
          const updating = zones.some(({ id }) => id === operation.zone.id);
          if (!candidate.nets?.some(({ id }) => id === operation.zone.netId))
            throw new Error('Choose an assigned PCB net for the zone.');
          candidate = {
            ...candidate,
            requiredFeatures: candidate.zones
              ? candidate.requiredFeatures
              : [...candidate.requiredFeatures, 'copper-zones'],
            zones: updating
              ? zones.map((zone) => zone.id === operation.zone.id ? operation.zone : zone)
              : [...zones, operation.zone],
          };
          break;
        }
        case 'removeZone':
          if (!candidate.zones?.some(({ id }) => id === operation.id))
            throw new Error('The zone to remove is no longer on the board.');
          candidate = {
            ...candidate,
            zones: candidate.zones.filter(({ id }) => id !== operation.id),
          };
          break;
        case 'setWireJumper': {
          const jumper = operation.jumper;
          if (!candidate.nets?.some(({ id }) => id === jumper.netId))
            throw new Error('Select a current board net for the jumper.');
          const jumpers = candidate.jumpers ?? [];
          candidate = {
            ...candidate,
            requiredFeatures: candidate.jumpers ? candidate.requiredFeatures : [...candidate.requiredFeatures, 'wire-jumpers'],
            jumpers: jumpers.some(({ id }) => id === jumper.id)
              ? jumpers.map((item) => item.id === jumper.id ? jumper : item)
              : [...jumpers, jumper],
          };
          break;
        }
        case 'removeWireJumper': {
          if (!candidate.jumpers?.some(({ id }) => id === operation.id))
            throw new Error('The jumper is no longer on the board.');
          const { jumpers, ...rest } = candidate;
          const remaining = jumpers.filter(({ id }) => id !== operation.id);
          candidate = remaining.length ? { ...candidate, jumpers: remaining } :
            { ...rest, requiredFeatures: rest.requiredFeatures.filter((feature) => feature !== 'wire-jumpers') };
          break;
        }
        case 'setAnnotations': {
          const { annotations: previous, ...rest } = candidate;
          const annotations = operation.annotations;
          candidate = annotations
            ? {
                ...rest,
                annotations,
                requiredFeatures: previous
                  ? rest.requiredFeatures
                  : [...rest.requiredFeatures, 'board-annotations'],
              }
            : {
                ...rest,
                requiredFeatures: rest.requiredFeatures.filter((feature) => feature !== 'board-annotations'),
              };
          break;
        }
        case 'setPlacementArea': {
          const areas = candidate.placementAreas ?? [];
          const area = operation.area;
          const updating = areas.some(({ id }) => id === area.id);
          candidate = {
            ...candidate,
            requiredFeatures: candidate.placementAreas
              ? candidate.requiredFeatures
              : [...candidate.requiredFeatures, 'placement-areas'],
            placementAreas: updating
              ? areas.map((current) => current.id === area.id ? area : current)
              : [...areas, area],
          };
          break;
        }
        case 'removePlacementArea': {
          if (!candidate.placementAreas?.some(({ id }) => id === operation.id))
            throw new Error('The placement area is no longer on the board.');
          const { placementAreas, ...rest } = candidate;
          const remaining = placementAreas.filter(({ id }) => id !== operation.id);
          candidate = remaining.length
            ? { ...candidate, placementAreas: remaining }
            : { ...rest, requiredFeatures: rest.requiredFeatures.filter((feature) => feature !== 'placement-areas') };
          break;
        }
        case 'setCopperLayers':
          if (operation.count !== 1 && operation.count !== 2)
            throw new Error('Choose one or two copper layers.');
          if (
            operation.count === 1 &&
            candidate.footprints?.some(({ side }) => side === 'bottom')
          )
            throw new Error(
              'Move bottom-side components before removing the bottom copper layer.',
            );
          candidate = {
            ...candidate,
            copperLayers: copperStack.slice(0, operation.count),
          };
          break;
        case 'rename':
          if (typeof operation.title !== 'string' || !operation.title.trim())
            throw new Error('Enter a board title.');
          candidate = { ...candidate, title: operation.title };
          break;
        case 'replaceOutline': {
          const { profile, ...board } = candidate;
          const features = candidate.requiredFeatures.filter(
            (feature) =>
              feature !== 'analytic-profile' && feature !== 'straight-outline',
          );
          validateOutline(operation.outline);
          candidate = {
            ...board,
            outline: operation.outline,
            requiredFeatures: [...features, 'straight-outline'],
          };
          break;
        }
        case 'replaceProfile': {
          const { outline, ...board } = candidate;
          const features = candidate.requiredFeatures.filter(
            (feature) =>
              feature !== 'analytic-profile' && feature !== 'straight-outline',
          );
          profileRegion(operation.profile);
          candidate = {
            ...board,
            profile: operation.profile,
            requiredFeatures: [...features, 'analytic-profile'],
          };
          break;
        }
        default:
          throw new Error('Unsupported board operation.');
      }
    }
    return this.commit(candidate);
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  commit(candidate: BoardDocument): BoardDocument {
    const next = validateBoard({
      ...candidate,
      revision: this.current.revision + 1,
    });
    if (next.boardId !== this.current.boardId)
      throw new Error('Cannot edit a different PCB document.');
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
    const next = validateBoard({
      ...previous,
      revision: this.current.revision + 1,
    });
    from.pop();
    to.push(this.current);
    this.current = next;
    return next;
  }
}
