import { dsnDrawing } from '../model/dsnDrawing';
import { DocItemTypes } from '../model/dsnItem';
import { drawingSaveFormat } from './drawingSaveFormat';
import { resizeStudentInstruments } from '../simulation/controlSymbols';
import { ioXML } from './ioXml';
import { XMLBuilder } from '../util/xmlbuilder';
import { packDsn, unpackDsn, Payloads, validPath } from './dsnContainer';
import {
  getResult,
  restoreResults,
  vectorUnit,
  MAX_RUN_BYTES,
  resultBytes,
} from '../simulation/resultStore';
import { ResultData } from '../simulation/contracts';

function binary(values: number[]): Uint8Array {
  const data = new Uint8Array(values.length * 8);
  const view = new DataView(data.buffer);
  values.forEach((value, index) => view.setFloat64(index * 8, value, true));
  return data;
}

function numbers(data: Uint8Array, count: number): number[] {
  if (
    !data ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count * 8 !== data.length ||
    data.length > MAX_RUN_BYTES
  )
    throw new Error('Invalid saved vector length.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return Array.from({ length: count }, (_, i) => {
    const value = view.getFloat64(i * 8, true);
    if (!Number.isFinite(value))
      throw new Error('Invalid saved numerical value.');
    return value;
  });
}

function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 16384)
    text += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(text);
}

export async function encodeDrawing(
  drawing: dsnDrawing,
  representation = drawingSaveFormat(drawing),
): Promise<Uint8Array> {
  const saved = {
    ...drawing,
    sheets: drawing.sheets.map((sheet) =>
      !sheet.simulation
        ? sheet
        : {
            ...sheet,
            simulation: {
              ...sheet.simulation,
              runs: sheet.simulation.runs.map((run) =>
                run.dataState === 'available' && !sheet.simulation.retainResults
                  ? { ...run, dataState: 'not-retained' as const }
                  : run,
              ),
            },
          },
    ),
  };
  const xml = new ioXML().to_dsn(saved, true, true);
  const payloads: Payloads = {};
  for (const sheet of drawing.sheets)
    for (const run of sheet.simulation?.runs || []) {
      if (run.dataState !== 'available' || !sheet.simulation.retainResults)
        continue;
      const data = getResult(run.id);
      if (!data)
        throw new Error(
          'A retained run is missing its numerical data. Remove that run’s results before saving.',
        );
      const base = `results/${run.id}/`;
      let vectorIndex = 0;
      const plots = [data, ...(data.plots || [])].map((plot) => ({
        scale: plot.scale,
        vectors: plot.vectors.map((v) => {
          const i = vectorIndex++;
          payloads[`${base}${i}-real.bin`] = binary(v.real);
          if (v.imaginary)
            payloads[`${base}${i}-imaginary.bin`] = binary(v.imaginary);
          return {
            name: v.name,
            unit: v.unit,
            count: v.real.length,
            real: `${base}${i}-real.bin`,
            imaginary: v.imaginary ? `${base}${i}-imaginary.bin` : undefined,
          };
        }),
      }));
      payloads[`${base}index.json`] = new TextEncoder().encode(
        JSON.stringify({
          version: 1,
          ...plots[0],
          plots: plots.slice(1),
          log: data.log,
        }),
      );
    }
  if (representation === 'zip-v1') return packDsn(xml.tostring(), payloads);
  if (Object.keys(payloads).length)
    xml.appendChild(
      'DSNPAYLOADS',
      JSON.stringify(
        Object.fromEntries(
          Object.entries(payloads).map(([p, b]) => [p, toBase64(b)]),
        ),
      ),
      { version: '1' },
    );
  const output = new TextEncoder().encode(xml.tostring());
  if (output.length > 256 * 1024 * 1024)
    throw new Error(
      'XML drawing exceeds 256 MiB. Save a compressed copy instead.',
    );
  return output;
}

export async function decodeDrawing(
  input: ArrayBuffer | Uint8Array | string,
): Promise<dsnDrawing> {
  const bytes =
    typeof input === 'string'
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
      ? input
      : new Uint8Array(input);
  const { xml, payloads, representation } = await unpackDsn(bytes);
  const builder = new XMLBuilder();
  builder.fromText(xml);
  const inline = builder.getElementsByTagName('DSNPAYLOADS');
  if (inline.length) {
    if (
      representation !== 'xml' ||
      inline.length !== 1 ||
      inline[0].getAttribute('version') !== '1'
    )
      throw new Error('Invalid inline drawing data.');
    const raw = JSON.parse(inline[0].textContent);
    let total = 0;
    for (const [path, text] of Object.entries(raw)) {
      if (
        !validPath(path) ||
        !path.startsWith('results/') ||
        typeof text !== 'string'
      )
        throw new Error('Invalid inline result encoding.');
      const decoded = atob(text);
      total += decoded.length;
      if (total > 256 * 1024 * 1024)
        throw new Error('Saved result data exceeds its limit.');
      // Iterating a large string through Uint8Array.from materializes an
      // intermediate array of characters. Fill the byte buffer directly.
      const data = new Uint8Array(decoded.length);
      for (let i = 0; i < decoded.length; ++i) data[i] = decoded.charCodeAt(i);
      payloads[path] = data;
    }
  }
  const drawing = resizeStudentInstruments(new ioXML().from_dsn(builder));
  // Older browser saves may already have flattened a built-in template. Repair
  // only an exact whitespace-flattened match to its embedded configuration;
  // custom SPICE statements must remain untouched.
  const flattened = drawing.sheets
    .flatMap((sheet) => sheet.items)
    .filter(
      (item) =>
        item.NodeName === DocItemTypes.Symbol &&
        item.text.some((f) => f.description === '$$SPICE_CONTROL') &&
        item.text.some(
          (f) => f.description === '$$SPICE' && !/[\r\n]/.test(f.value),
        ),
    );
  if (flattened.length) {
    const { readControl, controlTemplate } = await import(
      '../simulation/controls'
    );
    for (const symbol of flattened) {
      if (symbol.NodeName !== DocItemTypes.Symbol) continue;
      const config = readControl(symbol);
      const field = symbol.text.find((f) => f.description === '$$SPICE');
      if (!config || !field) continue;
      try {
        const template = controlTemplate(config);
        if (
          template.includes('\n') &&
          field.value === template.replace(/\r\n?|\n|\t/g, ' ')
        )
          field.value = template;
      } catch {
        /* Invalid control settings retain their original diagnostics. */
      }
    }
  }
  drawing.representation = representation;
  const used = new Set<string>();
  const restored: [string, ResultData][] = [];
  const ids = new Set<string>();
  for (const sheet of drawing.sheets)
    for (const run of sheet.simulation?.runs || []) {
      if (ids.has(run.id)) throw new Error('Duplicate saved run identity.');
      ids.add(run.id);
      if (run.dataState !== 'available') continue;
      const key = `results/${run.id}/index.json`;
      const payload = payloads[key];
      if (!payload)
        throw new Error('A retained run is missing its saved numerical data.');
      used.add(key);
      const index = JSON.parse(new TextDecoder().decode(payload));
      if (
        index.version !== 1 ||
        typeof index.scale !== 'string' ||
        !Array.isArray(index.vectors) ||
        !index.vectors.length ||
        index.vectors.length > 128 ||
        typeof index.log !== 'string' ||
        index.log.length > 2 * 1024 * 1024
      )
        throw new Error('Invalid result index.');
      const readPlot = (record: typeof index, primary: boolean) => {
        if (
          typeof record.scale !== 'string' ||
          !Array.isArray(record.vectors) ||
          !record.vectors.length ||
          record.vectors.length > 128
        )
          throw new Error('Invalid saved result plot.');
        const names = new Set<string>();
        const count = primary ? run.samples : record.vectors[0].count;
        const plot = {
          scale: record.scale,
          vectors: record.vectors.map(
            (v: {
              name: string;
              unit: string;
              real: string;
              imaginary?: string;
              count: number;
            }) => {
              if (
                typeof v.name !== 'string' ||
                v.name.length > 256 ||
                names.has(v.name) ||
                typeof v.real !== 'string' ||
                !validPath(v.real) ||
                !v.real.startsWith(`results/${run.id}/`) ||
                (v.imaginary &&
                  (!validPath(v.imaginary) ||
                    !v.imaginary.startsWith(`results/${run.id}/`))) ||
                v.count !== count ||
                (v.unit !== undefined && typeof v.unit !== 'string')
              )
                throw new Error('Invalid result vector reference.');
              names.add(v.name);
              used.add(v.real);
              if (v.imaginary) used.add(v.imaginary);
              return {
                name: v.name,
                unit: v.unit || vectorUnit(v.name),
                real: numbers(payloads[v.real], v.count),
                imaginary: v.imaginary
                  ? numbers(payloads[v.imaginary], v.count)
                  : undefined,
              };
            },
          ),
        };
        if (plot.scale && !names.has(plot.scale))
          throw new Error('Invalid result scale.');
        return plot;
      };
      if (
        index.plots &&
        (!Array.isArray(index.plots) || index.plots.length > 8)
      )
        throw new Error('Too many saved result plots.');
      const data: ResultData = {
        ...readPlot(index, true),
        log: index.log,
        plots: (index.plots || []).map((plot: typeof index) =>
          readPlot(plot, false),
        ),
      };
      if (resultBytes(data) > MAX_RUN_BYTES)
        throw new Error('Saved result exceeds its size limit.');
      restored.push([run.id, data]);
    }
  if (Object.keys(payloads).some((path) => !used.has(path)))
    throw new Error('Drawing contains unreferenced result data.');
  restoreResults(restored, drawing.documentId);
  return drawing;
}
