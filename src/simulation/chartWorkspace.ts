import { dsnDrawing } from '../model/dsnDrawing';
import { dsnSymbol, DocItemTypes } from '../model/dsnItem';
import { readControl, probeResult } from './controls';
import { ResultData } from './contracts';
import { NetlistData } from '../io/netlists/netlistGenerator';
import { deriveTraces } from './traces';
import { spicePinLabel } from '../io/netlists/netlistSpice';
import { signalLabel } from './signals';

export interface ChartProbe {
  id: string;
  title: string;
  sheet: string;
  symbol: dsnSymbol;
}
export interface WorkspaceChart {
  id: string;
  signals: string[];
  awaitingSignals?: boolean;
}

export function chartSignalLabel(
  name: string,
  unit: string,
  probes: ChartProbe[],
  net?: NetlistData,
): string {
  const probe = probes.find(
    (p) =>
      p.symbol.text
        .find((f) => f.description === 'Ref')
        ?.value.toLowerCase() === name,
  );
  if (probe) {
    const ref =
      probe.symbol.text.find((f) => f.description === 'Ref')?.value || name;
    const control = readControl(probe.symbol);
    if (control?.kind === 'probe') {
      const plus = net ? spicePinLabel('1', probe.symbol, net) : undefined;
      const minus =
        net && control.mode !== 'voltage'
          ? spicePinLabel('2', probe.symbol, net)
          : undefined;
      if (control.mode === 'current')
        return plus && minus
          ? `${ref}: ${control.invert ? '−' : ''}I(${plus} → ${minus})`
          : `${ref}: current`;
      const voltage = plus
        ? `V(${plus})${minus && minus !== '0' ? ` − V(${minus})` : ''}`
        : 'voltage';
      return `${ref}: ${control.invert ? `−(${voltage})` : voltage}`;
    }
  }
  const branch = /^(?:i\((.+)\)|(.+)#branch)$/i.exec(name);
  if (branch) return `I(${(branch[1] || branch[2]).toUpperCase()})`;
  if (unit === 'V' && /^[\w.-]+$/.test(name)) return `V(${name})`;
  return signalLabel(name);
}
export function drawingProbes(drawing: dsnDrawing): ChartProbe[] {
  return drawing.sheets
    .filter((s) => s.kind !== 'simulation')
    .flatMap((sheet) =>
      sheet.items
        .filter(
          (item): item is dsnSymbol =>
            item.NodeName === DocItemTypes.Symbol &&
            readControl(item)?.kind === 'probe',
        )
        .map((symbol) => ({
          id: `probe:${sheet.id || sheet.name}:${symbol._id}`,
          title: `${
            symbol.text.find((f) => f.description === 'Ref')?.value || 'Probe'
          } — ${sheet.name}`,
          sheet: sheet.name,
          symbol,
        })),
    );
}
export function reconcileCharts(
  charts: WorkspaceChart[],
  probes: ChartProbe[],
  hidden: Set<string>,
  hasSetup: boolean,
  data?: ResultData,
  preferred: string[] = [],
): WorkspaceChart[] {
  // Charts belong to the user, independently of any particular probe.
  const suggestions = suggestedCharts(probes, data, preferred);
  if (charts.length) {
    if (!suggestions.length || !charts.some((c) => c.awaitingSignals))
      return charts;
    return charts.map((c) =>
      c.awaitingSignals
        ? { ...c, signals: suggestions[0].signals, awaitingSignals: undefined }
        : c,
    );
  }
  if (hidden.has('outputs') || (!hasSetup && !probes.length)) return charts;
  return suggestions.length ? suggestions : charts;
}

export function suggestedCharts(
  probes: ChartProbe[],
  data?: ResultData,
  preferred: string[] = [],
): WorkspaceChart[] {
  // Placed probes express intent more reliably than solver-generated nodes.
  const probeCharts = probes
    .flatMap((probe) => {
      const name = probe.symbol.text
        .find((f) => f.description === 'Ref')
        ?.value.toLowerCase();
      return name &&
        (!data || data.vectors.some((v) => v.name === name && v.real.length))
        ? [{ id: probe.id, signals: [name] }]
        : [];
    })
    .slice(0, 4);
  if (probeCharts.length) return probeCharts;
  if (!data) return [];

  const available = data.vectors.filter(
    (v) =>
      v.name !== data.scale &&
      v.name !== '0' &&
      !/^v\(0\)$/i.test(v.name) &&
      v.real.length,
  );
  const explicit = available.filter((v) => preferred.includes(v.name));
  const ordinary = available.filter((v) => !v.name.startsWith('@'));
  const candidates = explicit.length
    ? explicit
    : ordinary.length
    ? ordinary
    : available;
  const priority = (name: string) =>
    /^(?:out|output|vout)(?:\b|[_(])/i.test(name)
      ? 0
      : /^(?:in|input|vin)(?:\b|[_(])/i.test(name)
      ? 1
      : /^_?n_?\d+$/i.test(name) || name.startsWith('@')
      ? 3
      : 2;
  const groups = new Map<string, string[]>();
  for (const vector of [...candidates].sort(
    (a, b) => priority(a.name) - priority(b.name),
  )) {
    const signals = groups.get(vector.unit) || [];
    if (signals.length < 4) signals.push(vector.name);
    groups.set(vector.unit, signals);
  }
  // Keep different units readable and limit how much appears at first opening.
  return [...groups]
    .sort(
      ([a], [b]) =>
        (a === 'V' ? 0 : a === 'A' ? 1 : 2) -
        (b === 'V' ? 0 : b === 'A' ? 1 : 2),
    )
    .slice(0, 3)
    .map(([unit, signals]) => ({ id: `outputs:${unit}`, signals }));
}
export function workspaceChartData(
  _chart: WorkspaceChart,
  probes: ChartProbe[],
  net: NetlistData | undefined,
  data: ResultData | undefined,
  traces: Parameters<typeof deriveTraces>[1],
  fresh: boolean,
): ResultData | undefined {
  if (!data || !fresh) return;
  // Every chart can combine raw outputs, probe readings and derived traces.
  const vectors = new Map(data.vectors.map((v) => [v.name, v]));
  if (net)
    for (const probe of probes) {
      for (const vector of probeResult(net, probe.symbol, data)?.vectors ||
        []) {
        if (vector.name !== data.scale && !vectors.has(vector.name))
          vectors.set(vector.name, vector);
      }
    }
  return deriveTraces({ ...data, vectors: [...vectors.values()] }, traces || [])
    .data;
}
