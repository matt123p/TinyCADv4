const name = /^[A-Za-z0-9_.$:#-]+$/;
const voltage = (node) => {
  if (!name.test(node)) throw new Error(`Invalid saved SPICE node: ${node}`);
  return `v(${node})`;
};

/**
 * Save the schematic interface instead of every node inside component models.
 * @param {string} body Expanded component netlist, without the analysis.
 * @param {string[]} nodes Schematic node names used by the exporter.
 * @param {string[]} signals Explicitly selected extra signals.
 * @param {string[]} deviceVectors Requested device-current/power vectors.
 */
export function circuitSaveLine(body, nodes, signals = [], deviceVectors = []) {
  const vectors = new Set();
  const referenced = new Set();
  let depth = 0;
  for (const original of body.split(/\r?\n/)) {
    const line = original.trim();
    if (/^\.subckt\b/i.test(line)) {
      depth++;
      continue;
    }
    if (/^\.ends\b/i.test(line)) {
      depth--;
      continue;
    }
    if (depth || !line || /^[*.+]/.test(line)) continue;
    for (const token of line.match(/[A-Za-z0-9_.$:#-]+/g) || [])
      referenced.add(token.toLowerCase());
    const [ref, positive] = line.split(/\s+/);
    // Source/inductor branch currents include native current probes and the
    // multimeter/supply sense sources. Subcircuit-private branches stay private.
    if (/^[VELH]/i.test(ref) && name.test(ref)) vectors.add(`i(${ref})`);
    // The logger's deliberately exposed recorded signal is part of its API.
    if (/^B\S+_record$/i.test(ref) && positive?.endsWith('_record'))
      vectors.add(voltage(positive));
  }
  // Native instrument resizing can leave stale nets with no solver node.
  for (const node of nodes)
    if (node !== '0' && referenced.has(node.toLowerCase()))
      vectors.add(voltage(node));
  for (const signal of signals) {
    if (['time', 'frequency'].includes(signal.toLowerCase())) continue;
    if (name.test(signal)) {
      if (signal.endsWith('#branch')) vectors.add(`i(${signal.slice(0, -7)})`);
      else if (signal !== '0') vectors.add(voltage(signal));
    } else if (
      /^[vi]\([A-Za-z0-9_.$:#-]+\)$/i.test(signal) ||
      /^@[A-Za-z0-9_.$:#-]+\[[A-Za-z0-9_]+\]$/.test(signal)
    ) {
      vectors.add(signal);
    }
  }
  for (const signal of deviceVectors) vectors.add(signal);
  return vectors.size ? '.save ' + [...vectors].join(' ') : '';
}
