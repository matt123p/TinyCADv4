import { ResultData } from './contracts';

// Numerical buffers deliberately live outside Redux and its undo snapshots.
const results = new Map<string, ResultData>();
let ownerDocument: string;
export const MAX_RUN_BYTES = 64 * 1024 * 1024;
export const MAX_RESULT_BYTES = 256 * 1024 * 1024;

export function resultBytes(data: ResultData): number {
  return [data, ...(data.plots || [])].reduce(
    (total, plot) =>
      total +
      plot.vectors.reduce(
        (n, v) => n + (v.real.length + (v.imaginary?.length || 0)) * 8,
        0,
      ),
    0,
  );
}

export function getResult(id: string): ResultData | undefined {
  return results.get(id);
}

export function putResult(id: string, data: ResultData): void {
  const size = resultBytes(data);
  const total = [...results.entries()].reduce(
    (n, [key, value]) => n + (key === id ? 0 : resultBytes(value)),
    0,
  );
  if (size > MAX_RUN_BYTES || total + size > MAX_RESULT_BYTES) {
    throw new Error(
      'Result memory limit reached. Save a compact copy and reopen it to release session and Undo buffers.',
    );
  }
  results.set(id, data);
}

export function releaseResult(id: string): void {
  results.delete(id);
}

export function restoreResults(
  entries: [string, ResultData][],
  documentId?: string,
): void {
  const ids = new Set<string>();
  let total = 0;
  for (const [id, data] of entries) {
    if (ids.has(id)) throw new Error('Duplicate saved run identity.');
    ids.add(id);
    const size = resultBytes(data);
    total += size;
    if (size > MAX_RUN_BYTES || total > MAX_RESULT_BYTES)
      throw new Error('Saved results exceed the document storage limit.');
  }
  // Validate the whole new document before replacing the current result cache.
  results.clear();
  ownerDocument = documentId;
  entries.forEach(([id, data]) => results.set(id, data));
}

export function activateResultDocument(documentId: string): void {
  if (ownerDocument !== documentId) {
    results.clear();
    ownerDocument = documentId;
  }
}

export function vectorUnit(name: string): string {
  if (/impedance/i.test(name)) return 'Ohm';
  if (/transfer_function/i.test(name)) return 'V/V';
  if (/^(?:pole|zero)\(/i.test(name)) return 'rad/s';
  if (name === 'time') return 's';
  if (name === 'frequency') return 'Hz';
  if (/branch|^i\(|\[i\]$/.test(name)) return 'A';
  if (/onoise|inoise/.test(name)) return /total/.test(name) ? 'V RMS' : 'V/√Hz';
  return 'V';
}
