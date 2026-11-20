import { isEntityId } from '../model/schematicIdentity';
import { digest } from '../util/sha256';
import type { BoardModelAsset, EmbeddedFootprint } from './boardAssets';
import { validateEmbeddedFootprint } from './boardAssets';
import { readBoardModelAsset } from './boardCodec';
import type { PadAssignment } from './footprint';
import { validatePadMap } from './footprint';

export const deviceLibraryExtension = '.tcdevice.json';
export const maxDeviceLibraryBytes = 48 * 1024 * 1024;

export interface LibraryDevice {
  readonly format: 'tinycad-device';
  readonly version: 1;
  readonly id: string;
  readonly revision: string;
  readonly name: string;
  readonly packageNames: readonly string[];
  readonly mount: 'surface-mount' | 'through-hole' | 'mixed';
  readonly bodyNm: { readonly width: number; readonly height: number };
  readonly pitchNm?: number;
  readonly source: string;
  readonly license: string;
  readonly review: { readonly by: string; readonly evidence: string };
  readonly footprint: EmbeddedFootprint;
  readonly terminals: readonly { readonly id: string; readonly name: string }[];
  readonly assignments: readonly PadAssignment[];
  readonly models?: readonly BoardModelAsset[];
}

export interface DeviceRevision {
  readonly definition: LibraryDevice;
  readonly digest: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const text = (value: unknown) =>
  typeof value === 'string' && !!value.trim() && value.length <= 4096;
const uuid = (value: string) =>
  isEntityId(value) && value === value.toLowerCase();

export function canonicalDeviceJson(value: unknown): string {
  return JSON.stringify(value, (_, item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, item[key]]),
      );
    }
    return item;
  });
}

export async function deviceDigest(value: unknown): Promise<string> {
  return 'sha256:' + (await digest(encoder.encode(canonicalDeviceJson(value))));
}

export async function readLibraryDevice(
  bytes: Uint8Array,
): Promise<DeviceRevision> {
  if (bytes.length > maxDeviceLibraryBytes)
    throw new Error('Device file exceeds the size limit.');
  const definition = JSON.parse(decoder.decode(bytes)) as LibraryDevice;
  if (
    definition?.format !== 'tinycad-device' ||
    definition.version !== 1 ||
    !uuid(definition.id) ||
    ![
      definition.revision,
      definition.name,
      definition.source,
      definition.license,
      definition.review?.by,
      definition.review?.evidence,
    ].every(text) ||
    !Array.isArray(definition.packageNames) ||
    !definition.packageNames.length ||
    !definition.packageNames.every(text) ||
    !['surface-mount', 'through-hole', 'mixed'].includes(definition.mount) ||
    ![definition.bodyNm?.width, definition.bodyNm?.height].every(
      (n) => Number.isSafeInteger(n) && n > 0 && n <= 1_000_000_000,
    ) ||
    (definition.pitchNm !== undefined &&
      (!Number.isSafeInteger(definition.pitchNm) ||
        definition.pitchNm < 1 ||
        definition.pitchNm > 1_000_000_000)) ||
    !Array.isArray(definition.terminals) ||
    !definition.terminals.length ||
    definition.terminals.length > 10_000 ||
    !definition.terminals.every(
      (entry) => uuid(entry?.id) && text(entry?.name),
    ) ||
    !Array.isArray(definition.assignments) ||
    definition.assignments.length > 10_000 ||
    !definition.assignments.every((entry) => uuid(entry?.padId))
  )
    throw new Error('Invalid or unsupported reviewed device file.');

  if (
    !Array.isArray(definition.footprint?.pads) ||
    !definition.footprint.pads.length ||
    definition.footprint.pads.length > 10_000
  )
    throw new Error('Invalid reviewed footprint pad count.');
  validateEmbeddedFootprint(definition.footprint);
  const { definitionDigest, ...footprint } = definition.footprint;
  if (definitionDigest !== (await deviceDigest(footprint)))
    throw new Error('Footprint contents do not match the revision digest.');
  const issues = validatePadMap(
    definition.terminals.map(({ id }) => id),
    footprint.pads,
    definition.assignments,
  );
  if (issues.length) throw new Error(issues.join(' '));
  if (footprint.models?.some(({ assetId }) => !assetId))
    throw new Error('All reviewed footprint models must be embedded.');
  const assets = new Set<string>();
  const attachments = new Set(
    (footprint.models ?? []).flatMap(({ assetId }) =>
      assetId ? [assetId] : [],
    ),
  );
  if (
    definition.models !== undefined &&
    (!Array.isArray(definition.models) || definition.models.length > 32)
  )
    throw new Error('Invalid device STEP assets.');
  for (const asset of definition.models ?? []) {
    if (
      !asset ||
      assets.has(asset.id) ||
      !attachments.has(asset.id) ||
      asset.mediaType !== 'model/step' ||
      !text(asset.source) ||
      !text(asset.license)
    )
      throw new Error('Invalid, duplicate, or unused device STEP asset.');
    await readBoardModelAsset(asset);
    assets.add(asset.id);
  }
  if (assets.size !== attachments.size)
    throw new Error('The device is missing an embedded STEP attachment.');
  return { definition, digest: await deviceDigest(definition) };
}

export async function writeLibraryDevice(
  definition: LibraryDevice,
): Promise<Uint8Array> {
  const bytes = encoder.encode(canonicalDeviceJson(definition) + '\n');
  await readLibraryDevice(bytes);
  return bytes;
}

export function searchLibraryDevices(
  devices: readonly DeviceRevision[],
  criteria: {
    packageHint?: string;
    query?: string;
    maxWidthNm?: number;
    maxHeightNm?: number;
    padCount?: number;
    pitchNm?: number;
    mount?: LibraryDevice['mount'];
  },
) {
  const normalized = (name?: string) => name?.trim().toLowerCase() ?? '';
  const hint = normalized(criteria.packageHint);
  const query = normalized(criteria.query);
  const matches = devices.filter(
    ({ definition: device }) =>
      (!query ||
        [device.name, ...device.packageNames, device.review.by].some((value) =>
          normalized(value).includes(query),
        )) &&
      (criteria.padCount === undefined ||
        device.footprint.pads.length === criteria.padCount) &&
      (!criteria.mount || device.mount === criteria.mount) &&
      (criteria.pitchNm === undefined || device.pitchNm === criteria.pitchNm) &&
      (criteria.maxWidthNm === undefined ||
        device.bodyNm.width <= criteria.maxWidthNm) &&
      (criteria.maxHeightNm === undefined ||
        device.bodyNm.height <= criteria.maxHeightNm),
  );
  const exact = matches.filter(
    ({ definition }) =>
      !!hint &&
      definition.packageNames.some((name) => normalized(name) === hint),
  );
  return {
    matches,
    exact,
    hintStatus: !hint
      ? 'blank'
      : !exact.length
      ? 'unmatched'
      : exact.length === 1
      ? 'candidate'
      : 'ambiguous',
  } as const;
}
