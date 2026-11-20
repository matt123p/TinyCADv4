/** A derived result applies only to the precise board snapshot and engine that requested it. */
export interface GeometryRevision {
  readonly boardId: string;
  readonly revision: number;
  readonly inputDigest: string;
  readonly engine: string;
}

export function isCurrentGeometryRevision(
  result: GeometryRevision,
  current: GeometryRevision,
): boolean {
  return (
    result.boardId === current.boardId &&
    result.revision === current.revision &&
    result.inputDigest === current.inputDigest &&
    result.engine === current.engine
  );
}
