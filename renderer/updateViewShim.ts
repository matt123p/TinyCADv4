import { isFilled } from '../src/model/dsnTypeGuards';
import { dsnSheet } from '../src/model/dsnDrawing';

export class updateView {
  rebuildHatches(sheet: dsnSheet): dsnSheet {
    // Placed symbols draw their embedded outline primitives too. Their hatch
    // definitions must be available in the outer SVG, just like sheet artwork.
    const items = sheet.items.flatMap(item => item.NodeName === 'symbol'
      ? [item, ...item._symbol.outlines.flatMap(outline => outline.items)]
      : [item]);
    let hatches = items
      .map((item) => (isFilled(item) ? item : null))
      .filter(
        (item): item is NonNullable<typeof item> =>
          !!item && typeof item.hatch === 'number' && item.hatch >= 0,
      )
      .map((item) => ({
        id: `hatch${item.hatch}${item.fill_colour}`,
        index: item.hatch,
        color: item.fill_colour,
      }));

    hatches = hatches.filter(
      (hatch, index) => index === hatches.findIndex((item) => item.id === hatch.id),
    );

    return {
      ...sheet,
      hatches,
    };
  }
}
