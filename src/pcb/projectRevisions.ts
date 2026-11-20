interface EntryFingerprint {
  path: string;
  digest: string;
}

export interface RevisionInventory {
  projectId: string;
  revisionId: string;
  parentRevisionId?: string;
  title: string;
  entries: ReadonlyMap<string, EntryFingerprint>;
  settings?: EntryFingerprint;
}

export interface RevisionChange {
  kind: 'added' | 'removed' | 'changed';
  before?: string;
  after?: string;
}

export function compareProjectRevisions(
  before: RevisionInventory,
  after: RevisionInventory,
): RevisionChange[] {
  if (before.projectId !== after.projectId)
    throw new Error('Choose revisions of the same project.');
  const changes: RevisionChange[] = [];
  if (before.settings?.digest !== after.settings?.digest) {
    changes.push({
      kind: 'changed',
      before: before.settings?.path,
      after: after.settings?.path,
    });
  }
  for (const [id, entry] of before.entries) {
    const next = after.entries.get(id);
    if (!next) changes.push({ kind: 'removed', before: entry.path });
    else if (entry.path !== next.path || entry.digest !== next.digest)
      changes.push({ kind: 'changed', before: entry.path, after: next.path });
  }
  for (const [id, entry] of after.entries) {
    if (!before.entries.has(id))
      changes.push({ kind: 'added', after: entry.path });
  }
  return changes.sort((a, b) =>
    (a.after || a.before).localeCompare(b.after || b.before, 'en'),
  );
}
