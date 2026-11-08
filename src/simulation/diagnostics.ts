import { DrcError } from '../model/dsnDrawing';
import { NetlistData, SymbolRef } from '../io/netlists/netlistGenerator';
import { writeSpice } from '../io/netlists/netlistSpice';
import { SimulationSetup } from './contracts';
import { validateSpiceText } from './deck';
import { readControl, controlTemplate } from './controls';

const reference = ([, symbol]: SymbolRef) =>
  symbol.text.find((field) => field.description === 'Ref')?.value || '';

function componentError(source: SymbolRef, message: string): DrcError {
  return {
    sheet: source[0],
    id: source[1]._id,
    a: [...source[1].point],
    symbol: reference(source) || 'Unnamed symbol',
    pin: '',
    text: `SPICE: ${message}`,
  };
}

export function generalSpiceError(message: string): DrcError {
  return {
    sheet: '',
    id: -1,
    a: [0, 0],
    symbol: '',
    pin: '',
    text: `SPICE: ${message}`,
  };
}

// Expand against the complete circuit so pin and attribute diagnostics retain
// the same context as the actual deck, while keeping each component's origin.
function componentText(netlist: NetlistData, source: SymbolRef): string {
  return writeSpice({ ...netlist, symbols: [source] }).replace(
    /^\* Schematics Netlist.*\n/,
    '',
  );
}

export function checkSpiceComponents(
  netlist: NetlistData,
  setup: SimulationSetup,
): DrcError[] {
  const errors: DrcError[] = [];
  const references = netlist.symbols.map((source) =>
    reference(source).toLowerCase(),
  );
  for (const source of netlist.symbols) {
    const symbol = source[1];
    const ref = reference(source);
    const control = readControl(symbol);
    if(!control&&symbol.text.some(f=>f.description==='$$SPICE_CONTROL'&&f.value.trim())){errors.push(componentError(source,'Invalid built-in control metadata. Edit or replace this control.'));continue;}
    if (control) {
      try { controlTemplate(control); }
      catch (error) {
        errors.push(componentError(source, error instanceof Error ? error.message : String(error)));
        continue;
      }
    }
    if (!ref || ref.includes('?'))
      errors.push(
        componentError(source, 'Assign a component reference before running.'),
      );
    else if (
      references.filter((value) => value === ref.toLowerCase()).length > 1
    )
      errors.push(componentError(source, `Duplicated reference ${ref}.`));
    if (
      !symbol.text
        .find((field) => field.description === '$$SPICE')
        ?.value?.trim()
    ) {
      errors.push(componentError(source, 'No SPICE information.'));
      continue;
    }
    for (const field of symbol.text.filter((field) =>
      /^\$\$SPICE_(?:PROLOG|EPILOG)_PRIORITY$/.test(field.description),
    )) {
      if (field.value.trim() && !/^[0-9]$/.test(field.value.trim()))
        errors.push(
          componentError(
            source,
            `${field.description}: priority must be an integer from 0 to 9.`,
          ),
        );
    }
    try {
      const text = componentText(netlist, source);
      const unresolved = [...text.matchAll(/<(?:pin|attr) [^>]+>/g)].map(
        (match) => match[0],
      );
      if (unresolved.length)
        errors.push(
          componentError(source, [...new Set(unresolved)].join('; ')),
        );
      if (/^\s*\.(?:op|tran|ac|dc|noise|tf|pz|end)\b/im.test(text))
        errors.push(
          componentError(
            source,
            'Remove analysis commands and .end; configure these on the Simulation sheet.',
          ),
        );
      validateSpiceText(text, setup.models);
    } catch (error) {
      errors.push(
        componentError(
          source,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }
  return errors;
}

const normalize = (text: string) =>
  text.trim().replace(/\s+/g, ' ').toLowerCase();
const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ngspice may report an expanded statement, a deck line number, or a device
// reference. Prefer statement/line matches; do not blame an arbitrary symbol
// when an error is in analysis settings, attached files or the solver itself.
export function locateSpiceErrors(
  netlist: NetlistData | undefined,
  deck: string,
  message: string,
  log = '',
): DrcError[] {
  const detail = log
    .split(/\r?\n/)
    .filter((line) =>
      /\b(?:error|fatal|unknown|not found|can't find|timestep too small)\b/i.test(
        line,
      ),
    )
    .slice(0, 3)
    .join('; ');
  const explanation =
    detail && !message.includes(detail) ? `${message}: ${detail}` : message;
  if (!netlist) return [generalSpiceError(explanation)];
  const context = normalize(log + '\n' + message);
  const deckLines = deck.split(/\r?\n/);
  const inAttachedFile =
    /\b(?:from|in)\s+(?:file\s+)?["']?[\w-]+\.(?:lib|cir|mod)\b/i.test(context);
  const reportedLines = (
    inAttachedFile ? [] : [...context.matchAll(/\bline\s+(\d+)\b/g)]
  )
    .map((match) => normalize(deckLines[Number(match[1]) - 1] || ''))
    .filter(Boolean);
  const sources = netlist.symbols.map((source) => {
    let lines: string[] = [];
    try {
      lines = componentText(netlist, source)
        .split(/\r?\n/)
        .map(normalize)
        .filter((line) => line && !line.startsWith('*'));
    } catch {
      /* A preflight diagnostic will carry expansion errors. */
    }
    return { source, lines };
  });
  let matched = sources.filter(({ lines }) =>
    lines.some(
      (line) => context.includes(line) || reportedLines.includes(line),
    ),
  );
  if (!matched.length && inAttachedFile) {
    matched = sources.filter(({ lines }) =>
      lines.some((line) => {
        const include =
          /^\.(?:inc|include|lib)\s+["']?([\w-]+\.(?:lib|cir|mod))/i.exec(line);
        return include && context.includes(include[1]);
      }),
    );
  }
  if (!matched.length) {
    matched = sources.filter(({ source }) => {
      const ref = reference(source);
      return (
        ref &&
        new RegExp(
          `(^|[^a-z0-9_])${escapeRegex(ref)}(?=$|[^a-z0-9_])`,
          'i',
        ).test(context)
      );
    });
  }
  return matched.length
    ? matched.map(({ source }) => componentError(source, explanation))
    : [generalSpiceError(explanation)];
}
