import md5 from 'md5';
import { TextDisplayMethod } from '../../model/tclib';
import { validateSpiceText } from '../../simulation/deck';
import { decodeKicadEmbeddedModel, maxKicadModelBytes } from './kicadEmbeddedFiles';
import type { KiSymbol } from './kicadTypes';

const embeddedPrefix = 'kicad-embed://';
const quantity = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:meg|mil|[tgkmunpf])?$/i;
const pinNumber = /^[\w.+/-]+$/;
const modelToken = /^[\w.+:$-]+$/;

const primitives: Record<string, { prefix: string; pins: string[]; instance: string[] }> = {
  D: { prefix: 'D', pins: ['A', 'K'], instance: ['area', 'pj', 'w', 'l'] },
  NPN: { prefix: 'Q', pins: ['C', 'B', 'E'], instance: ['area', 'areac', 'areab'] },
  PNP: { prefix: 'Q', pins: ['C', 'B', 'E'], instance: ['area', 'areac', 'areab'] },
  NJF: { prefix: 'J', pins: ['D', 'G', 'S'], instance: ['area', 'ic'] },
  PJF: { prefix: 'J', pins: ['D', 'G', 'S'], instance: ['area', 'ic'] },
  NMOS: { prefix: 'M', pins: ['D', 'G', 'S', 'B'], instance: ['l', 'w', 'ad', 'as', 'pd', 'ps', 'nrd', 'nrs', 'nf', 'ic'] },
  PMOS: { prefix: 'M', pins: ['D', 'G', 'S', 'B'], instance: ['l', 'w', 'ad', 'as', 'pd', 'ps', 'nrd', 'nrs', 'nf', 'ic'] },
  VDMOS: { prefix: 'M', pins: ['D', 'G', 'S'], instance: ['area', 'l', 'w'] },
  SW: { prefix: 'S', pins: ['1', '2', '+', '-'], instance: [] },
};

function field(symbol: KiSymbol, key: string) {
  return symbol.properties.find((property) => property.key.toLowerCase() === key.toLowerCase())?.value.trim();
}

function spiceValue(value: string) {
  const normalized = value.replace(/[µμ]/g, 'u');
  const rkm = /^([+-]?\d*)([RrKMkmunpf])(\d+)$/.exec(normalized);
  if (rkm) {
    const [, integer, unit, fraction] = rkm;
    const suffix = /r/i.test(unit) ? '' : unit === 'M' ? 'Meg' : unit.toLowerCase();
    return integer + '.' + fraction + suffix;
  }
  // KiCad uses SI suffixes for symbol parameters, where M denotes mega.
  return quantity.test(normalized) && normalized.endsWith('M')
    ? normalized.slice(0, -1) + 'Meg' : normalized;
}

function assignments(text: string) {
  const tokens = /([A-Za-z_]\w*)\s*=\s*("[^"]+"|'[^']+'|\{[^{}]+\}|[^\s]+)/gy;
  const result = new Map<string, string>();
  let rest = text.trim();
  while (rest) {
    tokens.lastIndex = 0;
    const match = tokens.exec(rest);
    if (!match) throw new Error('Unsupported KiCad simulation parameter.');
    const value = spiceValue(match[2].replace(/^"(.*)"$/, '$1'));
    if (!/^[\w.,+\-*/^()[\]{}'<>!=?:&| \t]+$/.test(value))
      throw new Error('Unsupported KiCad simulation parameter.');
    result.set(match[1].toLowerCase(), value);
    rest = rest.slice(tokens.lastIndex).trimStart();
  }
  return result;
}

function mappedPins(symbol: KiSymbol, available: string[], terminals: string[]) {
  const raw = field(symbol, 'Sim.Pins');
  let pins: string[];
  if (raw) {
    const mapped = new Map<number, string>();
    for (const pair of raw.split(/\s+/)) {
      const [physical, terminal, extra] = pair.split('=');
      if (!physical || !terminal || extra !== undefined) throw new Error('Invalid KiCad SPICE pin mapping.');
      if (terminal === '~') continue;
      const byName = terminals.findIndex((name) => name.toLowerCase() === terminal.toLowerCase());
      const index = byName >= 0 ? byName : /^\d+$/.test(terminal) ? Number(terminal) - 1 : -1;
      if (index < 0 || index >= terminals.length || mapped.has(index))
        throw new Error('KiCad SPICE terminal mapping is ambiguous.');
      mapped.set(index, physical);
    }
    pins = terminals.map((_, index) => mapped.get(index));
  } else {
    // With no override KiCad assigns symbol pins in natural pin-number order.
    pins = [...available].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).slice(0, terminals.length);
  }
  if (pins.length !== terminals.length || new Set(pins).size !== pins.length ||
    pins.some((pin) => !pin || !pinNumber.test(pin) || !available.includes(pin)))
    throw new Error('KiCad SPICE model requires a complete symbol pin mapping.');
  return pins.map((pin) => '%(' + pin + ')');
}

interface ModelStatement {
  form: 'model' | 'subckt';
  declaration: string;
  start: number;
  end: number;
}

function modelStatements(lines: string[]) {
  const result = new Map<string, ModelStatement>();
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\.ends\b/i.test(lines[i])) {
      if (!depth--) throw new Error('Unmatched SPICE .ends.');
      continue;
    }
    const match = /^\s*\.(subckt|model)\s+(\S+)(?:\s+(.*))?$/i.exec(lines[i]);
    if (!match) {
      const directive = /^\s*\.(\w+)/.exec(lines[i])?.[1].toLowerCase();
      if (directive && !['param', 'func', ...(depth ? ['if', 'elseif', 'else', 'endif'] : [])].includes(directive))
        throw new Error('Unsupported SPICE model directive .' + directive + '.');
      if (!depth && !directive && !/^\s*(?:$|\*|\+)/.test(lines[i]))
        throw new Error('Unsupported top-level statement in the SPICE model file.');
      continue;
    }
    const form = match[1].toLowerCase() as ModelStatement['form'];
    const atTop = depth === 0;
    if (form === 'subckt') depth++;
    let end = i;
    let declaration = (match[3] ?? '').replace(/\s+[$;].*$/, '');
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*(?:\*|$)/.test(lines[j])) continue;
      if (!/^\s*\+/.test(lines[j])) break;
      declaration += ' ' + lines[j].replace(/^\s*\+|\s+[$;].*$/g, '');
      end = j;
    }
    if (atTop) {
      const key = match[2].toLowerCase();
      if (result.has(key)) throw new Error('Duplicate SPICE model name ' + match[2] + '.');
      result.set(key, { form, declaration, start: i, end });
    }
    i = end;
  }
  if (depth) throw new Error('Unterminated SPICE subcircuit.');
  return result;
}

export function kicadModelFiles(
  root: ReadonlyMap<string, string>,
  companions: ReadonlyMap<string, string>,
) {
  const decoded = new Map<string, string>();
  let cachedSize = 0;
  function expand(file: string, local: ReadonlyMap<string, string>, included: Set<string>,
    budget: { used: number }, depth = 0): string {
    if (depth > 24) throw new Error('KiCad SPICE includes are nested too deeply.');
    const isEmbedded = file.startsWith(embeddedPrefix);
    const name = file.replaceAll('\\', '/').split('/').at(-1);
    const embedded = local?.get(name) ?? root?.get(name);
    const payload = isEmbedded || depth ? embedded : undefined;
    const external = !isEmbedded && payload === undefined ? companions?.get(name.toLowerCase()) : undefined;
    if (payload === undefined && external === undefined)
      throw new Error('SPICE file ' + name + ' is missing. Select it with the KiCad library or embed it in KiCad.');

    const key = payload === undefined ? 'external:' + name.toLowerCase() : 'embedded:' + name;
    if (included.has(key)) throw new Error('Circular or repeated SPICE include for ' + name + '.');
    included.add(key);
    let text = external;
    if (payload !== undefined) {
      text = decoded.get(payload);
      if (text === undefined) {
        text = decodeKicadEmbeddedModel(payload);
        if (cachedSize + text.length <= 4 * maxKicadModelBytes) {
          decoded.set(payload, text);
          cachedSize += text.length;
        }
      }
    }
    budget.used += text.length;
    if (budget.used > maxKicadModelBytes) throw new Error('KiCad SPICE model and includes exceed 8 MiB.');
    return text.replace(/\r\n?/g, '\n').split('\n').map((line) => {
      if (/^\s*\.end(?:\s+[$;].*)?\s*$/i.test(line)) return '';
      const include = /^\s*\.inc(?:lude)?\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))\s*(?:[$;].*)?$/i.exec(line);
      if (!include) return line;
      return expand(include[1] ?? include[2] ?? include[3], local, included, budget, depth + 1);
    }).join('\n');
  }
  return (file: string, local: ReadonlyMap<string, string>) => expand(file, local, new Set(), { used: 0 });
}

function spiceFields(instance: string, prologue?: string) {
  return [
    { AttName: '$$SPICE', AttValue: instance, ShowAtt: TextDisplayMethod.NeverShow },
    ...(prologue === undefined ? [] : [
      { AttName: '$$SPICE_PROLOG', AttValue: prologue.replace(/[\\%@$?]/g, '\\$&'), ShowAtt: TextDisplayMethod.NeverShow },
    ]),
  ];
}

export function importKicadSpice(
  symbol: KiSymbol,
  pinUnits: string[][],
  readModel: ReturnType<typeof kicadModelFiles>,
) {
  const library = field(symbol, 'Sim.Library');
  const device = field(symbol, 'Sim.Device')?.toUpperCase();
  const rawParams = field(symbol, 'Sim.Params') ?? '';
  if (!library && !device) {
    if (field(symbol, 'Spice_Model') || field(symbol, 'Spice_Lib_File'))
      throw new Error('Open and save this legacy simulation model in a recent KiCad version before importing.');
    return [];
  }
  if (pinUnits.length !== 1) throw new Error('KiCad SPICE models spanning multiple symbol units are not supported.');
  const params = assignments(rawParams);
  if (!library) {
    if (!['R', 'C', 'L', 'V', 'I'].includes(device) ||
      !['', 'IDEAL', ...(device === 'V' || device === 'I' ? ['DC'] : [])].includes(field(symbol, 'Sim.Type')?.toUpperCase() ?? ''))
      throw new Error('This built-in KiCad SPICE device type is not supported.');
    const key = device === 'V' || device === 'I' ? 'dc' : device.toLowerCase();
    const value = params.get(key) ?? spiceValue(field(symbol, 'Value') ?? '');
    if (params.size > Number(params.has(key)) || !value || !quantity.test(value))
      throw new Error('This built-in KiCad device requires a single numeric SPICE value.');
    const pins = mappedPins(symbol, pinUnits[0], ['+', '-']);
    return spiceFields(device + 'TC_$(ref) ' + pins.join(' ') + ' ' + value);
  }

  const name = field(symbol, 'Sim.Name');
  if (!name || !modelToken.test(name)) throw new Error('The KiCad symbol has no supported SPICE model name.');
  const text = readModel(library, symbol.embeddedFiles);
  validateSpiceText(text, {});
  const lines = text.split('\n');
  const statement = modelStatements(lines).get(name.toLowerCase());
  if (!statement) throw new Error('SPICE model ' + name + ' was not found in the supplied file.');

  const declaration = statement.declaration.trim();
  let terminals: string[];
  let inner: string;
  if (statement.form === 'subckt') {
    terminals = declaration.split(/\s+params:|\s+\w+\s*=/i, 1)[0].split(/\s+/).filter(Boolean);
    inner = 'Xdevice';
  } else {
    const [, type, modelParams] = /^(\w+)\s*(.*)$/.exec(declaration) ?? [];
    const primitive = Object.hasOwn(primitives, type?.toUpperCase()) && primitives[type.toUpperCase()];
    if (!primitive) throw new Error('Unsupported SPICE model type ' + (type ?? '') + '.');
    terminals = primitive.pins;
    inner = primitive.prefix + 'device';

    const overrides = [...params].filter(([key]) => !['m', 'temp', 'dtemp', ...primitive.instance].includes(key));
    if (overrides.length) {
      let body = modelParams.trim();
      if (body.startsWith('(') && body.endsWith(')')) body = body.slice(1, -1);
      lines.splice(statement.start, statement.end - statement.start + 1,
        '.model ' + name + ' ' + type + '(' + body + ' ' +
        overrides.map(([key, value]) => key + '=' + value).join(' ') + ')');
      for (const [key] of overrides) params.delete(key);
    }
  }

  if (!terminals.length) throw new Error('The KiCad SPICE model has no exposed terminals.');
  const pins = mappedPins(symbol, pinUnits[0], terminals);
  const nodes = terminals.map((_, index) => 'p' + (index + 1)).join(' ');
  const parameterValues = [...params].map(([key, value]) => key + '=' + value).join(' ');
  const call = [inner, nodes, name, parameterValues].filter(Boolean).join(' ');
  // Scope names from each vendor file to this wrapper. Symbols using the same
  // model and overrides share the same wrapper in TinyCAD's SPICE prologue.
  const content = lines.join('\n').trim() + '\n' + call;
  const local = 'TC_KICAD_' + md5(content);
  const prologue = '.subckt ' + local + ' ' + nodes + '\n' + content + '\n.ends ' + local;
  validateSpiceText(prologue, {});
  return spiceFields('XTC_$(ref) ' + pins.join(' ') + ' ' + local, prologue);
}
