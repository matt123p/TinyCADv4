import { bundledSpiceCatalogs } from './spiceCatalogData';
import type { dsnDrawing } from '../model/dsnDrawing';
import { DocItemTypes, type dsnSymbol } from '../model/dsnItem';
import { updateSymbol } from '../manipulators/updateSymbol';
import {
  alternateSpiceTemplate,
  applyModelTemplate,
  BUNDLED_SPICE_SYMBOL,
  hasCustomSpiceTemplate,
  mergeDrawingModelPacks,
  modelBinding,
  nativeSpiceTemplate,
  nativeSpicePrologue,
  pinnedSpiceModelPack,
  renderNativeSpiceTemplate,
  SPICE_ALTERNATE,
  swapSpiceTemplate,
  symbolField,
  type SpiceModelPack,
  type SpiceModelSource,
  type SpiceSymbolFields,
} from './catalogBindings';
import { customSpiceDefinition, localModelName } from './spiceModelDefinitions';

interface BundledMapping {
  libraryId: string;
  nameId: number;
  symbolId: number;
  name: string;
  pinLayout: string[];
  pinsInModelOrder: string[];
  parameterAttributes?: Record<string, string>;
}

interface CatalogEntry {
  id: string;
  label?: string;
  kind: string;
  description: string;
  aliases: string[];
  source: SpiceModelSource;
  designator: string;
  terminals: { role: string; port?: string }[];
  parameterDefaults: Record<string, string>;
  compatibleComponents: BundledMapping[];
  definition?: string;
}

export interface SpiceCatalogModel
  extends Omit<CatalogEntry, 'compatibleComponents' | 'definition'> {
  packId: string;
  revision: string;
}

const catalogs: { pack: SpiceModelPack; models: CatalogEntry[]; requiresXspice?: boolean }[] = bundledSpiceCatalogs;
const entries = catalogs
  .filter(({ requiresXspice }) => !requiresXspice || process.env.TARGET_SYSTEM === 'electron')
  .flatMap(({ pack, models }) => models.map((entry) => ({ pack, entry })));
const normalize = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');
const modelName = (id: string) => id.replace(/_OJ$/i, '');

export function spiceSymbolPins(symbol: dsnSymbol) {
  const updater = new updateSymbol(symbol);
  return [...updater.active_points(), ...updater.power_pins()].map(
    ([, , pin]) => ({
      number: pin.number,
      name: pin.name,
    }),
  );
}

export type SpiceModelTarget = dsnSymbol | (SpiceSymbolFields & {
  pins: ReturnType<typeof spiceSymbolPins>;
});

function targetPins(target: SpiceModelTarget) {
  return 'pins' in target ? target.pins : spiceSymbolPins(target);
}

function bundledMapping(
  entry: CatalogEntry,
  symbol: SpiceModelTarget,
  pins = targetPins(symbol),
) {
  const identity = symbolField(symbol, BUNDLED_SPICE_SYMBOL)
    ?.split(':')
    .slice(0, 3)
    .join(':');
  return entry.compatibleComponents.find(
    (mapping) =>
      identity ===
        `${mapping.libraryId}:${mapping.nameId}:${mapping.symbolId}` &&
      mapping.pinLayout.length === pins.length &&
      mapping.pinLayout.every((number) =>
        pins.some((pin) => pin.number === number),
      ),
  );
}

export function searchSpiceModels(
  query: string,
  symbol?: SpiceModelTarget,
): SpiceCatalogModel[] {
  const needle = normalize(query);
  const bundled = symbol && symbolField(symbol, BUNDLED_SPICE_SYMBOL);
  const pins = bundled ? targetPins(symbol) : undefined;
  return entries
    .flatMap(({ pack, entry }) => {
      if (bundled && !bundledMapping(entry, symbol, pins)) return [];
      const { compatibleComponents, definition, ...fields } = entry;
      const id = normalize(modelName(entry.id));
      const aliases = entry.aliases.map(normalize);
      const rank =
        !needle || id === needle || normalize(entry.id) === needle
          ? 0
          : aliases.includes(needle)
          ? 1
          : [
              id,
              ...aliases,
              normalize(entry.kind),
              normalize(entry.label ?? ''),
              normalize(entry.description),
            ].some((value) => value.includes(needle))
          ? 2
          : -1;
      return rank < 0
        ? []
        : [
            {
              rank,
              model: { ...fields, packId: pack.id, revision: pack.revision },
            },
          ];
    })
    .sort((a, b) => a.rank - b.rank)
    .map(({ model }) => model);
}

function catalogEntry(modelId: string, packId: string, revision: string) {
  const found = entries.find(
    ({ pack, entry }) =>
      pack.id === packId && pack.revision === revision && entry.id === modelId,
  );
  if (!found)
    throw new Error(
      'Select an exact model and revision from the bundled SPICE catalog.',
    );
  return found;
}

export function catalogModelPack(model: SpiceCatalogModel) {
  return catalogEntry(model.id, model.packId, model.revision).pack;
}

const roleAliases: Record<string, string[]> = {
  collector: ['c'],
  base: ['b'],
  emitter: ['e'],
  drain: ['d'],
  gate: ['g'],
  source: ['s'],
  anode: ['a'],
  cathode: ['k'],
  'non-inverting input': ['+', 'in+'],
  'inverting input': ['-', 'in-'],
  'positive supply': ['v+'],
  'negative supply': ['v-'],
};

export function inspectSpiceModel(
  symbol: SpiceModelTarget,
  model: Pick<SpiceCatalogModel, 'id' | 'packId' | 'revision'>,
) {
  const { entry } = catalogEntry(model.id, model.packId, model.revision);
  const pins = targetPins(symbol);
  const mapping = bundledMapping(entry, symbol, pins);
  const normalizePin = (name: string) =>
    name?.toLowerCase().replace(/\s+/g, '');
  const suggestions = entry.terminals.map(({ port, role }) => {
    const names = [port, role, ...(roleAliases[role] ?? [])]
      .filter(Boolean)
      .map(normalizePin);
    const matches = pins.filter(
      ({ name }) => name && names.includes(normalizePin(name)),
    );
    return matches.length === 1 ? matches[0].number : '';
  });
  const parameters = { ...entry.parameterDefaults };
  for (const [key, attribute] of Object.entries(
    mapping?.parameterAttributes ?? {},
  )) {
    const value = symbolField(symbol, attribute);
    if (value) parameters[key] = value;
  }
  const binding = modelBinding(symbol);
  const previous =
    binding?.modelId === model.id &&
    binding.packId === model.packId &&
    binding.revision === model.revision
      ? binding
      : undefined;
  return {
    pins,
    preverified: !!mapping,
    compatible: !!mapping || !symbolField(symbol, BUNDLED_SPICE_SYMBOL),
    mapping:
      mapping?.pinsInModelOrder ??
      previous?.pins ??
      suggestions.map((pin) =>
        suggestions.filter((other) => other === pin).length === 1 ? pin : '',
      ),
    parameters: { ...parameters, ...previous?.parameters },
  };
}

export interface SpiceModelSelection {
  modelId: string;
  packId: string;
  revision: string;
  pins?: string[];
  parameters?: Record<string, string>;
  replaceExisting?: boolean;
}

export type SpiceModelChange = SpiceModelSelection | 'custom' | 'bundled';

export function spiceInstanceTemplate(
  model: Pick<SpiceCatalogModel, 'id' | 'designator' | 'parameterDefaults' | 'packId' | 'revision'>,
  pins: string[],
  parameters: Record<string, string>,
  symbol?: SpiceSymbolFields,
) {
  const { pack } = catalogEntry(model.id, model.packId, model.revision);
  const native = nativeSpiceTemplate(pack, model.id);
  if (native) return renderNativeSpiceTemplate(native.instance, native, pins, symbol);
  const overrides = Object.entries(parameters).filter(
    ([name, value]) => value !== model.parameterDefaults[name],
  );
  const suffix = overrides.length
    ? ' params: ' +
      overrides.map(([name, value]) => `${name}=${value}`).join(' ')
    : '';
  return `${model.designator}TC_$(ref) ${pins
    .map((pin) => (pin ? `%(${pin})` : '<pin>'))
    .join(' ')} ${model.id}${suffix}`;
}

export function changeSpiceModel(
  drawing: dsnDrawing,
  sheetId: string,
  symbolId: number,
  selection?: SpiceModelChange,
): dsnDrawing {
  const sheet = drawing.sheets.find(
    (candidate) => candidate.id === sheetId && candidate.kind !== 'simulation',
  );
  const symbol = sheet?.items.find(
    (item): item is dsnSymbol =>
      item.NodeName === DocItemTypes.Symbol && item._id === symbolId,
  );
  if (!symbol) throw new Error('The placed symbol is no longer available.');
  const previousBinding = modelBinding(symbol);
  let packs = drawing.spiceModelPacks ?? [];
  if (
    previousBinding &&
    selection !== 'custom' &&
    !drawing.sheets.some(({ items }) =>
      items.some((item) => {
        if (item === symbol || item.NodeName !== DocItemTypes.Symbol) return false;
        const alternate = alternateSpiceTemplate(item);
        return modelBinding(item)?.packId === previousBinding.packId
          || (alternate && modelBinding(alternate)?.packId === previousBinding.packId);
      }),
    )
  )
    packs = packs.filter(({ id }) => id !== previousBinding.packId);
  let changed: dsnSymbol;
  const attachment = selection && typeof selection !== 'string' ? bindSpiceModel(symbol, selection) : undefined;
  changed = attachment?.symbol ?? changeSpiceTemplateMode(
    symbol,
    typeof selection === 'string' ? selection : undefined,
    drawing.spiceModelPacks,
  );
  if (changed === symbol) return drawing;
  const restored = selection === 'bundled' ? modelBinding(changed) : undefined;
  const activePack = attachment?.pack ?? (restored && pinnedSpiceModelPack(restored, packs));
  if (activePack) {
    const remainingPacks = drawing.sheets.flatMap(({ items }) =>
      items.flatMap((item) => {
        if (item === symbol || item.NodeName !== DocItemTypes.Symbol) return [];
        const binding = modelBinding(item);
        const pack = binding && pinnedSpiceModelPack(binding, packs);
        return pack ? [pack] : [];
      }),
    );
    mergeDrawingModelPacks(packs, [...remainingPacks, activePack]);
    if (attachment) packs = mergeDrawingModelPacks(packs, [activePack]);
  }
  changed = new updateSymbol(changed).post_construction();
  const sheets = drawing.sheets.map((candidate) =>
    candidate === sheet
      ? {
          ...sheet,
          items: sheet.items.map((item) => (item === symbol ? changed : item)),
        }
      : candidate,
  );
  return { ...drawing, sheets, spiceModelPacks: packs };
}

export function bindSpiceModel<T extends SpiceModelTarget>(
  symbol: T,
  selection: SpiceModelSelection,
) {
  const { entry, pack } = catalogEntry(selection.modelId, selection.packId, selection.revision);
  const info = inspectSpiceModel(symbol, {
    id: entry.id,
    packId: pack.id,
    revision: pack.revision,
  });
  if (!info.compatible)
    throw new Error(
      'This model is incompatible with the bundled SPICE symbol.',
    );
  if (!selection.replaceExisting && hasCustomSpiceTemplate(symbol))
    throw new Error('Confirm replacement of the existing SPICE template.');
  const pins = info.preverified ? info.mapping : selection.pins;
  if (
    !pins ||
    pins.length !== entry.terminals.length ||
    new Set(pins).size !== pins.length ||
    pins.some(
      (pin) =>
        !/^[\w.+/-]+$/.test(pin) ||
        !info.pins.some(({ number }) => number === pin),
    )
  )
    throw new Error(
      'Map every model terminal to a different pin on the symbol.',
    );
  const parameters = { ...info.parameters, ...selection.parameters };
  for (const [key, value] of Object.entries(parameters)) {
    if (
      !Object.prototype.hasOwnProperty.call(info.parameters, key) ||
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:meg|[tgkmunpf])?$/i.test(
        value,
      )
    )
      throw new Error(`Enter a valid SPICE quantity for ${key}.`);
  }
  const template = spiceInstanceTemplate({ ...entry, packId: pack.id, revision: pack.revision }, pins, parameters, symbol);
  const changed = applyModelTemplate(
    symbol,
    {
      packId: pack.id,
      revision: pack.revision,
      modelId: entry.id,
      ...(entry.label ? { label: entry.label } : {}),
      source: entry.source,
      pins,
      parameters,
    },
    template,
  );
  return { symbol: changed, pack };
}

export function changeSpiceTemplateMode<T extends SpiceSymbolFields>(
  symbol: T,
  mode?: 'custom' | 'bundled',
  packs?: SpiceModelPack[],
): T {
  const binding = modelBinding(symbol);
  const alternate = alternateSpiceTemplate(symbol);
  const alternateBinding = alternate && modelBinding(alternate);
  if (mode === 'bundled') {
    if (binding || !alternateBinding) return symbol;
    if (!pinnedSpiceModelPack(alternateBinding, packs))
      throw new Error('The pinned SPICE model pack is missing.');
    return swapSpiceTemplate(symbol, alternate);
  }
  if (!binding) return symbol;
  if (!mode) {
    if (!alternate || alternateBinding) return applyModelTemplate(symbol);
    const restored = swapSpiceTemplate(symbol, alternate);
    return { ...restored, text: restored.text.filter((field) => field.description !== SPICE_ALTERNATE) };
  }
  const pack = pinnedSpiceModelPack(binding, packs);
  if (!pack) throw new Error('The pinned SPICE model pack is missing.');
  const next = alternate && !alternateBinding ? alternate : copyBundledModelToCustom(symbol, binding, pack);
  return swapSpiceTemplate(symbol, next);
}

function copyBundledModelToCustom<T extends SpiceSymbolFields>(
  symbol: T,
  binding: NonNullable<ReturnType<typeof modelBinding>>,
  pack: SpiceModelPack,
): T {
  const template = symbolField(symbol, '$$SPICE');
  const native = nativeSpiceTemplate(pack, binding.modelId);
  if (native) {
    let instance = template ?? '';
    let prologue = nativeSpicePrologue(symbol, [pack]) ?? '';
    const name = /\.(?:model|subckt)\s+(\w+)/i.exec(prologue)?.[1];
    if (name && !symbolField(symbol, 'Model File')) {
      const rename = (text: string) => text.replace(new RegExp(`\\b${name}\\b`, 'gi'), localModelName(name));
      instance = rename(instance.replace(/\$\((Model(?: Name)?)\)/g, (macro, attribute) =>
        (symbolField(symbol, attribute) ?? native.attributes[attribute]) === name ? name : macro,
      ));
      prologue = rename(prologue);
    }
    return applyModelTemplate(symbol, undefined, instance, prologue);
  }
  const prefix = template?.indexOf(` ${binding.modelId}`) ?? -1;
  if (prefix < 0) throw new Error('The bundled SPICE instance template is invalid.');
  const localTemplate = template.slice(0, prefix + 1) + localModelName(binding.modelId)
    + template.slice(prefix + 1 + binding.modelId.length);
  return applyModelTemplate(
    symbol,
    undefined,
    localTemplate,
    customSpiceDefinition(pack, binding.modelId, binding.source),
  );
}
