import { dsnDrawing } from '../model/dsnDrawing';
import { dsnSymbol, DocItemTypes } from '../model/dsnItem';
import { readControl, probeResult } from './controls';
import { ResultData } from './contracts';
import { NetlistData } from '../io/netlists/netlistGenerator';
import { deriveTraces } from './traces';

export interface ChartProbe {
  id: string;
  title: string;
  sheet: string;
  symbol: dsnSymbol;
}
export interface WorkspaceChart {
  id: string;
  title: string;
  probeId?: string;
  signals: string[];
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
): WorkspaceChart[] {
  const ids = new Set(probes.map((p) => p.id));
  const next = charts.filter((c) => !c.probeId || ids.has(c.probeId));
  for (const probe of probes) {
    if (!hidden.has(probe.id) && !next.some((c) => c.probeId === probe.id))
      next.push({
        id: probe.id,
        title: probe.title,
        probeId: probe.id,
        signals: [],
      });
  }
  if (!probes.length && hasSetup && !next.length && !hidden.has('outputs'))
    next.push({ id: 'outputs', title: 'Simulation outputs', signals: [] });
  return next.length === charts.length && next.every((c, i) => c === charts[i])
    ? charts
    : next;
}
export function workspaceChartData(
  chart: WorkspaceChart,
  probes: ChartProbe[],
  net: NetlistData | undefined,
  data: ResultData | undefined,
  traces: Parameters<typeof deriveTraces>[1],
  fresh: boolean,
): ResultData | undefined {
  if (!data || !fresh) return;
  if (!chart.probeId) return deriveTraces(data, traces || []).data;
  const probe = probes.find((p) => p.id === chart.probeId);
  return net && probe ? probeResult(net, probe.symbol, data) : undefined;
}
