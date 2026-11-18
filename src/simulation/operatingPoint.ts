import { dsnDrawing } from '../model/dsnDrawing';
import { DocItemTypes } from '../model/dsnItem';
import { NetlistData } from '../io/netlists/netlistGenerator';
import { ResultData, SimulationRun } from './contracts';
import { deviceSignal, resolvedSignals } from './signals';
import { symbolReference } from './bindings';
export type OverlayMode =
  | 'off'
  | 'voltages'
  | 'currents'
  | 'power'
  | 'diagnostics';
export interface Annotation {
  x: number;
  y: number;
  text: string;
  detail: string;
}
let snapshot: {
  drawing: dsnDrawing;
  net: NetlistData;
  data: ResultData;
  run: SimulationRun;
  fresh: boolean;
};
const modes = new Map<string, OverlayMode>(),
  listeners = new Set<() => void>();
export const subscribeOverlay = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const publish = () => listeners.forEach((fn) => fn());
export const overlayMode = (document: string): OverlayMode =>
  modes.get(document) || 'off';
export function setOverlayMode(document: string, mode: OverlayMode) {
  modes.set(document, mode);
  while (modes.size > 10) modes.delete(modes.keys().next().value);
  publish();
}
export function setOperatingPoint(value: typeof snapshot) {
  snapshot = value;
  publish();
}
export function getOperatingPoint() {
  return snapshot;
}
export function operatingAnnotations(
  drawing: dsnDrawing,
  net: NetlistData,
  data: ResultData,
  run: SimulationRun,
  sheetName: string,
  mode: OverlayMode,
): Annotation[] {
  if (
    mode === 'off' ||
    run.analysis.kind !== 'op' ||
    run.state !== 'complete' ||
    data.scale
  )
    return [];
  const result: Annotation[] = [],
    resolved = resolvedSignals(drawing, net, data),
    find = (name: string) =>
      resolved.vectors.find((v) => v.name.toLowerCase() === name.toLowerCase());
  const format = (n: number, unit: string) =>
    `${Number(n.toPrecision(5))} ${unit}`;
  const conditions = `${run.created} · ${run.analysis.temperature} °C · ${run.backend} ${run.buildId}`;
  if (mode === 'voltages')
    for (const [id, nodes] of Object.entries(net.nets)) {
      const here = nodes.filter((n) => n.sheet === sheetName);
      if (!here.length) continue;
      const label =
        net.labels['0'] === id
          ? '0'
          : Object.keys(net.labels).find((k) => net.labels[k] === id) ||
            `_N_${id}`;
      const vector =
        label === '0' ? { real: [0] } : find(label) || find(`v(${label})`);
      if (!vector || !Number.isFinite(vector.real[0])) continue;
      const node =
        here.find((n) => n.parent?.NodeName === DocItemTypes.Label) || here[0];
      result.push({
        x: node.a[0] + 6,
        y: node.a[1] - 8,
        text: format(vector.real[0], 'V'),
        detail: `${label} relative to node 0 · ${conditions}`,
      });
    }
  else {
    const sheet = drawing.sheets.find((s) => s.name === sheetName);
    for (const item of sheet?.items || []) {
      if (item.NodeName !== DocItemTypes.Symbol) continue;
      const ref = symbolReference(item);
      if (mode === 'diagnostics') {
        const vectors = data.vectors.filter((v) =>
          v.name.toLowerCase().startsWith(`@${ref.toLowerCase()}[`),
        );
        vectors.forEach((v, i) =>
          result.push({
            x: item.point[0] + 15,
            y: item.point[1] + 12 + i * 11,
            text: `${v.name}: ${format(v.real[0], v.unit)}`,
            detail: conditions,
          }),
        );
      } else {
        const v = find(
          deviceSignal(
            sheet.id || sheet.name,
            ref,
            mode === 'currents' ? 'current' : 'power',
          ),
        );
        if (v && Number.isFinite(v.real[0]))
          result.push({
            x: item.point[0] + 15,
            y: item.point[1] + 12,
            text: format(v.real[0], v.unit),
            detail: `${ref} · ${
              mode === 'currents' ? 'pin 1 → pin 2' : 'signed consumed power'
            } · ${conditions}`,
          });
      }
    }
  }
  return result;
}
