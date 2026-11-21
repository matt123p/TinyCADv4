import type { BoardDocument } from './board';
import { mountingKeepouts } from './boardMechanical';
import type { BoardArtworkRegion } from './boardArtwork';
import type { BoardIssue } from './boardChecks';
import type { PolygonRegion } from './contours';
import { regionsTouch } from './copper';
import { pointInPolygon } from './geometry';
import type { PolygonKernel } from './polygonKernel';

export function checkPlacementAreas(
  board: BoardDocument,
  courtyards: readonly BoardArtworkRegion[],
  kernel: PolygonKernel,
) {
  const issues: BoardIssue[] = [];
  let originsChecked = 0;
  const areasToCheck = [
    ...(board.placementAreas ?? []),
    ...mountingKeepouts(board).map(({ id, body, side }) => ({
      id, name: 'mounting screw', kind: 'keep-out' as const, side, outline: body,
    })),
  ];
  if (!areasToCheck.length) return { issues, originsChecked };
  const references = new Map(
    board.components?.map(({ id, reference }) => [id, reference]),
  );
  for (const side of ['top', 'bottom'] as const) {
    const areas = areasToCheck
      .filter((area) => area.side === side || area.side === 'both')
      .map((area) => {
        const region: PolygonRegion = { outer: area.outline, holes: [] };
        return { ...area, region };
      });
    if (!areas.length) continue;
    const keepIns = areas.filter(({ kind }) => kind === 'keep-in');
    const keepOuts = areas.filter(({ kind }) => kind === 'keep-out');
    const allowed = kernel.boolean(
      'union',
      keepIns.map(({ region }) => region),
      [],
    );
    const footprints = new Map(
      courtyards
        .filter((item) => item.side === side)
        .map((item) => [item.componentId, item.regions]),
    );
    for (const { componentId, positionNm, side: mounted } of board.footprints ??
      []) {
      const shapes = footprints.get(componentId);
      if (!shapes && mounted !== side) continue;
      if (!shapes) originsChecked++;
      const reference = references.get(componentId) ?? componentId;
      const feature = shapes ? 'courtyard' : 'origin';
      if (
        keepIns.length &&
        (shapes
          ? shapes.some(
              (shape) => kernel.boolean('difference', [shape], allowed).length,
            )
          : keepIns.every(
              ({ outline }) =>
                pointInPolygon(positionNm, outline) === 'outside',
            ))
      ) {
        issues.push({
          code: 'placement-keep-in',
          objects: [componentId, ...keepIns.map(({ id }) => id)],
          location: positionNm,
          message:
            reference +
            ' ' +
            feature +
            ' extends outside the ' +
            side +
            ' placement keep-in areas.',
        });
      }
      for (const area of keepOuts) {
        const violation = shapes
          ? shapes.some((shape) => regionsTouch(shape, area.region))
          : pointInPolygon(positionNm, area.outline) !== 'outside';
        if (violation)
          issues.push({
            code: 'placement-keep-out',
            objects: [componentId, area.id],
            location: positionNm,
            message:
              reference +
              ' ' +
              feature +
              ' intersects ' +
              side +
              ' keep-out “' +
              area.name +
              '”.',
          });
      }
    }
  }
  return { issues, originsChecked };
}
