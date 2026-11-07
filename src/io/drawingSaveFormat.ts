import { dsnDrawing } from '../model/dsnDrawing';
import { getResult, resultBytes } from '../simulation/resultStore';

export const LARGE_RESULT_BYTES = 1024 * 1024;

export function drawingSaveFormat(drawing: dsnDrawing): 'xml' | 'zip-v1' {
  if (drawing.saveFormat && drawing.saveFormat !== 'auto')
    return drawing.saveFormat;
  let bytes = 0;
  for (const sheet of drawing.sheets) {
    if (!sheet.simulation?.retainResults) continue;
    for (const run of sheet.simulation.runs) {
      const data = run.dataState === 'available' && getResult(run.id);
      if (data)
        bytes += resultBytes(data) + new TextEncoder().encode(data.log).length;
      if (bytes >= LARGE_RESULT_BYTES) return 'zip-v1';
    }
  }
  return 'xml';
}
