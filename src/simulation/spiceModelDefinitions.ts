import type { SpiceModelPack, SpiceModelSource } from './catalogBindings';

interface Definition {
  name: string;
  lines: string[];
}

function definitions(spice: string) {
  const result = new Map<string, Definition>();
  let current: Definition;
  let depth = 0;
  for (const line of spice.split(/\r?\n/)) {
    const declaration = /^\s*\.(model|subckt)\s+(\S+)/i.exec(line);
    if (!depth && declaration) {
      current = { name: declaration[2], lines: [line] };
      result.set(current.name.toLowerCase(), current);
    } else if (depth || (current && /^\s*\+/.test(line))) {
      current.lines.push(line);
    } else {
      current = undefined;
    }
    if (declaration?.[1].toLowerCase() === 'subckt') depth++;
    if (/^\s*\.ends\b/i.test(line)) depth--;
  }
  return result;
}

// Bundled subcircuits put the called subcircuit name after the nodes and
// before any parameters. Continuation lines in these files supply parameters.
function definitionReference(line: string) {
  // A diode instance has two nodes, then the name of its model card.
  const diode = /^\s*d\S*\s+\S+\s+\S+\s+(\S+)/i.exec(line);
  if (diode) return { name: diode[1], index: diode[0].length - diode[1].length };
  if (!/^\s*x\S*\s/i.test(line)) return undefined;
  const args = line.split(/\s+[;$]|\s+params:|\s+\w+\s*=/i, 1)[0];
  const call = /\S+\s*$/.exec(args);
  return call && { name: call[0].trimEnd(), index: call.index };
}

function modelDefinitions(pack: SpiceModelPack, modelId: string) {
  const all = definitions(pack.spice);
  const used = new Map<string, Definition>();
  function add(id: string) {
    const key = id.toLowerCase();
    const definition = all.get(key);
    if (!definition || used.has(key)) return;
    used.set(key, definition);
    for (const line of definition.lines) {
      const reference = definitionReference(line);
      if (reference) add(reference.name);
    }
  }
  add(modelId);
  if (!used.size) throw new Error('The model definition is missing from its pinned SPICE pack.');
  return [...used.values()].reverse();
}

export function spiceDefinitionText(pack: SpiceModelPack, modelId: string) {
  return modelDefinitions(pack, modelId).map(({ lines }) => lines.join('\n')).join('\n\n');
}

export function customSpiceDefinition(
  pack: SpiceModelPack,
  modelId: string,
  source: SpiceModelSource,
) {
  const parts = modelDefinitions(pack, modelId);
  const names = new Map(parts.map(({ name }) => [name.toLowerCase(), localModelName(name)]));
  // Escape TinyCAD template metacharacters in the copied upstream text.
  const escape = (line: string) => line.replace(/[\\%@$?]/g, '\\$&');
  const notice = [source.url, ...pack.licenseText.trimEnd().split(/\r?\n/)]
    .map((line) => '* ' + escape(line)).join('\n');
  const text = parts.map(({ lines }) => lines.map((line, i) => {
    const match = i === 0 || /^\s*\.ends\b/i.test(line)
      ? /^\s*\.\w+\s+(\S+)/.exec(line)
      : undefined;
    const reference = definitionReference(line);
    const name = match?.[1] ?? reference?.name;
    const replacement = name && names.get(name.toLowerCase());
    if (!replacement) return escape(line);
    const start = match ? match[0].length - name.length : reference.index;
    return escape(line.slice(0, start)) + replacement + escape(line.slice(start + name.length));
  }).join('\n')).join('\n\n');
  return text + '\n\n' + notice;
}

export function localModelName(name: string) {
  return 'TC_CUSTOM_' + name + '_$(ref)';
}
