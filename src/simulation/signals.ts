import { dsnDrawing } from '../model/dsnDrawing';
import { NetlistData } from '../io/netlists/netlistGenerator';
import { DocItemTypes } from '../model/dsnItem';
import { spicePinLabel } from '../io/netlists/netlistSpice';
import { probeResult, readControl } from './controls';
import { symbolReference } from './bindings';
import { ResultData, ResultVector } from './contracts';
import { parseQuantity } from './numbers';
import { measuredDevice } from './deviceReadings';
import { FindResult } from '../model/dsnView';
import { MeasurementDefinition } from './explorerTypes';
import { TraceDefinition } from './traces';
import { instrumentInputPin } from './instruments';

export function measurementLocation(
  drawing: dsnDrawing,
  net: NetlistData,
  definition: MeasurementDefinition,
  traces: TraceDefinition[] = [],
): FindResult | undefined {
  let source = definition.source;
  const seen = new Set<string>();
  while (traces.some((t) => t.name === source)) {
    if (seen.has(source)) return;
    seen.add(source);
    source = traces.find((t) => t.name === source).left;
  }
  if (source.startsWith('device|')) {
    try {
      const [, sheetId, ref] = source.split('|'),
        sheet = drawing.sheets.find(
          (s) => (s.id || s.name) === decodeURIComponent(sheetId),
        );
      const symbol = sheet?.items.find(
        (i) =>
          i.NodeName === DocItemTypes.Symbol &&
          symbolReference(i).toLowerCase() ===
            decodeURIComponent(ref).toLowerCase(),
      );
      if (symbol?.NodeName === DocItemTypes.Symbol)
        return {
          sheet: sheet.name,
          id: symbol._id,
          a: symbol.point,
          symbol: symbolReference(symbol),
          text: definition.name,
        };
    } catch {
      return;
    }
  }
  const branch = /^(?:i\((.+)\)|(.+)#branch)$/i.exec(source);
  if (branch) {
    const entry = net.symbols.find(
      ([, s]) =>
        symbolReference(s).toLowerCase() ===
        (branch[1] || branch[2]).toLowerCase(),
    );
    if (entry)
      return {
        sheet: entry[0],
        id: entry[1]._id,
        a: entry[1].point,
        symbol: symbolReference(entry[1]),
        text: definition.name,
      };
  }
  const name = source.replace(/^v\((.*)\)$/i, '$1');
  const id =
    Object.entries(net.labels).find(
      ([label]) => label.toLowerCase() === name.toLowerCase(),
    )?.[1] || /^_N_(.+)$/i.exec(name)?.[1];
  const nodes = id && net.nets[id],
    node = nodes?.[0];
  if (node) {
    const ids = [
      ...new Set(
        nodes
          .filter((n) => n.sheet === node.sheet)
          .map((n) => n.parent?._id ?? n.symbol?._id)
          .filter((n) => n !== undefined),
      ),
    ];
    if (ids.length)
      return {
        sheet: node.sheet,
        id: ids[0],
        ids,
        a: node.a,
        symbol: name,
        text: definition.name,
      };
  }
}

export const deviceSignal = (sheet: string, ref: string, kind: string) =>
  `device|${encodeURIComponent(sheet)}|${encodeURIComponent(ref)}|${kind}`;
export function resolvedSignals(
  drawing: dsnDrawing,
  net: NetlistData,
  data: ResultData,
  wanted?: string[],
): ResultData {
  const vectors = [...data.vectors],
    count = data.vectors[0]?.real.length || 0;
  const find = (name: string) =>
    vectors.find((v) => v.name.toLowerCase() === name?.toLowerCase());
  const zero: ResultVector = {
    name: '0',
    unit: 'V',
    real: Array(count).fill(0),
  };
  if (!find('0')) vectors.push(zero);
  const node = (name: string) =>
    name === '0' ? zero : find(name) || find(`v(${name})`);
  for (const sheet of drawing.sheets.filter((s) => s.kind !== 'simulation'))
    for (const item of sheet.items) {
      if (item.NodeName !== DocItemTypes.Symbol) continue;
      const ref = symbolReference(item),
        key = (kind: string) => deviceSignal(sheet.id || sheet.name, ref, kind);
      if (
        !ref ||
        sheet.items.filter(
          (i) =>
            i.NodeName === DocItemTypes.Symbol &&
            symbolReference(i).toLowerCase() === ref.toLowerCase(),
        ).length !== 1
      )
        continue;
      const control = readControl(item);
      if (
        wanted &&
        !wanted.some((name) =>
          ['probe', 'voltage', 'current', 'power'].some(
            (kind) => name === key(kind),
          ),
        )
      )
        continue;
      if (control?.kind === 'probe') {
        const probe = probeResult(net, item, data)?.vectors.find(
          (v) => v.name !== data.scale,
        );
        if (probe) vectors.push({ ...probe, name: key('probe') });
      }
      const a = node(spicePinLabel(control?.kind === 'instrument' ? instrumentInputPin(control) : '1', item, net)),
        b = node(spicePinLabel('2', item, net));
      if (!a || !b) continue;
      const voltage: ResultVector = {
        name: key('voltage'),
        unit: 'V',
        real: a.real.map((v, i) => v - b.real[i]),
        imaginary: a.real.map(
          (_, i) => (a.imaginary?.[i] || 0) - (b.imaginary?.[i] || 0),
        ),
      };
      vectors.push(voltage);
      const actual = data.scale !== 'frequency' ? measuredDevice(net,item,data) : {};
      let current = find(`${ref}#branch`) || find(`i(${ref})`);
      current ||= actual.current;
      if(actual.power) vectors.push({...actual.power,name:key('power')});
      if(control?.kind==='instrument') {
        if(control.type==='supply') {const delivered=find(`v_${ref}_sense#branch`);if(delivered)current={...delivered,real:delivered.real.map(n=>-n),imaginary:delivered.imaginary?.map(n=>-n)};}
        else if(control.type==='generator') current=find(`v_${ref}#branch`);
        else if(control.type==='meter'&&control.mode.endsWith('A'))current=find(`v_${ref}_sense#branch`);
      }
      // Only ideal primitive R devices can safely use Ohm's law. Models and arbitrary templates cannot.
      const template = item.text
        .find((f) => f.description === '$$SPICE')
        ?.value?.trim();
      if (
        !current &&
        /^r/i.test(ref) &&
        /^\$\(ref\)\s+(?:%\(1\)|\$\(pin\(1\)\))\s+(?:%\(2\)|\$\(pin\(2\)\))\s+\$\((?:value|name)\)$/i.test(
          template || '',
        )
      ) {
        try {
          const property = /\$\((value|name)\)$/i.exec(template)[1];
          const r = parseQuantity(
            item.text.find(
              (f) => f.description.toLowerCase() === property.toLowerCase(),
            )?.value || '',
            'Ohm',
          );
          if (r > 0)
            current = {
              name: key('current'),
              unit: 'A',
              real: voltage.real.map((v) => v / r),
              imaginary: voltage.imaginary.map((v) => v / r),
            };
        } catch {
          /* Parameter expressions and model devices require actual solver currents. */
        }
      }
      if (current) {
        vectors.push({ ...current, name: key('current') });
        if (data.scale !== 'frequency' && !actual.power)
          vectors.push({
            name: key('power'),
            unit: 'W',
            real: voltage.real.map((v, i) => v * current.real[i]),
          });
      }
    }
  return { ...data, vectors };
}
export function signalLabel(name: string): string {
  if (!name.startsWith('device|')) return name;
  const [, , ref, kind] = name.split('|');
  try {
    return `${decodeURIComponent(ref)} ${kind}`;
  } catch {
    return name;
  }
}
