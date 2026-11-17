const PREFIX: Record<string, number> = {
  t: 1e12,
  g: 1e9,
  meg: 1e6,
  k: 1e3,
  m: 1e-3,
  u: 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
};

export function parseQuantity(text: string, unit = ''): number {
  let value = text.trim().replace(/[µμ]/g, 'u').replace(/Ω/g, 'Ohm');
  if (
    unit &&
    /[^a-zA-Z]/.test(unit) &&
    value.toLowerCase().endsWith(unit.toLowerCase())
  ) {
    value = value.slice(0, -unit.length).trim();
    unit = '';
  }
  if (/\dM$/.test(value))
    throw new Error('Use meg for mega or m for milli; bare M is ambiguous.');
  if (value.includes(',')) {
    if (/^[-+]?\d+,\d{3}(?:\D|$)/.test(value))
      throw new Error(
        'Ambiguous comma: use a decimal point without thousands separators.',
      );
    value = value.replace(',', '.');
  }
  const match =
    /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(meg|[TGMkmunpf])?\s*([a-zA-Z]*)$/i.exec(
      value,
    );
  if (!match) throw new Error(`Invalid value: ${text}`);
  const suffix = match[3].toLowerCase();
  const accepted =
    unit.toLowerCase() === 'ohm' ? ['ohm', 'ohms'] : [unit.toLowerCase()];
  if (suffix && !accepted.includes(suffix))
    throw new Error(`Expected ${unit || 'a number'}, received ${text}`);
  const prefix = match[2] === 'M' && suffix ? 'meg' : match[2]?.toLowerCase();
  const number = Number(match[1]) * (prefix ? PREFIX[prefix] : 1);
  if (!Number.isFinite(number))
    throw new Error(`Value is out of range: ${text}`);
  return number;
}

export function positiveQuantity(text: string, unit: string): number {
  const n = parseQuantity(text, unit);
  if (n <= 0) throw new Error(`${unit} must be greater than zero.`);
  return n;
}
