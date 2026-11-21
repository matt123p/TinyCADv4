import { digest } from '../util/sha256';

/** The readable reference path can change without changing the physical identity. */
export async function stableHierarchyId(
  namespace: string,
  ...ids: string[]
): Promise<string> {
  const hex = await digest(
    new TextEncoder().encode(JSON.stringify([namespace, ...ids])),
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(
    13,
    16,
  )}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
