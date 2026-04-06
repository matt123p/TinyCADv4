import { isFilled } from '../src/model/dsnTypeGuards';
import { dsnSheet } from '../src/model/dsnDrawing';

export class updateView {
  rebuildHatches(sheet: dsnSheet): dsnSheet {
    let hatches = sheet.items
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
