import { dsnDrawing } from '../model/dsnDrawing';
import { DocItemTypes } from '../model/dsnItem';
import { updateSymbol } from '../manipulators/updateSymbol';
import { readControl } from './controls';
import { updateControl } from './controlSymbols';
import { positiveQuantity } from './numbers';
import { symbolReference } from './bindings';
export interface ResistanceTest {
  sheet: string;
  reference: string;
  current: string;
  baseHash: string;
}
export function resistanceCircuit(
  drawing: dsnDrawing,
  test: ResistanceTest,
): dsnDrawing {
  const current = positiveQuantity(test.current, 'A');
  let found = false;
  const sheets = drawing.sheets.map((sheet) =>
    sheet.kind === 'simulation'
      ? sheet
      : {
          ...sheet,
          items: sheet.items.map((item) => {
            if (item.NodeName !== DocItemTypes.Symbol) return item;
            const control = readControl(item),
              ref = symbolReference(item);
            if (
              (sheet.id || sheet.name) === test.sheet &&
              ref === test.reference
            ) {
              found = true;
              return new updateSymbol(item).setSpiceProperty(
                '$$SPICE',
                `I_$(ref)_test %(2) %(1) ${current}\nR_$(ref)_leak %(1) %(2) 1e12`,
              );
            }
            if (control?.kind === 'source')
              return updateControl(
                {...item,text:item.text.map(f=>({...f,position:[...f.position]}))},
                { ...control, waveform: 'dc', dc: '0', acMagnitude: '0' },
                drawing,
              );
            if (control?.kind === 'instrument')
              return new updateSymbol(item).setSpiceProperty(
                '$$SPICE',
                control.type === 'scope'
                  ? 'R_$(ref)_A %(1) %(2) 1e12\nR_$(ref)_B %(3) %(4) 1e12'
                  : 'R_$(ref)_off %(1) %(2) 1e12',
              );
            if (control?.kind === 'probe') return item;
            const template = item.text
              .find((f) => f.description === '$$SPICE')
              ?.value?.trim();
            const primitive =
              /^\$\(ref\)\s+(?:%\(1\)|\$\(pin\(1\)\))\s+(?:%\(2\)|\$\(pin\(2\)\))\s+\$\((value|name)\)$/i.exec(
                template || '',
              );
            if (!/^[RCL]/i.test(ref) || !primitive)
              throw new Error(
                'Resistance tests support passive R/C/L networks only. Disconnect active devices and controlled sources.',
              );
            positiveQuantity(
              item.text.find(
                (f) =>
                  f.description.toLowerCase() === primitive[1].toLowerCase(),
              )?.value || '',
              /^R/i.test(ref) ? 'Ohm' : /^C/i.test(ref) ? 'F' : 'H',
            );
            return item;
          }),
        },
  );
  if (!found) throw new Error('Resistance meter is no longer in the circuit.');
  return { ...drawing, sheets };
}
