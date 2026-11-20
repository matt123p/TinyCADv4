export function isEntityId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
  );
}

export function newSchematicEntityId(): string {
  return crypto.randomUUID();
}

export function readSchematicEntityId(value: string | null, allocate: boolean): string | undefined {
  if (value === null || value === '') {
    return allocate && globalThis.crypto?.randomUUID ? newSchematicEntityId() : undefined;
  }
  if (!isEntityId(value)) throw new Error('Invalid schematic entity UUID.');
  return value.toLowerCase();
}
