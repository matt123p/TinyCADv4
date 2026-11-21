export interface StepMesh {
  readonly positions: Float32Array;
  readonly normals?: Float32Array;
  readonly indices: Uint32Array;
  readonly color?: readonly [number, number, number];
}

export interface StepResult {
  readonly success: boolean;
  readonly meshes: readonly {
    readonly attributes: {
      readonly position: { readonly array: readonly number[] };
      readonly normal?: { readonly array: readonly number[] };
    };
    readonly index: { readonly array: readonly number[] };
    readonly color?: readonly [number, number, number];
  }[];
}

export function validateStepMeshes(
  result: StepResult,
  budget: number,
): StepMesh[] {
  if (!result.success || !result.meshes?.length || result.meshes.length > 4096)
    throw new Error('STEP model has no supported triangulated solids.');
  let values = 0;
  return result.meshes.map(({ attributes, index, color }) => {
    const positions = attributes.position.array;
    const normals = attributes.normal?.array;
    const indices = index.array;
    values += positions.length + (normals?.length ?? 0) + indices.length;
    if (
      values > budget ||
      positions.length % 3 ||
      indices.length % 3 ||
      !positions.length ||
      !indices.length ||
      !positions.every(
        (value) => Number.isFinite(value) && Math.abs(value) <= 10_000,
      ) ||
      (normals &&
        (normals.length !== positions.length ||
          !normals.every(Number.isFinite))) ||
      !indices.every(
        (index) =>
          Number.isInteger(index) && index >= 0 && index < positions.length / 3,
      )
    )
      throw new Error(
        'STEP mesh exceeds geometry limits or contains invalid triangles.',
      );
    return {
      positions: Float32Array.from(positions),
      ...(normals ? { normals: Float32Array.from(normals) } : {}),
      indices: Uint32Array.from(indices),
      ...(color?.length === 3 &&
      color.every((value) => value >= 0 && value <= 1)
        ? { color }
        : {}),
    };
  });
}
