import { saveAs } from 'file-saver';
import { ResultData, SimulationRun } from './contracts';

export function download(
  name: string,
  content: string | Uint8Array,
  type: string,
): void {
  saveAs(
    new Blob(
      [typeof content === 'string' ? content : new Uint8Array(content).buffer],
      { type },
    ),
    name,
  );
}

export function csv(data: ResultData): string {
  // Always quote names; numeric cells use locale-independent decimal points.
  const quote = (text: string) => `"${text.replace(/"/g, '""')}"`;
  const columns = data.vectors.flatMap((v) => [
    { name: `${v.name} [${v.unit}]`, values: v.real },
    ...(v.imaginary?.some((n) => n !== 0)
      ? [{ name: `${v.name} imaginary [${v.unit}]`, values: v.imaginary }]
      : []),
  ]);
  const rows = [columns.map((c) => quote(c.name)).join(',')];
  for (let i = 0; i < (columns[0]?.values.length || 0); i++)
    rows.push(columns.map((c) => String(c.values[i] ?? '')).join(','));
  return rows.join('\r\n');
}

export function exportResult(
  run: SimulationRun,
  data: ResultData,
  format: 'csv' | 'json' | 'raw',
): void {
  if (format === 'csv')
    download(`simulation-${run.id}.csv`, csv(data), 'text/csv;charset=utf-8');
  else if (format === 'json')
    download(
      `simulation-${run.id}.json`,
      JSON.stringify({ schemaVersion: 1, run, data }, null, 2),
      'application/json',
    );
  else {
    const complex = data.vectors.some((v) => v.imaginary?.some((n) => n !== 0));
    let text = `Title: TinyCAD simulation\nDate: ${run.created}\nPlotname: ${
      run.analysis.kind
    }\nFlags: ${complex ? 'complex' : 'real'}\nNo. Variables: ${
      data.vectors.length
    }\nNo. Points: ${run.samples}\nVariables:\n`;
    data.vectors.forEach((v, i) => {
      text += `\t${i}\t${v.name}\t${
        v.unit === 's'
          ? 'time'
          : v.unit === 'Hz'
          ? 'frequency'
          : v.unit === 'A'
          ? 'current'
          : 'voltage'
      }\n`;
    });
    text += 'Values:\n';
    for (let i = 0; i < run.samples; i++)
      data.vectors.forEach((v, j) => {
        text += `${j === 0 ? i : ''}\t${v.real[i]}${
          complex ? `,${v.imaginary?.[i] || 0}` : ''
        }\n`;
      });
    download(`simulation-${run.id}.raw`, text, 'text/plain');
  }
}

export function measurements(values: number[]): {
  minimum: number;
  maximum: number;
  mean: number;
  rms: number;
  peakToPeak: number;
} {
  if (!values.length) throw new Error('No samples to measure.');
  let minimum = Infinity,
    maximum = -Infinity,
    sum = 0,
    squares = 0;
  for (const v of values) {
    minimum = Math.min(minimum, v);
    maximum = Math.max(maximum, v);
    sum += v;
    squares += v * v;
  }
  return {
    minimum,
    maximum,
    mean: sum / values.length,
    rms: Math.sqrt(squares / values.length),
    peakToPeak: maximum - minimum,
  };
}
