import type { PolygonKernel } from './polygonKernel';
import type { BoardDocument } from './board';
import { readBoardModelAsset } from './boardModelAssets';
import { boardInspectionSurface } from './boardInspection';
import type { BoardInspection } from './boardInspection';
import { validateStepMeshes } from './stepMesh';

export async function inspectBoard(
  data: BoardDocument,
  kernel: PolygonKernel,
): Promise<BoardInspection> {
  const surface = boardInspectionSurface(data, kernel);
  const models: BoardInspection['models'] = {};
  const issues: BoardInspection['issues'] = {};
  const assets = new Map(data.modelAssets?.map((asset) => [asset.id, asset]));
  let remaining = 12_000_000;
  let engine: Awaited<
    ReturnType<typeof import('./stepEngine')['loadStepEngine']>
  >;
  const ids = new Set(
    surface.parts.flatMap(({ models }) =>
      models.map(({ assetId }) => assetId).filter(Boolean),
    ),
  );
  for (const id of ids) {
    try {
      const asset = assets.get(id);
      if (!asset) throw new Error('STEP asset is missing.');
      if (remaining <= 0)
        throw new Error('The viewer reached its STEP mesh budget.');
      if (!engine)
        engine = await (await import('./stepEngine')).loadStepEngine();
      const result = engine.ReadStepFile(await readBoardModelAsset(asset), {
        linearUnit: 'millimeter',
        linearDeflectionType: 'absolute_value',
        linearDeflection: 0.025,
        angularDeflection: 0.35,
      });
      const meshes = validateStepMeshes(result, remaining);
      for (const { positions, normals, indices } of meshes)
        remaining -= positions.length + (normals?.length ?? 0) + indices.length;
      models[id] = meshes;
    } catch (error) {
      issues[id] = error instanceof Error ? error.message : String(error);
    }
  }
  return { ...surface, models, issues };
}
