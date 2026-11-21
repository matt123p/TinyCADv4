import { ResultData } from './contracts';

// Numerical buffers deliberately live outside Redux and its undo snapshots.
let results = new Map<string, ResultData>();
let ownerDocument: string;
let activeScope: string | undefined;
const projectResults = new Map<string, Map<string, ResultData>>();
export const MAX_RUN_BYTES = 64 * 1024 * 1024;
export const MAX_RESULT_BYTES = 256 * 1024 * 1024;

export function resultBytes(data: ResultData): number {
  return (
    new TextEncoder().encode(data.log || '').byteLength +
    [data, ...(data.plots || [])].reduce(
      (total, plot) =>
        total +
        plot.vectors.reduce(
          (n, v) => n + (v.real.length + (v.imaginary?.length || 0)) * 8,
          0,
        ),
      0,
    )
  );
}

export function getResult(id: string, scope?: string): ResultData | undefined {
  return (scope === undefined ? results : projectResults.get(scope))?.get(id);
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
  entries: [string, ResultData][] | ReadonlyMap<string, ResultData>,
  documentId?: string,
  target?: string | Map<string, ResultData>,
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
  const restored = new Map(entries);
  if (typeof target === 'string') {
    projectResults.set(target, restored);
    if (activeScope === target) results = restored;
  } else if (target) {
    target.clear();
    restored.forEach((data, id) => target.set(id, data));
  } else {
    results = restored;
    ownerDocument = documentId;
    activeScope = undefined;
  }
}

export function activateResultDocument(documentId: string, scope?: string | null): void {
  // Simulation commands within the current drawing keep its project scope.
  if (scope === undefined && ownerDocument === documentId) return;
  const nextScope = scope ?? undefined;
  if (ownerDocument === documentId && activeScope === nextScope) return;
  ownerDocument = documentId;
  activeScope = nextScope;
  results = (activeScope && projectResults.get(activeScope)) || new Map();
  if (activeScope) projectResults.set(activeScope, results);
}

export function moveResultScope(from: string | undefined, to: string | undefined) {
  if (activeScope !== from || from === to) return;
  if (from) projectResults.delete(from);
  if (to) projectResults.set(to, results);
  activeScope = to;
}

export function retainProjectResultScopes(open: Set<string>) {
  for (const scope of projectResults.keys())
    if (!open.has(scope)) projectResults.delete(scope);
}

export function vectorUnit(name: string): string {
  if (/\[(?:i|id|ic|ib|ie|ig|is)\]$/i.test(name)) return 'A';
  if (/\[p\]$/i.test(name)) return 'W';
  if (/impedance/i.test(name)) return 'Ohm';
  if (/transfer_function/i.test(name)) return 'V/V';
  if (/^(?:pole|zero)\(/i.test(name)) return 'rad/s';
  if (name === 'time') return 's';
  if (name === 'frequency') return 'Hz';
  if (/branch|^i\(|\[i\]$/.test(name)) return 'A';
  if (/onoise|inoise/.test(name)) return /total/.test(name) ? 'V RMS' : 'V/√Hz';
  return 'V';
}
