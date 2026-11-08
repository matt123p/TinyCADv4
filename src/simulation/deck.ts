import { NetlistData } from '../io/netlists/netlistGenerator';
import { writeSpice } from '../io/netlists/netlistSpice';
import { AnalysisDefinition, SimulationSetup } from './contracts';
import { parseQuantity, positiveQuantity } from './numbers';
import { deviceSaveLine } from './deviceReadings';

const token = (value: string) => {
  if (!/^[A-Za-z0-9_.$:#-]+$/.test(value))
    throw new Error(`Invalid SPICE name: ${value}`);
  return value;
};

export function analysisCommand(a: AnalysisDefinition): string {
  switch (a.kind) {
    case 'op':
      return '.op';
    case 'tran': {
      const duration = positiveQuantity(a.duration, 's'),
        step = positiveQuantity(a.maxStep, 's');
      if (step > duration)
        throw new Error('Maximum step must not exceed duration.');
      return `.tran ${step} ${duration} 0 ${step}${
        a.initialConditions ? ' uic' : ''
      }`;
    }
    case 'ac':
    case 'noise': {
      const start = positiveQuantity(a.startFrequency, 'Hz'),
        stop = positiveQuantity(a.stopFrequency, 'Hz');
      if (stop <= start)
        throw new Error('Stop frequency must exceed start frequency.');
      if (
        !Number.isInteger(a.pointsPerDecade) ||
        a.pointsPerDecade < 1 ||
        a.pointsPerDecade > 10000
      )
        throw new Error('Points per decade must be between 1 and 10000.');
      const sweep = `dec ${a.pointsPerDecade} ${start} ${stop}`;
      return a.kind === 'ac'
        ? `.ac ${sweep}`
        : `.noise v(${token(a.output)},${token(a.reference)}) ${token(
            a.input,
          )} ${sweep}`;
    }
    case 'dc': {
      const start = parseQuantity(a.sweepStart),
        stop = parseQuantity(a.sweepStop),
        step = parseQuantity(a.sweepStep);
      if (
        !step ||
        (stop - start) / step <= 0 ||
        Math.abs((stop - start) / step) > 100000
      )
        throw new Error(
          'DC sweep needs a step toward stop, with at most 100000 points.',
        );
      return `.dc ${token(a.source)} ${start} ${stop} ${step}`;
    }
    case 'tf':
      return `.tf v(${token(a.output)},${token(a.reference)}) ${token(
        a.input,
      )}`;
    case 'pz':
      return `.pz ${token(a.input)} 0 ${token(a.output)} ${token(
        a.reference,
      )} vol pz`;
    default:
      throw new Error('Unsupported analysis.');
  }
}

// Decks and attached models are data, never an ngspice control script. All file
// references must name a document-owned model; native jobs use a private cwd.
export function validateSpiceText(
  text: string,
  files: Record<string, string>,
): void {
  if (text.length > 8 * 1024 * 1024 || text.includes('\0'))
    throw new Error('SPICE text exceeds its limit or contains a NUL.');
  const normalized = text.replace(/\r?\n[ \t]*\+/g, ' ');
  for (const original of normalized.split(/\r?\n/)) {
    const line = original.trim();
    if (!line || line.startsWith('*') || line.startsWith('+')) continue;
    if (
      /^\s*\.model\s+\S+\s+(?:filesource|d_source|table2d|table3d)\b|\b(?:file|filename|infile|outfile|cardfile)\s*=/i.test(
        line,
      )
    )
      throw new Error(
        'File-backed device models are not supported in this version. Use embedded model text and circuit stimuli instead.',
      );
    if (
      /^(?:\.control|\.endc|\.spiceinit|\.osdi|\.load|\.csparam|\.shell|shell\b|!)/i.test(
        line,
      )
    )
      throw new Error(
        'Control scripts, shell commands and external modules are disabled.',
      );
    if (/^\.(?:inc|include|lib)\b/i.test(line)) {
      const match =
        /^\.(?:inc|include|lib)\s+["']?([A-Za-z0-9_-]+\.(?:lib|cir|mod))["']?(?:\s+[A-Za-z0-9_-]+)?\s*$/i.exec(
          line,
        );
      if (!match || !Object.prototype.hasOwnProperty.call(files, match[1]))
        throw new Error(
          'Attach referenced model files to this Simulation sheet first.',
        );
    }
  }
}

export function buildDeck(
  netlist: NetlistData,
  setup: SimulationSetup,
): string {
  if (!netlist.symbols.length)
    throw new Error('Place and connect a circuit on a schematic sheet first.');
  const references = new Set<string>();
  for (const [, symbol] of netlist.symbols) {
    const ref = symbol.text.find((t) => t.description === 'Ref')?.value;
    if (!ref || ref.includes('?') || references.has(ref.toLowerCase()))
      throw new Error(
        `Annotate unique component references before running: ${
          ref || 'unnamed component'
        }.`,
      );
    references.add(ref.toLowerCase());
  }
  const body = writeSpice(netlist).replace(/^\* Schematics Netlist.*\n/, '');
  const missing = netlist.symbols
    .filter(
      ([, symbol]) =>
        !symbol.text.find((t) => t.description === '$$SPICE')?.value,
    )
    .map(
      ([sheet, symbol]) =>
        `${symbol.text.find((t) => t.description === 'Ref')?.value} (${sheet})`,
    );
  if (missing.length)
    throw new Error(
      `Set SPICE models for these placed components: ${missing.join(', ')}.`,
    );
  if (/NO_MODEL|<pin |<attr /.test(body))
    throw new Error(
      'Some components have missing SPICE models, pin mappings or attributes. Open their SPICE properties to correct them.',
    );
  if (/^\s*\.(?:op|tran|ac|dc|noise|tf|pz|end)\b/im.test(body))
    throw new Error(
      'Remove analysis commands and .end from component SPICE attributes; the Simulation sheet owns analysis settings.',
    );
  if (!/(?:^|\s)0(?:\s|$)/m.test(body))
    throw new Error('Connect a SPICE ground (node 0) before running.');
  if (
    setup.analysis.kind === 'ac' &&
    !/^\s*[VI]\S*\s+.*\bAC\s+\S+/im.test(body)
  )
    throw new Error(
      'Set an AC amplitude (for example AC 1) on an input source before frequency-response analysis.',
    );
  if (
    Object.values(setup.models).reduce(
      (size, text) => size + new TextEncoder().encode(text).length,
      0,
    ) >
    16 * 1024 * 1024
  )
    throw new Error('Attached models exceed 16 MiB.');
  const parameters = Object.entries(setup.parameters)
    .map(([name, value]) => `.param ${token(name)}=${parseQuantity(value)}`)
    .join('\n');
  const savedDevices = deviceSaveLine(netlist, setup);
  const deck = `TinyCAD simulation\n${parameters}\n.temp ${parseQuantity(
    setup.analysis.temperature,
  )}\n${body}\n${savedDevices ? savedDevices + '\n' : ''}${analysisCommand(setup.analysis)}\n.end\n`;
  for (const [name, content] of Object.entries(setup.models)) {
    if (!/^[A-Za-z0-9_-]+\.(?:lib|cir|mod)$/i.test(name))
      throw new Error(`Invalid attached model filename: ${name}`);
    validateSpiceText(content, setup.models);
  }
  validateSpiceText(deck, setup.models);
  return deck;
}
