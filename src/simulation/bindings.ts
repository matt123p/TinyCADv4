import { dsnDrawing } from '../model/dsnDrawing';
import { DocItemTypes, dsnSymbol } from '../model/dsnItem';
import { updateSymbol } from '../manipulators/updateSymbol';
import { readControl, compileSource, SourceConfig } from './controls';
import { updateControl } from './controlSymbols';
import { ParameterBinding, SweepDefinition } from './explorerTypes';
import { SimulationSetup } from './contracts';
import { parseQuantity } from './numbers';

export const symbolReference = (symbol: dsnSymbol) =>
  symbol.text.find((f) => f.description.toLowerCase() === 'ref')?.value || '';
export function bindingSymbol(
  drawing: dsnDrawing,
  binding: ParameterBinding,
): dsnSymbol {
  const sheet = drawing.sheets.find(
    (s) => (s.id || s.name) === binding.sheet && s.kind !== 'simulation',
  );
  const found = sheet?.items.filter(
    (s): s is dsnSymbol =>
      s.NodeName === DocItemTypes.Symbol &&
      symbolReference(s).toLowerCase() === binding.reference.toLowerCase(),
  );
  if (found?.length !== 1)
    throw new Error(
      `Binding ${binding.name}: component is missing or ambiguous.`,
    );
  return found[0];
}
export const sourceFields: Record<string, string> = {
  dc: '',
  acMagnitude: '',
  acPhase: 'deg',
  offset: '',
  amplitude: '',
  frequency: 'Hz',
  phase: 'deg',
  delay: 's',
  damping: '',
  low: '',
  high: '',
  rise: 's',
  fall: 's',
  width: 's',
  period: 's',
  riseDelay: 's',
  fallDelay: 's',
  riseTau: 's',
  fallTau: 's',
  modulationFrequency: 'Hz',
  modulationIndex: '',
};
export function bindingValue(
  drawing: dsnDrawing,
  setup: SimulationSetup,
  binding: ParameterBinding,
): string {
  if (binding.sheet === '$parameter') {
    if (
      !Object.prototype.hasOwnProperty.call(setup.parameters, binding.property)
    )
      throw new Error('Named setup parameter no longer exists.');
    return setup.parameters[binding.property];
  }
  const symbol = bindingSymbol(drawing, binding);
  if (binding.property.startsWith('source:')) {
    const key = binding.property.slice(7),
      control = readControl(symbol);
    if (
      control?.kind !== 'source' ||
      !Object.prototype.hasOwnProperty.call(sourceFields, key)
    )
      throw new Error('Source parameter no longer exists.');
    return control[key as keyof SourceConfig];
  }
  const field = symbol.text.find(
    (f) => f.description.toLowerCase() === binding.property.toLowerCase(),
  );
  if (
    !field ||
    field.description.startsWith('$$') ||
    field.description.toLowerCase() === 'ref'
  )
    throw new Error('Choose an editable numeric component property.');
  return field.value;
}
export function applyBindings(
  drawing: dsnDrawing,
  setup: SimulationSetup,
  overrides: Record<string, string>,
): { drawing: dsnDrawing; setup: SimulationSetup } {
  let result = drawing,
    configured = { ...setup, parameters: { ...setup.parameters } };
  for (const [id, text] of Object.entries(overrides)) {
    const binding = setup.bindings?.find((b) => b.id === id);
    if (!binding) throw new Error('Tuning binding no longer exists.');
    bindingValue(result, configured, binding);
    const number = parseQuantity(text, binding.unit);
    if (binding.sheet === '$parameter') {
      configured.parameters[binding.property] = String(number);
      continue;
    }
    const symbol = bindingSymbol(result, binding);
    let changed: dsnSymbol;
    if (binding.property.startsWith('source:')) {
      const control = readControl(symbol);
      if (control?.kind !== 'source')
        throw new Error('Source no longer exists.');
      const config = {
        ...control,
        [binding.property.slice(7)]: String(number),
      };
      compileSource(config);
      changed = updateControl(symbol, config, result);
      const sheet = result.sheets.find(
        (s) => (s.id || s.name) === binding.sheet,
      );
      if (
        sheet.items.some(
          (i) =>
            i !== symbol &&
            i.NodeName === DocItemTypes.Symbol &&
            i._symbol.id === symbol._symbol.id,
        )
      ) {
        const nextId =
          Math.max(0, ...Object.keys(sheet.symbols).map(Number)) + 1;
        changed = { ...changed, _symbol: { ...changed._symbol, id: nextId } };
      }
    } else
      changed = new updateSymbol({
        ...symbol,
        text: symbol.text.map((field) => ({
          ...field,
          position: [...field.position],
          value:
            field.description.toLowerCase() === binding.property.toLowerCase()
              ? String(number)
              : field.value,
        })),
        textData: [],
        _active_points: null,
      }).post_construction();
    result = {
      ...result,
      sheets: result.sheets.map((sheet) =>
        (sheet.id || sheet.name) !== binding.sheet
          ? sheet
          : {
              ...sheet,
              items: sheet.items.map((i) => (i === symbol ? changed : i)),
              symbols: {
                ...sheet.symbols,
                [changed._symbol.id]: changed._symbol,
              },
            },
      ),
    };
  }
  return { drawing: result, setup: configured };
}
// IEC preferred decades, from Vishay document 31001: https://www.vishay.com/docs/31001/dectable.pdf
const seriesValues = {
  E12: [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82].map((n) => n / 10),
  E24: [
    10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56,
    62, 68, 75, 82, 91,
  ].map((n) => n / 10),
  E96: [
    100, 102, 105, 107, 110, 113, 115, 118, 121, 124, 127, 130, 133, 137, 140,
    143, 147, 150, 154, 158, 162, 165, 169, 174, 178, 182, 187, 191, 196, 200,
    205, 210, 215, 221, 226, 232, 237, 243, 249, 255, 261, 267, 274, 280, 287,
    294, 301, 309, 316, 324, 332, 340, 348, 357, 365, 374, 383, 392, 402, 412,
    422, 432, 442, 453, 464, 475, 487, 499, 511, 523, 536, 549, 562, 576, 590,
    604, 619, 634, 649, 665, 681, 698, 715, 732, 750, 768, 787, 806, 825, 845,
    866, 887, 909, 931, 953, 976,
  ].map((n) => n / 100),
};
export function preferredValue(
  value: number,
  series: ParameterBinding['series'],
): number {
  if (series === 'continuous') return value;
  if (value <= 0)
    throw new Error('Preferred value series require positive values.');
  const decade = Math.floor(Math.log10(value));
  const choices = [...seriesValues[series], 10].map((n) => n * 10 ** decade);
  return Number(
    choices
      .reduce((a, b) =>
        Math.abs(Math.log(a / value)) < Math.abs(Math.log(b / value)) ? a : b,
      )
      .toPrecision(12),
  );
}
export function sweepValues(
  sweep: SweepDefinition,
  binding: ParameterBinding,
): number[] {
  let values: number[];
  if (sweep.mode === 'list')
    values = sweep.values
      .split(/[;\s]+/)
      .filter(Boolean)
      .map((v) => parseQuantity(v, binding.unit));
  else {
    const start = parseQuantity(sweep.start, binding.unit),
      stop = parseQuantity(sweep.stop, binding.unit);
    if (
      !Number.isInteger(sweep.count) ||
      sweep.count < 2 ||
      sweep.count > 100 ||
      start >= stop ||
      (sweep.mode === 'log' && start <= 0)
    )
      throw new Error(
        'Choose an increasing range and 2–100 points; log values must be positive.',
      );
    values = Array.from({ length: sweep.count }, (_, i) =>
      sweep.mode === 'log'
        ? Math.exp(
            Math.log(start) +
              ((Math.log(stop) - Math.log(start)) * i) / (sweep.count - 1),
          )
        : start + ((stop - start) * i) / (sweep.count - 1),
    );
  }
  if (!values.length || values.length > 100)
    throw new Error('Sweeps require 1–100 values.');
  return [...new Set(values.map((n) => preferredValue(n, binding.series)))];
}
