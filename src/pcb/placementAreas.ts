import { validateAreaShape } from './boardAreaShape';
import type { BoardAreaShape } from './boardAreaShape';
import { MAX_CONTOUR_VERTICES as MAX_AREA_VERTICES } from './contours';
import { isEntityId } from '../model/schematicIdentity';
import type { BoardDocument } from './board';
import type { Polygon } from './contours';
import { validateOutline } from './geometry';

export interface PlacementArea {
  readonly id: string;
  readonly name: string;
  readonly kind: 'keep-in' | 'keep-out';
  readonly side: 'top' | 'bottom' | 'both';
  readonly outline: Polygon;
  readonly shape?: BoardAreaShape;
}

export function validatePlacementAreas(board: BoardDocument) {
  const areas = board.placementAreas;
  if (
    (areas !== undefined) !==
    board.requiredFeatures.includes('placement-areas')
  )
    throw new Error(
      'Placement areas must declare the placement-areas feature.',
    );
  if (areas === undefined) return;
  if (!Array.isArray(areas) || areas.length > 128)
    throw new Error('Invalid placement area collection.');
  const ids = new Set<string>();
  for (const area of areas) {
    if (
      !isEntityId(area?.id) ||
      ids.has(area.id.toLowerCase()) ||
      typeof area.name !== 'string' ||
      !area.name.trim() ||
      area.name.length > 128 ||
      !['keep-in', 'keep-out'].includes(area.kind) ||
      !['top', 'bottom', 'both'].includes(area.side)
    )
      throw new Error('Invalid placement area settings.');
    ids.add(area.id.toLowerCase());
    validateOutline(area.outline, area.shape ? MAX_AREA_VERTICES : undefined);
    validateAreaShape(area.shape, area.outline);
  }
}
