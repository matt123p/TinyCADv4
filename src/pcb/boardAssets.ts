import { isEntityId } from '../model/schematicIdentity';
import { validatePadMap } from './footprint';
import type {
  FootprintPad,
  FootprintPlacement,
  PadAssignment,
} from './footprint';
import { isBoardPoint } from './geometry';
import { validatePadStack } from './padstack';
import type { PadStack } from './padstack';
import { validateFootprintDetails } from './footprintDetails';
import type { FootprintGraphic, FootprintModel } from './footprintDetails';

export interface CircuitSource {
  readonly documentId: string;
  readonly revision: number;
  readonly connectivityDigest: string;
}

const graphicRoles = [
  'mask',
  'paste',
  'silk',
  'fabrication',
  'courtyard',
  'assembly',
  'documentation',
] as const;

export interface GraphicLayer {
  readonly id: string;
  readonly role: (typeof graphicRoles)[number];
  readonly side: 'top' | 'bottom' | 'none';
  readonly name: string;
}

export interface EmbeddedFootprint {
  readonly id: string;
  readonly revision: string;
  readonly definitionDigest: string;
  readonly name: string;
  readonly pads: readonly (FootprintPad & { readonly stack?: PadStack })[];
  readonly graphics?: readonly FootprintGraphic[];
  readonly models?: readonly FootprintModel[];
}

export interface EmbeddedDevice {
  readonly id: string;
  readonly revision: string;
  readonly definitionDigest: string;
  readonly packageName: string;
  readonly packageSource: string;
  readonly footprintId: string;
  readonly signalIds: readonly string[];
  readonly assignments: readonly PadAssignment[];
}

export interface BoardFootprint extends FootprintPlacement {
  readonly id: string;
  readonly deviceId: string;
  readonly componentId: string;
  readonly locked: boolean;
}

export interface BoardAssets {
  readonly sourceCircuit?: CircuitSource;
  readonly graphicLayers?: readonly GraphicLayer[];
  readonly footprintDefinitions?: readonly EmbeddedFootprint[];
  readonly deviceDefinitions?: readonly EmbeddedDevice[];
  readonly footprints?: readonly BoardFootprint[];
}

const isText = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim();
const isDigest = (value: unknown): boolean =>
  typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);

function byId<T extends { readonly id: string }>(
  items: readonly T[],
  label: string,
): Map<string, T> {
  if (!Array.isArray(items) || items.length > 10_000)
    throw new Error(`Invalid ${label} collection.`);
  const map = new Map<string, T>();
  for (const item of items) {
    if (!isEntityId(item?.id) || map.has(item.id.toLowerCase()))
      throw new Error(`Invalid or duplicate ${label} ID.`);
    map.set(item.id.toLowerCase(), item);
  }
  return map;
}

export function validateBoardAssets(
  board: BoardAssets,
  features: readonly string[],
): void {
  const {
    sourceCircuit,
    graphicLayers,
    footprintDefinitions,
    deviceDefinitions,
    footprints,
  } = board;
  if (
    sourceCircuit !== undefined &&
    (!isEntityId(sourceCircuit?.documentId) ||
      !Number.isSafeInteger(sourceCircuit.revision) ||
      sourceCircuit.revision < 0 ||
      !isDigest(sourceCircuit.connectivityDigest))
  ) {
    throw new Error(
      'Invalid source circuit identity, revision, or connectivity digest.',
    );
  }
  if (graphicLayers !== undefined) {
    for (const layer of byId(graphicLayers, 'graphic layer').values()) {
      if (
        !graphicRoles.includes(layer.role) ||
        !['top', 'bottom', 'none'].includes(layer.side) ||
        !isText(layer.name) ||
        (layer.side === 'none' && layer.role !== 'documentation')
      )
        throw new Error('Invalid graphic layer role, side, or name.');
    }
  }
  const hasAssets = [footprintDefinitions, deviceDefinitions, footprints].some(
    (value) => value !== undefined,
  );
  if (hasAssets !== features.includes('embedded-devices'))
    throw new Error(
      'Embedded devices must declare the embedded-devices feature.',
    );
  if (!hasAssets) {
    if (features.includes('physical-padstacks'))
      throw new Error('Physical padstacks need embedded devices.');
    return;
  }

  const definitions = byId(footprintDefinitions, 'footprint definition');
  let hasPadstacks = false;
  for (const definition of definitions.values()) {
    validateEmbeddedFootprint(definition);
    hasPadstacks ||= definition.pads.some((pad) => pad.stack !== undefined);
  }
  if (hasPadstacks !== features.includes('physical-padstacks')) {
    throw new Error(
      'Explicit padstacks must declare the physical-padstacks feature.',
    );
  }
  const devices = byId(deviceDefinitions, 'device definition');
  for (const device of devices.values()) {
    const definition =
      isEntityId(device.footprintId) &&
      definitions.get(device.footprintId.toLowerCase());
    if (
      !definition ||
      !isText(device.revision) ||
      !isDigest(device.definitionDigest) ||
      !isText(device.packageName) ||
      !isText(device.packageSource) ||
      !Array.isArray(device.signalIds) ||
      !device.signalIds.every(isEntityId) ||
      !Array.isArray(device.assignments) ||
      !device.assignments.every((entry) => isEntityId(entry?.padId))
    ) {
      throw new Error('Invalid embedded device definition.');
    }
    const issues = validatePadMap(
      device.signalIds,
      definition.pads,
      device.assignments,
    );
    if (issues.length) throw new Error(`Invalid device mapping: ${issues[0]}`);
  }
  const components = new Set<string>();
  for (const instance of byId(footprints, 'footprint instance').values()) {
    if (
      !isEntityId(instance.deviceId) ||
      !devices.has(instance.deviceId.toLowerCase()) ||
      !isEntityId(instance.componentId) ||
      components.has(instance.componentId.toLowerCase()) ||
      !isBoardPoint(instance.positionNm) ||
      !Number.isSafeInteger(instance.rotationMicrodegree) ||
      instance.rotationMicrodegree < 0 ||
      instance.rotationMicrodegree >= 360_000_000 ||
      !['top', 'bottom'].includes(instance.side) ||
      typeof instance.locked !== 'boolean'
    ) {
      throw new Error('Invalid footprint placement or component binding.');
    }
    components.add(instance.componentId.toLowerCase());
  }
}

export function validateEmbeddedFootprint(definition: EmbeddedFootprint): void {
  if (!isEntityId(definition?.id) || !isText(definition.revision) || !isText(definition.name) || !isDigest(definition.definitionDigest)) throw new Error('Invalid footprint identity, name, revision, or definition digest.');
  for (const pad of byId(definition.pads, 'pad').values()) {
    if (typeof pad.label !== 'string' || !isBoardPoint(pad.positionNm)) throw new Error('Invalid footprint pad label or position.');
    if (pad.stack !== undefined) validatePadStack(pad.stack);
  }
  validateFootprintDetails(definition.graphics, definition.models);
}
