import { dsnDrawing } from '../model/dsnDrawing';
import { DocItemTypes } from '../model/dsnItem';

export function hasSimulation(drawing: dsnDrawing): boolean {
  return drawing.sheets.some(
    (sheet) =>
      sheet.kind === 'simulation' ||
      !!sheet.simulation ||
      sheet.items.some((item) => {
        if (item.NodeName === DocItemTypes.Power)
          return item.which === 4 && item.text.trim() === '0';
        if (item.NodeName !== DocItemTypes.Symbol) return false;
        return (
          item._symbol?.uid?.startsWith('tinycad-spice-') ||
          item.text.some(
            (field) =>
              field.description === '$$SPICE_CONTROL' ||
              (field.description.startsWith('$$SPICE') &&
                !field.description.endsWith('_PRIORITY') &&
                !!field.value?.trim()),
          )
        );
      }),
  );
}

export function drawingSaveFormat(drawing: dsnDrawing): 'xml' | 'zip-v1' {
  if (hasSimulation(drawing)) return 'zip-v1';
  if (drawing.saveFormat && drawing.saveFormat !== 'auto')
    return drawing.saveFormat;
  return 'xml';
}
