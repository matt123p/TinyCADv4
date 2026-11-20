import { isEntityId } from '../model/schematicIdentity';
import { validatePadMap } from './footprint';
import type {
  FootprintPad,
  FootprintPlacement,
  PadAssignment,
} from './footprint';
import { BOARD_COORDINATE_LIMIT_NM, isBoardPoint } from './geometry';
import { validatePadStack } from './padstack';
import type { PadStack } from './padstack';
import type { RouteRules } from './routing';
import { validateCircuitSnapshot } from './circuitSnapshot';
import type { CircuitSnapshot, CircuitComponent } from './circuitSnapshot';
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
  readonly datasheetUrl?: string;
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
  readonly library?: {
    readonly id: string;
    readonly digest: string;
    readonly footprintId: string;
    readonly evidence: string;
    readonly reviewer: string;
    readonly license: string;
    readonly bindings: readonly {
      readonly terminalId: string;
      readonly signalId: string;
    }[];
  };
}

export interface BoardFootprint extends FootprintPlacement {
  readonly id: string;
  readonly deviceId: string;
  readonly componentId: string;
  readonly locked: boolean;
}

export interface BoardComponent {
  readonly id: string;
  readonly reference?: string;
  readonly value?: string;
  readonly logicalId?: string;
  readonly deviceId?: string;
  readonly role?: 'electrical' | 'dnp' | 'pcb-only' | 'net-tie';
  readonly units?: CircuitComponent['units'];
  readonly signals?: readonly {
    readonly signalId: string;
    readonly netId: string;
  }[];
}

export interface BoardNet {
  readonly id: string;
  readonly name: string;
  readonly aliases?: readonly string[];
}

export interface BoardModelAsset {
  readonly id: string;
  readonly mediaType: 'model/step';
  readonly source: string;
  readonly license?: string;
  readonly base64: string;
}

export interface BoardAssets {
  readonly sourceCircuit?: CircuitSource;
  readonly appliedCircuit?: CircuitSnapshot;
  readonly components?: readonly BoardComponent[];
  readonly nets?: readonly BoardNet[];
  readonly rules?: RouteRules;
  readonly modelAssets?: readonly BoardModelAsset[];
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
  if (
    (board.appliedCircuit !== undefined) !==
    features.includes('applied-circuit')
  )
    throw new Error(
      'An embedded circuit must declare the applied-circuit feature.',
    );
  if (board.appliedCircuit) {
    const snapshot = board.appliedCircuit;
    validateCircuitSnapshot(snapshot);
    if (
      sourceCircuit?.documentId !== snapshot.documentId ||
      sourceCircuit?.revision !== snapshot.revision
    )
      throw new Error(
        'The embedded circuit does not match the board source revision.',
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
  const nets = byId(board.nets ?? [], 'net');
  for (const net of nets.values()) {
    if (
      !isText(net.name) ||
      (net.aliases !== undefined &&
        (!Array.isArray(net.aliases) || !net.aliases.every(isText)))
    )
      throw new Error('Invalid board net names.');
  }
  if (
    board.rules !== undefined &&
    ![
      board.rules?.minWidthNm,
      board.rules?.clearanceNm,
      board.rules?.edgeClearanceNm,
      board.rules?.minViaAnnulusNm,
    ].every(
      (dimension, index) =>
        Number.isSafeInteger(dimension) &&
        dimension >= (index === 0 ? 1 : 0) &&
        dimension <= BOARD_COORDINATE_LIMIT_NM,
    )
  ) {
    throw new Error('Invalid board routing rules.');
  }
  const componentDefinitions = byId(board.components ?? [], 'component');
  for (const component of componentDefinitions.values()) {
    if (
      (component.reference !== undefined &&
        typeof component.reference !== 'string') ||
      (component.value !== undefined && typeof component.value !== 'string') ||
      (component.logicalId !== undefined && !isEntityId(component.logicalId)) ||
      (component.deviceId !== undefined && !isEntityId(component.deviceId)) ||
      (component.role !== undefined &&
        !['electrical', 'dnp', 'pcb-only', 'net-tie'].includes(
          component.role,
        )) ||
      (component.signals !== undefined && !Array.isArray(component.signals))
    )
      throw new Error('Invalid board component definition.');
    if (component.units !== undefined) {
      const units = byId(component.units, 'schematic unit');
      if ([...units.values()].some(({ sheetId }) => !isEntityId(sheetId)))
        throw new Error('Invalid component schematic sheet identity.');
    }
    const seen = new Set<string>();
    for (const binding of component.signals ?? []) {
      if (
        !isEntityId(binding?.signalId) ||
        seen.has(binding.signalId.toLowerCase()) ||
        !isEntityId(binding.netId) ||
        !nets.has(binding.netId.toLowerCase())
      )
        throw new Error('Invalid component signal-to-net binding.');
      seen.add(binding.signalId.toLowerCase());
    }
  }

  const modelAssets = new Set<string>();
  if (board.modelAssets !== undefined) {
    if (!Array.isArray(board.modelAssets) || board.modelAssets.length > 4096)
      throw new Error('Invalid STEP model asset collection.');
    for (const asset of board.modelAssets) {
      if (
        typeof asset?.id !== 'string' ||
        !/^[a-f0-9]{64}$/.test(asset.id) ||
        modelAssets.has(asset.id) ||
        asset.mediaType !== 'model/step' ||
        !isText(asset.source) ||
        (asset.license !== undefined && !isText(asset.license)) ||
        !isText(asset.base64)
      )
        throw new Error('Invalid or duplicate STEP model asset.');
      modelAssets.add(asset.id);
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
    if ([...componentDefinitions.values()].some(({ deviceId }) => deviceId))
      throw new Error(
        'PCB component is missing its reviewed device definition.',
      );
    if (modelAssets.size)
      throw new Error('Embedded STEP asset has no footprint attachment.');
    if (features.includes('physical-padstacks'))
      throw new Error('Physical padstacks need embedded devices.');
    return;
  }

  const definitions = byId(footprintDefinitions, 'footprint definition');
  let hasPadstacks = false;
  const attachedAssets = new Set<string>();
  for (const definition of definitions.values()) {
    validateEmbeddedFootprint(definition);
    for (const { assetId } of definition.models ?? []) {
      if (assetId === undefined) continue;
      if (!modelAssets.has(assetId))
        throw new Error(
          'Footprint model refers to a missing embedded STEP asset.',
        );
      attachedAssets.add(assetId);
    }
    hasPadstacks ||= definition.pads.some((pad) => pad.stack !== undefined);
  }
  if (hasPadstacks !== features.includes('physical-padstacks')) {
    throw new Error(
      'Explicit padstacks must declare the physical-padstacks feature.',
    );
  }
  if ([...modelAssets].some((id) => !attachedAssets.has(id)))
    throw new Error('Embedded STEP asset has no footprint attachment.');
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
    if (device.library) {
      const { id, digest, footprintId, evidence, reviewer, license, bindings } =
        device.library;
      const signals = new Set(device.signalIds);
      if (
        !isEntityId(id) ||
        !isDigest(digest) ||
        !isEntityId(footprintId) ||
        ![evidence, reviewer, license].every(isText) ||
        !Array.isArray(bindings) ||
        bindings.length !== signals.size ||
        new Set(bindings.map((entry) => entry?.terminalId)).size !==
          bindings.length ||
        new Set(bindings.map((entry) => entry?.signalId)).size !==
          signals.size ||
        !bindings.every(
          (entry) =>
            isEntityId(entry?.terminalId) && signals.has(entry.signalId),
        )
      )
        throw new Error('Invalid reviewed device library binding.');
    }
  }
  for (const component of componentDefinitions.values()) {
    if (component.deviceId && !devices.has(component.deviceId.toLowerCase()))
      throw new Error(
        'PCB component is missing its reviewed device definition.',
      );
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
    const component = componentDefinitions.get(
      instance.componentId.toLowerCase(),
    );
    if (board.components !== undefined && !component)
      throw new Error('Placement refers to a missing embedded component.');
    if (
      component?.deviceId &&
      component.deviceId.toLowerCase() !== instance.deviceId.toLowerCase()
    )
      throw new Error('Placement uses a different device than its component.');
    const signals = new Set(
      devices
        .get(instance.deviceId.toLowerCase())
        .signalIds.map((id) => id.toLowerCase()),
    );
    if (
      component?.signals?.some(
        ({ signalId }) => !signals.has(signalId.toLowerCase()),
      )
    )
      throw new Error('Component binding refers to an unknown device signal.');
    components.add(instance.componentId.toLowerCase());
  }
}

export function isFootprintDatasheetUrl(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length > 4096 ||
    !/^https?:\/\//i.test(value) ||
    /[\s\u0000-\u001f\u007f\\]/.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    return !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function validateEmbeddedFootprint(definition: EmbeddedFootprint): void {
  if (
    !isEntityId(definition?.id) ||
    !isText(definition.revision) ||
    !isText(definition.name) ||
    !isDigest(definition.definitionDigest)
  )
    throw new Error(
      'Invalid footprint identity, name, revision, or definition digest.',
    );
  if (
    definition.datasheetUrl !== undefined &&
    !isFootprintDatasheetUrl(definition.datasheetUrl)
  )
    throw new Error('Enter an absolute HTTP or HTTPS datasheet URL.');
  for (const pad of byId(definition.pads, 'pad').values()) {
    if (typeof pad.label !== 'string' || !isBoardPoint(pad.positionNm))
      throw new Error('Invalid footprint pad label or position.');
    if (pad.stack !== undefined) validatePadStack(pad.stack);
  }
  validateFootprintDetails(definition.graphics, definition.models);
}
