import { isEntityId } from '../model/schematicIdentity';

export interface SchematicTerminal {
  readonly unitId: string;
  readonly pinId: string;
}

export interface CircuitNetDraft {
  readonly names: readonly string[];
  readonly terminals: readonly SchematicTerminal[];
}

export interface CircuitNet extends CircuitNetDraft {
  readonly id: string;
}

export interface CircuitNetReview {
  /** The existing UUID is available only when the full member set is unchanged. */
  readonly retainedId?: string;
  readonly affectedPreviousIds: readonly string[];
  readonly draft: CircuitNetDraft;
}

function memberships(nets: readonly CircuitNetDraft[]): string[][] {
  const used = new Set<string>();
  return nets.map((net) => {
    if (!net.terminals.length)
      throw new Error('An intended PCB net needs at least one terminal.');
    return net.terminals
      .map(({ unitId, pinId }) => {
        if (!isEntityId(unitId) || !isEntityId(pinId))
          throw new Error('Invalid schematic terminal UUID.');
        const terminal = `${unitId.toLowerCase()}:${pinId.toLowerCase()}`;
        if (used.has(terminal))
          throw new Error(
            'A schematic terminal belongs to more than one net or occurs twice.',
          );
        used.add(terminal);
        return terminal;
      })
      .sort();
  });
}

/** Match nets by terminal membership. New, split and merged nets remain proposals until committed. */
export function reviewCircuitNets(
  previous: readonly CircuitNet[],
  drafts: readonly CircuitNetDraft[],
): { nets: CircuitNetReview[]; removedIds: string[] } {
  const previousMemberships = memberships(previous);
  const idByMembership = new Map<string, string>();
  const priorTerminalOwner = new Map<string, string>();
  const previousIds = new Set<string>();
  previous.forEach(({ id }, index) => {
    if (!isEntityId(id) || previousIds.has(id.toLowerCase()))
      throw new Error('Invalid or duplicate circuit net UUID.');
    previousIds.add(id.toLowerCase());
    const members = previousMemberships[index];
    idByMembership.set(members.join(','), id);
    for (const member of members) priorTerminalOwner.set(member, id);
  });
  const retained = new Set<string>();
  const nets = memberships(drafts).map((members, index) => {
    const retainedId = idByMembership.get(members.join(','));
    if (retainedId) retained.add(retainedId);
    const affectedPreviousIds = retainedId
      ? []
      : Array.from(
          new Set(
            members.flatMap((member) => {
              const owner = priorTerminalOwner.get(member);
              return owner ? [owner] : [];
            }),
          ),
        ).sort();
    return { retainedId, affectedPreviousIds, draft: drafts[index] };
  });
  return {
    nets,
    removedIds: previous
      .map(({ id }) => id)
      .filter((id) => !retained.has(id))
      .sort(),
  };
}
