import type { BoardDocument, CopperLayer } from './board';
import type { BoardFootprint } from './boardAssets';
import { boardArtwork } from './boardArtwork';
import { boardCopperGeometry } from './boardCopperGeometry';
import { viaIsTented } from './boardRouting';
import { boardZoneGeometry } from './boardZoneGeometry';
import { capsulePolygon, profileRegion } from './contours';
import type { PolygonRegion } from './contours';
import type { FootprintModel } from './footprintDetails';
import type { PolygonKernel } from './polygonKernel';
import type { StepMesh } from './stepMesh';

export interface InspectionPart {
  readonly placement: BoardFootprint;
  readonly label: string;
  readonly models: readonly FootprintModel[];
  readonly envelope: {
    widthMm: number;
    lengthMm: number;
    centreXmm: number;
    centreYmm: number;
  };
}

export interface BoardInspection {
  readonly substrate: readonly PolygonRegion[];
  readonly thicknessMm: number;
  readonly parts: readonly InspectionPart[];
  readonly faces: readonly {
    side: CopperLayer['id'];
    copper: readonly PolygonRegion[];
    mask: readonly PolygonRegion[];
    silk: readonly PolygonRegion[];
  }[];
  readonly models: Record<string, readonly StepMesh[]>;
  readonly issues: Record<string, string>;
}

export function boardInspectionSurface(
  board: BoardDocument,
  kernel: PolygonKernel,
) {
  const profile = board.profile
    ? profileRegion(board.profile)
    : { outer: board.outline, holes: [] };
  const geometry = boardCopperGeometry(board);
  const zones = boardZoneGeometry(board, kernel, geometry);
  const voids = geometry.drills.map(
    ({ start, end, widthNm }): PolygonRegion => ({
      outer: capsulePolygon(start, end, widthNm),
      holes: [],
    }),
  );
  const substrate = kernel.boolean('difference', [profile], voids);
  const features = [...geometry.features, ...zones.fills];
  const artwork = boardArtwork(board, kernel);
  const faces = (['top', 'bottom'] as const).map((side) => {
    const openings = geometry.apertures
      .filter((aperture) => aperture.kind === 'mask' && aperture.side === side)
      .map(({ polygon }): PolygonRegion => ({ outer: polygon, holes: [] }));
    const tentedViaIds = new Set((board.vias ?? [])
      .filter((via) => viaIsTented(via, side)).map(({ id }) => id));
    // A mask tent spans the via opening while leaving the substrate drilled.
    const mask = openings.length || board.vias?.length
      ? kernel.boolean('difference', [profile], [
          ...voids.filter((_, index) => !tentedViaIds.has(geometry.drills[index].id)),
          ...openings,
        ])
      : [];
    return {
      side,
      copper: kernel.boolean(
        'intersection',
        substrate,
        kernel.boolean(
          'union',
          features
            .filter(({ layerId }) => layerId === side)
            .map(({ region }) => region),
          [],
        ),
      ),
      mask,
      silk: artwork.silk
        .filter((art) => art.side === side)
        .flatMap(({ regions }) => regions),
    };
  });
  const components = new Map(board.components?.map((item) => [item.id, item]));
  const definitions = new Map(
    board.footprintDefinitions?.map((item) => [item.id, item]),
  );
  const devices = new Map(
    board.deviceDefinitions?.map((item) => [item.id, item]),
  );
  const parts = (board.footprints ?? []).map((placement): InspectionPart => {
    const definition = definitions.get(
      devices.get(placement.deviceId)?.footprintId,
    );
    const label =
      components.get(placement.componentId)?.reference ?? definition.name;
    const xs = definition.pads.map(({ positionNm }) => positionNm.x / 1e6);
    const ys = definition.pads.map(({ positionNm }) => positionNm.y / 1e6);
    const [left, right] = xs.length
      ? [Math.min(...xs), Math.max(...xs)]
      : [-1, 1];
    const [bottom, top] = ys.length
      ? [Math.min(...ys), Math.max(...ys)]
      : [-1, 1];
    return {
      placement,
      label,
      models: definition.models ?? [],
      envelope: {
        widthMm: Math.max(right - left + 1, 1.2),
        lengthMm: Math.max(top - bottom + 1, 1.2),
        centreXmm: (left + right) / 2,
        centreYmm: (bottom + top) / 2,
      },
    };
  });
  return {
    substrate,
    thicknessMm: (board.fabrication?.thicknessNm ?? 1_600_000) / 1e6,
    faces,
    parts,
  };
}
