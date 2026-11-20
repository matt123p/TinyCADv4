import { isEntityId } from './schematicIdentity';

export interface SchematicInstanceReference {
  readonly instancePath: readonly string[];
  readonly componentId: string;
  readonly reference: string;
}

export function instanceReferenceKey(
  reference: Pick<SchematicInstanceReference, 'instancePath' | 'componentId'>,
): string {
  return [...reference.instancePath, reference.componentId].join('/');
}

export function isReferenceDesignator(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !!value &&
    value.length <= 128 &&
    !/[?\s\p{Cc}]/u.test(value)
  );
}

export function validateInstanceReferences(
  entries: readonly SchematicInstanceReference[],
): void {
  const keys = new Set<string>();
  if (!Array.isArray(entries) || entries.length > 10000)
    throw new Error('Invalid schematic instance reference collection.');
  for (const entry of entries) {
    if (
      !Array.isArray(entry?.instancePath) ||
      !entry.instancePath.length ||
      entry.instancePath.length > 64 ||
      !entry.instancePath.every(isEntityId) ||
      !isEntityId(entry.componentId) ||
      !isReferenceDesignator(entry.reference)
    )
      throw new Error('Invalid schematic instance reference.');
    const key = instanceReferenceKey(entry).toLowerCase();
    if (keys.has(key))
      throw new Error('Duplicate schematic instance reference.');
    keys.add(key);
  }
}
