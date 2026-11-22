import type { BoardDocument } from './board';
import { fabricationProfileFor } from './fabricationProfiles';
import type { RouteRules } from './routing';
import { BOARD_COORDINATE_LIMIT_NM } from './geometry';
import { isEntityId } from '../model/schematicIdentity';
import type { CopperFeature } from './copper';

export type NetRoutingRules = Partial<RouteRules>;

export interface BoardNetClass {
  readonly id: string;
  readonly name: string;
  readonly rules: NetRoutingRules;
}

export const clearanceKinds = ['pad', 'track', 'via', 'zone'] as const;
type ClearanceKind = (typeof clearanceKinds)[number];
type ClearanceObject = Pick<CopperFeature, 'netId' | 'kind'>;

export interface CopperClearanceRule {
  readonly id: string;
  readonly name: string;
  readonly firstClass?: string;
  readonly firstKind?: ClearanceKind;
  readonly secondClass?: string;
  readonly secondKind?: ClearanceKind;
  readonly clearanceNm: number;
}

function matches(
  kind: ClearanceKind, classId: string, object: ClearanceObject, objectClass: string,
) {
  return (!kind || kind === object.kind) && (!classId || classId === objectClass);
}

export const starterRoutingRules: RouteRules = {
  minWidthNm: 180_000,
  clearanceNm: 200_000,
  edgeClearanceNm: 250_000,
  minViaAnnulusNm: 130_000,
};

export function resolveBoardRules(board: BoardDocument): RouteRules {
  const configured = board.rules ?? starterRoutingRules;
  const minimum = fabricationProfileFor(board)?.limits;
  if (!minimum) return configured;
  return {
    ...configured,
    minWidthNm: Math.max(configured.minWidthNm, minimum.minWidthNm),
    clearanceNm: Math.max(configured.clearanceNm, minimum.clearanceNm),
    edgeClearanceNm: Math.max(
      configured.edgeClearanceNm,
      minimum.edgeClearanceNm,
    ),
    minViaAnnulusNm: Math.max(
      configured.minViaAnnulusNm,
      minimum.minViaAnnulusNm,
    ),
  };
}

function checkBounds(rules: RouteRules, scope: string) {
  if (rules.maxWidthNm !== undefined && rules.maxWidthNm < rules.minWidthNm)
    throw new Error('Maximum track width is below the effective minimum track width.' + scope);
}

function validateDimensions(rules: NetRoutingRules, requireBase = false) {
  const offsets = ['clearanceNm', 'edgeClearanceNm', 'minViaAnnulusNm'] as const;
  const widths = ['minWidthNm', 'preferredWidthNm', 'maxWidthNm'] as const;
  const fields: readonly string[] = [...offsets, ...widths];
  const valid = (value: number, minimum: number) =>
    Number.isSafeInteger(value) && value >= minimum && value <= BOARD_COORDINATE_LIMIT_NM;
  if (!rules || typeof rules !== 'object' || Array.isArray(rules) ||
    Object.keys(rules).some((key) => !fields.includes(key)) ||
    (requireBase && [rules.minWidthNm, ...offsets.map((key) => rules[key])].some((value) => value === undefined)) ||
    widths.some((key) => rules[key] !== undefined && !valid(rules[key], 1)) ||
    offsets.some((key) => rules[key] !== undefined && !valid(rules[key], 0)))
    throw new Error('Invalid board routing rules.');
}

function restrict(base: RouteRules, extra: NetRoutingRules): RouteRules {
  if (!extra) return base;
  const maxWidthNm = Math.min(base.maxWidthNm ?? Infinity, extra.maxWidthNm ?? Infinity);
  const preferredWidthNm = extra.preferredWidthNm ?? base.preferredWidthNm;
  return {
    minWidthNm: Math.max(base.minWidthNm, extra.minWidthNm ?? 0),
    clearanceNm: Math.max(base.clearanceNm, extra.clearanceNm ?? 0),
    edgeClearanceNm: Math.max(base.edgeClearanceNm, extra.edgeClearanceNm ?? 0),
    minViaAnnulusNm: Math.max(base.minViaAnnulusNm, extra.minViaAnnulusNm ?? 0),
    ...(preferredWidthNm === undefined ? {} : { preferredWidthNm }),
    ...(Number.isFinite(maxWidthNm) ? { maxWidthNm } : {}),
  };
}

export function boardRuleResolver(board: BoardDocument) {
  const base = resolveBoardRules(board);
  const classes = new Map(board.netClasses?.map(({ id, rules }) => [id, restrict(base, rules)]));
  const byNet = new Map(board.nets?.map(({ id, classId, routingRules }) =>
    [id, restrict(classes.get(classId) ?? base, routingRules)]));
  const net = (netId?: string) => byNet.get(netId) ?? base;
  const clearance = (first?: string, second?: string) =>
    Math.max(net(first).clearanceNm, net(second).clearanceNm);
  const classByNet = new Map(board.nets?.map(({ id, classId }) => [id, classId]));
  const pairRules = board.clearanceRules ?? [];
  const cache = new Map<string, readonly CopperClearanceRule[]>();
  function matchingClearanceRules(first: ClearanceObject, second: ClearanceObject) {
    if (!pairRules.length) return pairRules;
    const firstClass = classByNet.get(first.netId) ?? 'default';
    const secondClass = classByNet.get(second.netId) ?? 'default';
    const a = firstClass + ':' + first.kind;
    const b = secondClass + ':' + second.kind;
    const key = a <= b ? a + '|' + b : b + '|' + a;
    let result = cache.get(key);
    if (!result) {
      result = pairRules.filter((rule) => (
        matches(rule.firstKind, rule.firstClass, first, firstClass) &&
        matches(rule.secondKind, rule.secondClass, second, secondClass)
      ) || (
        matches(rule.secondKind, rule.secondClass, first, firstClass) &&
        matches(rule.firstKind, rule.firstClass, second, secondClass)
      ));
      cache.set(key, result);
    }
    return result;
  }
  function copperClearance(first: ClearanceObject, second: ClearanceObject) {
    return matchingClearanceRules(first, second).reduce(
      (required, rule) => Math.max(required, rule.clearanceNm),
      clearance(first.netId, second.netId),
    );
  }
  return {
    net,
    clearance,
    copperClearance,
    matchingClearanceRules,
  };
}

export function validateBoardRules(board: BoardDocument) {
  if (board.rules !== undefined) validateDimensions(board.rules, true);
  const base = resolveBoardRules(board);
  checkBounds(base, '');
  if (board.netClasses !== undefined && !Array.isArray(board.netClasses))
    throw new Error('Invalid PCB net classes.');
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const item of board.netClasses ?? []) {
    const name = typeof item?.name === 'string' ? item.name.trim().toLowerCase() : '';
    if (!isEntityId(item?.id) || ids.has(item.id.toLowerCase()) || !name || names.has(name))
      throw new Error('PCB net classes need distinct IDs and names.');
    ids.add(item.id.toLowerCase());
    names.add(name);
    validateDimensions(item.rules);
    checkBounds(restrict(base, item.rules), ' Net class ' + item.name + '.');
  }
  const classIds = new Set(board.netClasses?.map(({ id }) => id));
  validateClearanceRules(board.clearanceRules, classIds);
  for (const net of board.nets ?? []) {
    if (net.classId !== undefined && !classIds.has(net.classId))
      throw new Error('A PCB net refers to an unknown net class.');
    if (net.routingRules !== undefined) validateDimensions(net.routingRules);
  }
  const resolver = boardRuleResolver(board);
  for (const { id, name } of board.nets ?? []) checkBounds(resolver.net(id), ' Net ' + name + '.');
}

function validateClearanceRules(rules: readonly CopperClearanceRule[] | undefined, classIds: ReadonlySet<string>) {
  if (rules === undefined) return;
  if (!Array.isArray(rules)) throw new Error('Invalid PCB copper clearance rules.');
  const ids = new Set<string>();
  const pairs = new Set<string>();
  for (const rule of rules) {
    if (!isEntityId(rule?.id) || ids.has(rule.id.toLowerCase()) ||
      typeof rule.name !== 'string' || !rule.name.trim() ||
      !Number.isSafeInteger(rule.clearanceNm) || rule.clearanceNm < 0 ||
      rule.clearanceNm > BOARD_COORDINATE_LIMIT_NM)
      throw new Error('Invalid PCB copper clearance rule.');
    const { firstClass, secondClass, firstKind, secondKind } = rule;
    if ([firstClass, secondClass].some((id) => id !== undefined && id !== 'default' && !classIds.has(id)))
      throw new Error('A PCB copper clearance rule refers to an unknown net class.');
    if ([firstKind, secondKind].some((kind) => kind !== undefined && !clearanceKinds.includes(kind)))
      throw new Error('A PCB copper clearance rule refers to an unknown copper object type.');
    if ([firstClass, secondClass, firstKind, secondKind].every((value) => value === undefined))
      throw new Error('Choose a net class or copper object type for the clearance rule.');
    const pair = [
      (firstClass ?? '') + ':' + (firstKind ?? ''),
      (secondClass ?? '') + ':' + (secondKind ?? ''),
    ].sort().join('|');
    if (pairs.has(pair)) throw new Error('A PCB copper clearance rule already covers this pair.');
    pairs.add(pair);
    ids.add(rule.id.toLowerCase());
  }
}

export function routeViaPresets(board: BoardDocument, rules = resolveBoardRules(board)) {
  const { minViaAnnulusNm } = rules;
  const limits = fabricationProfileFor(board)?.limits;
  const preset = (diameter: number, drill: number) => {
    const viaDrillNm = Math.max(drill, limits?.minViaDrillNm ?? 0);
    return {
      viaDrillNm,
      viaDiameterNm: Math.max(diameter, viaDrillNm + 2 * minViaAnnulusNm),
    };
  };
  return {
    compact: preset(650_000, 300_000),
    preferred: preset(800_000, 400_000),
  };
}

export function preferredTrackWidth(rules: RouteRules, fallbackNm: number) {
  return Math.min(
    rules.maxWidthNm ?? Infinity,
    Math.max(rules.preferredWidthNm ?? fallbackNm, rules.minWidthNm),
  );
}
