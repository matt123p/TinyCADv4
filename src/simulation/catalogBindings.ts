import type { dsnDrawing } from '../model/dsnDrawing';
import type { dsnSymbol, SymbolTextItem } from '../model/dsnItem';
import type { NetlistData } from '../io/netlists/netlistGenerator';
import { TextDisplayMethod, type tclibLibraryEntry } from '../model/tclib';
import { bundledSpicePacks } from './spiceCatalogData';

export const BUNDLED_SPICE_SYMBOL = '$$BUNDLED_SPICE_SYMBOL';
export const MODEL_BINDING = '$$CATALOG_MODEL';
export const SPICE_ALTERNATE = '$$SPICE_ALTERNATE';
const TEMPLATE_FIELDS = ['$$SPICE', '$$SPICE_PROLOG', '$$SPICE_EPILOG'];
const SWITCHED_FIELDS = new Set([
  ...TEMPLATE_FIELDS, '$$SPICE_PROLOG_PRIORITY', '$$SPICE_EPILOG_PRIORITY', MODEL_BINDING,
]);
const maxPackBytes = 16 * 1024 * 1024;

export interface SpiceModelSource {
  name: string;
  revision: string;
  url: string;
  archiveMember?: string;
}

export interface SpiceModelPack {
  id: string;
  revision: string;
  filename: string;
  sha256: string;
  license: string;
  licenseText: string;
  spice: string;
  format?: 'templates';
}

export interface SpiceModelBinding {
  packId: string;
  revision: string;
  modelId: string;
  label?: string;
  source: SpiceModelSource;
  pins: string[];
  parameters: Record<string, string>;
  previous: SymbolTextItem[];
  /** Legacy TCLib bindings may contain the pinned pack. */
  embeddedPack?: SpiceModelPack;
}

export type SpiceSymbolFields = Pick<dsnSymbol, 'text'>;

export interface NativeSpiceTemplate {
  instance: string;
  prologue: string;
  templatePins: string[];
  attributes: Record<string, string>;
}

const nativeTemplates = new WeakMap<SpiceModelPack, Record<string, NativeSpiceTemplate>>();

export function nativeSpiceTemplate(pack: SpiceModelPack, modelId: string): NativeSpiceTemplate | undefined {
  if (pack.format !== 'templates') return;
  let templates = nativeTemplates.get(pack);
  if (!templates) {
    templates = JSON.parse(pack.spice);
    nativeTemplates.set(pack, templates);
  }
  return Object.hasOwn(templates, modelId) ? templates[modelId] : undefined;
}

export function renderNativeSpiceTemplate(
  text: string,
  model: NativeSpiceTemplate,
  pins: string[],
  symbol?: SpiceSymbolFields,
) {
  const mapped = new Map(model.templatePins.map((pin, index) => [pin, pins[index]]));
  return text.replace(/%\(([^)]+)\)/g, (macro, pin) =>
    !mapped.has(pin) ? macro : mapped.get(pin) ? '%(' + mapped.get(pin) + ')' : '<pin>',
  ).replace(/\$\(([^)]+)\)/g, (macro, attribute) =>
    symbol && symbolField(symbol, attribute) === undefined && Object.hasOwn(model.attributes, attribute)
      ? model.attributes[attribute]
      : macro,
  );
}

export function symbolField(
  symbol: SpiceSymbolFields,
  name: string,
): string | undefined {
  return symbol.text.find((field) => field.description === name)?.value;
}

export function bundledSpiceIdentity(
  nameId: number,
  symbolId: number,
  value: (field: string) => string | undefined,
) {
  return `spice:${nameId}:${symbolId}:${templateFingerprint(value)}`;
}

export function withBundledSpiceIdentity(
  entry: tclibLibraryEntry,
): tclibLibraryEntry {
  if (entry.Attributes.some(({ AttName }) => AttName === BUNDLED_SPICE_SYMBOL))
    return entry;
  return {
    ...entry,
    Attributes: [
      ...entry.Attributes,
      {
        AttName: BUNDLED_SPICE_SYMBOL,
        AttValue: bundledSpiceIdentity(
          entry.NameID,
          entry.SymbolID,
          (field) =>
            entry.Attributes.find(({ AttName }) => AttName === field)?.AttValue,
        ),
        ShowAtt: TextDisplayMethod.NeverShow,
      },
    ],
  };
}

function templateFingerprint(value: (field: string) => string | undefined) {
  const text = TEMPLATE_FIELDS.map((field) =>
    (value(field) ?? '').replace(/\r\n/g, '\n'),
  ).join('\0');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

export function hasCustomSpiceTemplate(symbol: SpiceSymbolFields) {
  if (
    modelBinding(symbol) ||
    !TEMPLATE_FIELDS.some((field) => symbolField(symbol, field))
  )
    return false;
  const fingerprint = symbolField(symbol, BUNDLED_SPICE_SYMBOL)?.split(':')[3];
  return (
    fingerprint !== templateFingerprint((field) => symbolField(symbol, field))
  );
}

export function modelBinding(symbol: SpiceSymbolFields): SpiceModelBinding | undefined {
  const field = symbolField(symbol, MODEL_BINDING);
  if (!field) return;
  try {
    const binding = JSON.parse(field) as SpiceModelBinding;
    if (
      binding &&
      typeof binding.packId === 'string' &&
      typeof binding.revision === 'string' &&
      typeof binding.modelId === 'string' &&
      typeof binding.source?.url === 'string' &&
      Array.isArray(binding.pins) &&
      binding.pins.every((pin) => typeof pin === 'string') &&
      binding.parameters &&
      typeof binding.parameters === 'object' &&
      Array.isArray(binding.previous) &&
      binding.previous.every(
        (entry) =>
          entry &&
          TEMPLATE_FIELDS.includes(entry.description) &&
          typeof entry.value === 'string' &&
          Array.isArray(entry.position) &&
          entry.position.length === 2,
      )
    )
      return binding;
  } catch {
    // Legacy or manually authored fields are left intact.
  }
}

function hidden(description: string, value: string): SymbolTextItem {
  return { description, value, show: false, display: TextDisplayMethod.NeverShow, position: [0, 0] };
}

export function alternateSpiceTemplate(symbol: SpiceSymbolFields): SpiceSymbolFields | undefined {
  const saved = symbolField(symbol, SPICE_ALTERNATE);
  if (!saved) return;
  try {
    const text: SymbolTextItem[] = JSON.parse(saved);
    if (Array.isArray(text) && text.every((field) =>
      field && SWITCHED_FIELDS.has(field.description) && typeof field.value === 'string' &&
      Array.isArray(field.position) && field.position.length === 2,
    )) return { text };
  } catch {
    // Ignore unrecognised alternate templates.
  }
}

export function swapSpiceTemplate<T extends SpiceSymbolFields>(
  symbol: T,
  next: SpiceSymbolFields,
): T {
  const saved = symbol.text.filter((field) => SWITCHED_FIELDS.has(field.description));
  return {
    ...symbol,
    text: [
      ...symbol.text.filter((field) => !SWITCHED_FIELDS.has(field.description) && field.description !== SPICE_ALTERNATE),
      ...next.text.filter((field) => SWITCHED_FIELDS.has(field.description)),
      hidden(SPICE_ALTERNATE, JSON.stringify(saved)),
    ],
  };
}

export function applyModelTemplate<T extends SpiceSymbolFields>(
  symbol: T,
  binding?: Omit<SpiceModelBinding, 'previous'>,
  template?: string,
  prologue?: string,
): T {
  const existing = modelBinding(symbol);
  const previous =
    existing?.previous ??
    symbol.text.filter((field) => TEMPLATE_FIELDS.includes(field.description));
  const text = symbol.text.filter(
    (field) =>
      !TEMPLATE_FIELDS.includes(field.description) &&
      field.description !== MODEL_BINDING && field.description !== SPICE_ALTERNATE,
  );
  return {
    ...symbol,
    text: binding
      ? [
          ...text,
          hidden('$$SPICE', template),
          hidden(MODEL_BINDING, JSON.stringify({ ...binding, previous })),
        ]
      : prologue !== undefined
        ? [...text, hidden('$$SPICE', template), hidden('$$SPICE_PROLOG', prologue)]
        : [...text, ...previous],
  };
}

export function parseSpiceModelPacks(text: string): SpiceModelPack[] {
  if (text.length > maxPackBytes)
    throw new Error('Embedded SPICE model packs exceed their limit.');
  const packs = JSON.parse(text);
  if (!Array.isArray(packs) || packs.length > 128)
    throw new Error('Invalid SPICE model packs.');
  const ids = new Set<string>();
  let bytes = 0;
  for (const pack of packs) {
    if (
      !pack ||
      typeof pack !== 'object' ||
      ![
        'id',
        'revision',
        'filename',
        'sha256',
        'license',
        'licenseText',
        'spice',
      ].every((key) => typeof pack[key] === 'string') ||
      !/^[a-z0-9_-]+$/i.test(pack.id) ||
      !/^[a-f0-9]{64}$/i.test(pack.sha256) ||
      !/^[\w-]+\.lib$/i.test(pack.filename) ||
      (pack.format !== undefined && pack.format !== 'templates') ||
      ids.has(pack.id)
    )
      throw new Error('Invalid or duplicate embedded SPICE model pack.');
    ids.add(pack.id);
    bytes += new TextEncoder().encode(pack.spice + pack.licenseText).length;
  }
  if (bytes > maxPackBytes)
    throw new Error('Embedded SPICE model packs exceed their limit.');
  return packs;
}

export function pinnedSpiceModelPack(binding: SpiceModelBinding, packs: SpiceModelPack[] = []) {
  const stored = packs.find(
    (pack) => pack.id === binding.packId && pack.revision === binding.revision,
  );
  const embedded = binding.embeddedPack;
  if (!embedded) return stored ?? bundledSpicePacks.find(
    (pack) => pack.id === binding.packId && pack.revision === binding.revision,
  );
  if (embedded.id !== binding.packId || embedded.revision !== binding.revision)
    throw new Error('Invalid embedded SPICE pack for the selected symbol.');
  parseSpiceModelPacks(JSON.stringify([embedded]));
  return mergeDrawingModelPacks(stored ? [stored] : [], [embedded])[0];
}

export function referencedSpiceModelPacks(
  netlist: Pick<NetlistData, 'symbols'>,
  packs: dsnDrawing['spiceModelPacks'] = [],
  includeInactive = false,
): SpiceModelPack[] {
  let used: SpiceModelPack[] = [];
  for (const [, symbol] of netlist.symbols) {
    const alternate = includeInactive && alternateSpiceTemplate(symbol);
    const inactive = alternate && modelBinding(alternate);
    for (const binding of [modelBinding(symbol), inactive && !inactive.embeddedPack && inactive]) {
      if (!binding) continue;
      const pack = pinnedSpiceModelPack(binding, packs);
      if (!pack) {
        if (includeInactive) continue;
        throw new Error(
          `Missing ${binding.packId} model pack for ${symbolField(symbol, 'Ref') ?? binding.modelId}.`,
        );
      }
      if (includeInactive && [...packs, ...used].some((stored) =>
        stored.id === pack.id && stored.revision !== pack.revision,
      )) continue;
      const existing = used.find((candidate) => candidate.filename.toLowerCase() === pack.filename.toLowerCase());
      if (existing && existing.id !== pack.id)
        throw new Error(`Conflicting SPICE model file ${pack.filename}.`);
      used = mergeDrawingModelPacks(used, [pack]);
    }
  }
  return used.sort((a, b) =>
    a.filename.localeCompare(b.filename),
  );
}

export function activeSpiceModelPacks(
  netlist: Pick<NetlistData, 'symbols'>,
  packs: SpiceModelPack[] = [],
) {
  return referencedSpiceModelPacks(netlist, packs).filter((pack) => !pack.format);
}

export function nativeSpicePrologue(symbol: SpiceSymbolFields, packs?: SpiceModelPack[]) {
  const binding = modelBinding(symbol);
  const pack = binding && pinnedSpiceModelPack(binding, packs);
  const template = pack && nativeSpiceTemplate(pack, binding.modelId);
  return template && renderNativeSpiceTemplate(template.prologue, template, binding.pins, symbol);
}

export function mergeSpiceModelFiles(
  packs: SpiceModelPack[],
  custom: Record<string, string>,
) {
  const models = { ...custom };
  for (const pack of packs) {
    const existing = Object.keys(models).find(
      (filename) => filename.toLowerCase() === pack.filename.toLowerCase(),
    );
    if (
      existing &&
      (existing !== pack.filename || models[existing] !== pack.spice)
    )
      throw new Error(`Conflicting SPICE model file ${pack.filename}.`);
    models[pack.filename] = pack.spice;
  }
  return models;
}

export function mergeDrawingModelPacks(
  existing: SpiceModelPack[] = [],
  added: SpiceModelPack[] = [],
): SpiceModelPack[] {
  const result = [...existing];
  for (const pack of added) {
    const previous = result.find((candidate) => candidate.id === pack.id);
    if (
      previous &&
      (previous.revision !== pack.revision ||
        previous.sha256 !== pack.sha256 ||
        previous.spice !== pack.spice)
    )
      throw new Error(
        `This drawing already contains another revision of ${pack.id}.`,
      );
    if (!previous) result.push(pack);
  }
  return result.length === existing.length ? existing : result;
}

export function checkCatalogDefinitions(
  packs: SpiceModelPack[],
  otherText: string[],
) {
  const symbols = (text: string) => {
    let depth = 0;
    const names: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*\.(model|subckt|ends)\b\s*(\S*)/i.exec(line);
      if (!match) continue;
      const directive = match[1].toLowerCase();
      if (directive === 'ends') depth = Math.max(0, depth - 1);
      else {
        if (depth === 0) names.push(match[2].toLowerCase());
        if (directive === 'subckt') depth++;
      }
    }
    return names;
  };
  if (!packs.length) return;
  const existing = new Set(otherText.flatMap(symbols));
  for (const pack of packs)
    for (const name of symbols(pack.spice)) {
      if (existing.has(name))
        throw new Error(`Duplicate SPICE model or subcircuit ${name}.`);
      existing.add(name);
    }
}
