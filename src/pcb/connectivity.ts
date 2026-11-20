import { BOARD_COORDINATE_LIMIT_NM, isBoardPoint } from './geometry';
import type { BoardPoint } from './geometry';
import type { CopperLayer } from './board';

type LayerId = CopperLayer['id'];

export interface RoundCopperLand {
  readonly id: string;
  readonly layerId: LayerId;
  readonly centre: BoardPoint;
  readonly radiusNm: number;
  /** Intended net of a terminal. Copper without a terminal has no assigned intent. */
  readonly terminalNetId?: string;
}

export interface HoleConnection {
  readonly plating: 'plated' | 'non-plated';
  readonly landIds: readonly string[];
}

export interface RoundCopperReport {
  connectedSets: string[][];
  shorts: { landIds: string[]; netIds: string[] }[];
  opens: { netId: string; terminalGroups: string[][] }[];
  pointContacts: [string, string][];
}

/** G0 round-land fixture. Lands model outer conductive discs and barrels model explicit interlayer joins. */
export function analyseRoundCopper(
  input: readonly RoundCopperLand[],
  holes: readonly HoleConnection[],
): RoundCopperReport {
  if (input.length > 1_024 || holes.length > input.length / 2) {
    throw new Error(
      'Round copper fixture exceeds the supported land or hole count.',
    );
  }
  const lands = [...input].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const indices = new Map(lands.map((land, index) => [land.id, index]));
  if (
    indices.size !== lands.length ||
    lands.some(
      (land) =>
        typeof land.id !== 'string' ||
        !land.id ||
        !['top', 'bottom'].includes(land.layerId) ||
        !isBoardPoint(land.centre) ||
        (land.terminalNetId !== undefined &&
          (typeof land.terminalNetId !== 'string' || !land.terminalNetId)) ||
        !Number.isInteger(land.radiusNm) ||
        land.radiusNm <= 0 ||
        land.radiusNm > BOARD_COORDINATE_LIMIT_NM,
    )
  ) {
    throw new Error('Invalid round copper lands.');
  }

  const parent = lands.map((_, index) => index);
  const root = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const join = (a: number, b: number): void => {
    const first = root(a);
    const second = root(b);
    parent[Math.max(first, second)] = Math.min(first, second);
  };

  const pointContacts: [string, string][] = [];
  for (let i = 0; i < lands.length; i++) {
    const a = lands[i];
    for (let j = i + 1; j < lands.length; j++) {
      const b = lands[j];
      if (a.layerId !== b.layerId) continue;
      const dx = a.centre.x - b.centre.x;
      const dy = a.centre.y - b.centre.y;
      const radii = a.radiusNm + b.radiusNm;
      if (Math.abs(dx) > radii || Math.abs(dy) > radii) continue;
      const squaredDistance = BigInt(dx) * BigInt(dx) + BigInt(dy) * BigInt(dy);
      const squaredRadii = BigInt(radii) * BigInt(radii);
      if (squaredDistance > squaredRadii) continue;
      if (squaredDistance === squaredRadii) pointContacts.push([a.id, b.id]);
      join(i, j);
    }
  }

  const holeLands = new Set<string>();
  for (const hole of holes) {
    if (hole.landIds.length !== 2)
      throw new Error('Expected two land IDs for a G0 hole.');
    const [first, second] = hole.landIds.map((id) => indices.get(id));
    const a = lands[first];
    const b = lands[second];
    if (
      !['plated', 'non-plated'].includes(hole.plating) ||
      !a ||
      !b ||
      a.layerId === b.layerId ||
      a.centre.x !== b.centre.x ||
      a.centre.y !== b.centre.y ||
      holeLands.has(a.id) ||
      holeLands.has(b.id)
    ) {
      throw new Error(
        'Expected one coaxial land per layer for each hole in the G0 fixture.',
      );
    }
    holeLands.add(a.id);
    holeLands.add(b.id);
    if (hole.plating === 'plated') join(first, second);
  }

  const sets = new Map<number, RoundCopperLand[]>();
  lands.forEach((land, index) => {
    const key = root(index);
    if (!sets.has(key)) sets.set(key, []);
    sets.get(key).push(land);
  });
  const connectedSets = [...sets.values()].map((set) =>
    set.map((land) => land.id),
  );
  const shorts: RoundCopperReport['shorts'] = [];
  const nets = new Map<string, string[][]>();
  for (const set of sets.values()) {
    const terminals = new Map<string, string[]>();
    for (const land of set) {
      if (land.terminalNetId === undefined) continue;
      if (!terminals.has(land.terminalNetId))
        terminals.set(land.terminalNetId, []);
      terminals.get(land.terminalNetId).push(land.id);
    }
    if (terminals.size > 1)
      shorts.push({
        landIds: set.map((land) => land.id),
        netIds: [...terminals.keys()].sort(),
      });
    for (const [netId, group] of terminals) {
      if (!nets.has(netId)) nets.set(netId, []);
      nets.get(netId).push(group);
    }
  }
  const opens = [...nets.keys()].sort().flatMap((netId) => {
    const terminalGroups = nets.get(netId);
    return terminalGroups.length > 1 ? [{ netId, terminalGroups }] : [];
  });
  return { connectedSets, shorts, opens, pointContacts };
}
