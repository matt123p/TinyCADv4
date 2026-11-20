import { capsulePolygon, circlePolygon } from './contours';
import type { PolygonRegion } from './contours';
import type { PolygonKernel } from './polygonKernel';
import {
  deviceDigest,
  canonicalDeviceJson,
  writeLibraryDevice,
} from './deviceLibrary';
import { stableHierarchyId } from './hierarchicalNetlist';
import { importKicadFootprint, standardLand } from './kicadFootprint';
import { validateEmbeddedFootprint } from './boardAssets';
import type { BoardModelAsset, EmbeddedFootprint } from './boardAssets';
import { readBoardModelAsset } from './boardCodec';
import { isBoardPoint, samePoint, validateOutline } from './geometry';
import type { BoardPoint } from './geometry';
import type { FootprintGraphic, FootprintModel } from './footprintDetails';
import { validatePadStack } from './padstack';
import type { LibraryDevice } from './deviceLibrary';
import type { PadAssignment } from './footprint';
import type { PadShape, PhysicalPad } from './padstack';

export const footprintLibraryExtension = '.tcfootprint.json';

type ImportIssues = ReturnType<typeof importKicadFootprint>['issues'];

export interface FootprintLibrary {
  readonly format: 'tinycad-footprint';
  readonly version: 1;
  readonly definition: EmbeddedFootprint;
  readonly provenance: {
    readonly kind: 'authored' | 'imported-unreviewed';
    readonly source: string;
    readonly revision?: string;
  };
  readonly issues?: readonly ImportIssues[number][];
  readonly assets?: readonly BoardModelAsset[];
}

export async function footprintDefinition(
  fields: Omit<EmbeddedFootprint, 'definitionDigest'>,
): Promise<EmbeddedFootprint> {
  const contents = JSON.parse(canonicalDeviceJson(fields)) as typeof fields;
  const definition = {
    ...contents,
    definitionDigest: await deviceDigest(contents),
  };
  validateEmbeddedFootprint(definition);
  return definition;
}

export async function importFootprintLibrary(source: string, filename: string) {
  const parsed = importKicadFootprint(source);
  if (parsed.issues.some(({ severity }) => severity === 'blocker'))
    return { issues: parsed.issues, footprint: undefined };
  const sourceDigest = await deviceDigest(source);
  const id = await stableHierarchyId('imported-kicad-footprint', sourceDigest);
  const pads = await Promise.all(
    parsed.pads.map(async (pad) => ({
      ...pad,
      id: await stableHierarchyId('imported-kicad-footprint-pad', id, pad.id),
    })),
  );
  const models: FootprintModel[] = parsed.models.map((model) => ({
    ...model,
    kind: 'step',
    quality: 'imported-unreviewed',
  }));
  const footprint: FootprintLibrary = {
    format: 'tinycad-footprint',
    version: 1,
    provenance: {
      kind: 'imported-unreviewed',
      source: filename,
      ...(parsed.sourceVersion ? { revision: parsed.sourceVersion } : {}),
    },
    definition: await footprintDefinition({
      id,
      name: parsed.name,
      revision: '1',
      pads,
      graphics: parsed.graphics,
      models,
    }),
    issues: parsed.issues,
  };
  return { issues: parsed.issues, footprint };
}

export async function decodeFootprintLibrary(
  bytes: Uint8Array,
): Promise<FootprintLibrary> {
  if (!bytes.length || bytes.length > 48 * 1024 * 1024)
    throw new Error('Footprint file size is outside the supported range.');
  const file = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  ) as FootprintLibrary;
  const isText = (value: unknown) =>
    typeof value === 'string' && !!value.trim() && value.length <= 4096;
  if (
    file?.format !== 'tinycad-footprint' ||
    file.version !== 1 ||
    !['authored', 'imported-unreviewed'].includes(file.provenance?.kind) ||
    !isText(file.provenance.source) ||
    (file.provenance.revision !== undefined &&
      !isText(file.provenance.revision)) ||
    (file.issues !== undefined &&
      (!Array.isArray(file.issues) ||
        !file.issues.every(
          (issue) =>
            issue?.severity === 'warning' &&
            isText(issue.location) &&
            isText(issue.message),
        )))
  )
    throw new Error('Invalid native footprint provenance or reports.');
  validateEmbeddedFootprint(file.definition);
  const { definitionDigest, ...content } = file.definition;
  if (definitionDigest !== (await deviceDigest(content)))
    throw new Error('The footprint digest does not match its geometry.');
  const attachments = new Set(
    file.definition.models?.flatMap(({ assetId }) =>
      assetId ? [assetId] : [],
    ),
  );
  const loaded = new Set<string>();
  if (file.assets !== undefined && !Array.isArray(file.assets))
    throw new Error('Invalid footprint STEP assets.');
  for (const asset of file.assets ?? []) {
    if (
      asset?.mediaType !== 'model/step' ||
      !attachments.has(asset.id) ||
      loaded.has(asset.id) ||
      !isText(asset.source) ||
      (asset.license !== undefined && !isText(asset.license))
    )
      throw new Error('Invalid, duplicate, or unused footprint STEP asset.');
    await readBoardModelAsset(asset);
    loaded.add(asset.id);
  }
  if (attachments.size !== loaded.size)
    throw new Error('The footprint is missing an embedded STEP asset.');
  return file;
}

export async function encodeFootprintLibrary(
  file: FootprintLibrary,
): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(canonicalDeviceJson(file) + '\n');
  await decodeFootprintLibrary(bytes);
  return bytes;
}

export function makeFootprintPad({
  id,
  label,
  positionNm,
  profile,
  widthNm,
  heightNm,
  drillWidthNm = 0,
  drillLengthNm = drillWidthNm,
  plated = true,
  polygon,
  cornerRadiusNm,
}: {
  id: string;
  label: string;
  positionNm: PhysicalPad['positionNm'];
  profile: 'round' | 'rectangle' | 'roundrect' | 'oval' | 'polygon' | 'hole';
  polygon?: readonly BoardPoint[];
  cornerRadiusNm?: number;
  widthNm: number;
  heightNm: number;
  drillWidthNm?: number;
  drillLengthNm?: number;
  plated?: boolean;
}): PhysicalPad {
  if (
    ![widthNm, heightNm, drillWidthNm, drillLengthNm].every(
      Number.isSafeInteger,
    ) ||
    (profile !== 'hole' &&
      profile !== 'polygon' &&
      (widthNm < 1 || heightNm < 1)) ||
    drillWidthNm < 0 ||
    drillLengthNm < drillWidthNm ||
    (profile === 'hole' && drillWidthNm < 1)
  )
    throw new Error('Enter valid pad and drill dimensions.');
  if (!isBoardPoint(positionNm))
    throw new Error('Pad position is outside the footprint coordinate range.');
  let shape: PadShape | undefined;
  if (profile === 'polygon') {
    if (!polygon)
      throw new Error(
        'Enter the pad polygon vertices relative to its position.',
      );
    shape = { kind: 'polygon', vertices: polygon };
  } else if (profile === 'roundrect') {
    if (
      !Number.isSafeInteger(cornerRadiusNm) ||
      cornerRadiusNm < 0 ||
      cornerRadiusNm * 2 > Math.min(widthNm, heightNm)
    )
      throw new Error(
        'Enter a corner radius no larger than half the shorter side.',
      );
    shape = standardLand(
      'roundrect',
      widthNm,
      heightNm,
      cornerRadiusNm / Math.min(widthNm, heightNm),
    );
  } else if (profile === 'rectangle') {
    const x = Math.floor(widthNm / 2),
      y = Math.floor(heightNm / 2);
    shape = {
      kind: 'polygon',
      vertices: [
        { x: -x, y: -y },
        { x: widthNm - x, y: -y },
        { x: widthNm - x, y: heightNm - y },
        { x: -x, y: heightNm - y },
      ],
    };
  } else if (profile !== 'hole') {
    const length = profile === 'round' ? 0 : Math.abs(widthNm - heightNm);
    const delta = Math.floor(length / 2);
    const vertical = heightNm > widthNm;
    shape = {
      kind: 'capsule',
      start: { x: vertical ? 0 : -delta, y: vertical ? -delta : 0 },
      end: {
        x: vertical ? 0 : length - delta,
        y: vertical ? length - delta : 0,
      },
      widthNm: profile === 'round' ? widthNm : Math.min(widthNm, heightNm),
    };
  }
  const hasDrill = drillWidthNm > 0;
  const twoSides = hasDrill && plated && !!shape;
  const halfSlot = Math.floor((drillLengthNm - drillWidthNm) / 2);
  const stack: PhysicalPad['stack'] = {
    copper: shape ? { top: shape, ...(twoSides ? { bottom: shape } : {}) } : {},
    mask: shape ? { top: shape, ...(twoSides ? { bottom: shape } : {}) } : {},
    ...(!hasDrill && shape ? { paste: { top: shape } } : {}),
    ...(hasDrill
      ? {
          drill: {
            start: { x: -halfSlot, y: 0 },
            end: { x: drillLengthNm - drillWidthNm - halfSlot, y: 0 },
            widthNm: drillWidthNm,
            plated: twoSides,
          },
        }
      : {}),
  };
  validatePadStack(stack);
  return { id, label, positionNm, stack };
}

export type FootprintDeviceMapping =
  | { kind: 'signal'; terminal: string }
  | { kind: 'nc' | 'reserved' | 'mechanical' };

export async function publishFootprintDevice(
  footprint: FootprintLibrary,
  data: {
    widthNm: number;
    heightNm: number;
    license: string;
    reviewer: string;
    evidence: string;
    packageName: string;
    mappings: ReadonlyMap<string, FootprintDeviceMapping>;
  },
): Promise<Uint8Array> {
  const { definition, provenance, assets } = await decodeFootprintLibrary(
    await encodeFootprintLibrary(footprint),
  );
  const id = await stableHierarchyId(
    'footprint-library-device',
    definition.id,
    data.packageName.trim(),
  );
  const assigned = new Map<string, string>();
  const assignments: PadAssignment[] = [];
  for (const pad of definition.pads) {
    const map = data.mappings.get(pad.id);
    if (!map)
      throw new Error(`Choose an assignment for pad ${pad.label || pad.id}.`);
    if (map.kind !== 'signal') {
      assignments.push({ padId: pad.id, kind: map.kind });
      continue;
    }
    const name = map.terminal.trim();
    if (!name)
      throw new Error(
        `Enter a logical terminal name for pad ${pad.label || pad.id}.`,
      );
    if (!pad.stack?.copper.top && !pad.stack?.copper.bottom)
      throw new Error(`Signal pad ${pad.label || pad.id} needs copper.`);
    if (!assigned.has(name)) {
      assigned.set(
        name,
        await stableHierarchyId('library-device-terminal', id, name),
      );
    }
    assignments.push({
      padId: pad.id,
      kind: 'signal',
      signalId: assigned.get(name),
    });
  }
  const drilled = definition.pads.some(({ stack }) => stack?.drill?.plated);
  const surface = definition.pads.some(
    ({ stack }) => !stack?.drill && (stack?.copper.top || stack?.copper.bottom),
  );
  const library: LibraryDevice = {
    format: 'tinycad-device',
    version: 1,
    id,
    revision: definition.revision,
    name: definition.name,
    packageNames: [data.packageName.trim()],
    mount: drilled ? (surface ? 'mixed' : 'through-hole') : 'surface-mount',
    bodyNm: { width: data.widthNm, height: data.heightNm },
    source: provenance.source,
    license: data.license.trim(),
    review: { by: data.reviewer.trim(), evidence: data.evidence.trim() },
    footprint: definition,
    terminals: [...assigned].map(([name, id]) => ({ name, id })),
    assignments,
    ...(assets?.length ? { models: assets } : {}),
  };
  return writeLibraryDevice(library);
}

function courtyardRegions(graphics: readonly FootprintGraphic[]) {
  const regions: PolygonRegion[] = [];
  const remaining: { start: BoardPoint; end: BoardPoint }[] = [];
  const add = (outer: readonly BoardPoint[]) => {
    validateOutline(outer);
    regions.push({ outer, holes: [] });
  };
  for (const item of graphics) {
    switch (item.kind) {
      case 'line':
        remaining.push(item);
        break;
      case 'polygon':
        add(item.points);
        break;
      case 'rect': {
        const { start: a, end: b } = item;
        add([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }]);
        break;
      }
      case 'circle':
        add(
          circlePolygon(
            item.center,
            Math.round(
              Math.hypot(
                item.end.x - item.center.x,
                item.end.y - item.center.y,
              ),
            ),
          ),
        );
        break;
      default:
        return { regions, open: true };
    }
  }
  while (remaining.length) {
    const first = remaining.pop();
    const outline = [first.start, first.end];
    while (!samePoint(outline[0], outline[outline.length - 1])) {
      const last = outline[outline.length - 1];
      const next = remaining.findIndex(
        ({ start, end }) => samePoint(start, last) || samePoint(end, last),
      );
      if (next < 0) return { regions, open: true };
      const [edge] = remaining.splice(next, 1);
      outline.push(samePoint(edge.start, last) ? edge.end : edge.start);
    }
    outline.pop();
    add(outline);
  }
  return { regions, open: false };
}

export function inspectFootprintDimensions(
  footprint: EmbeddedFootprint,
  kernel: PolygonKernel,
  minimumAnnulusNm: number,
) {
  if (!Number.isSafeInteger(minimumAnnulusNm) || minimumAnnulusNm < 0)
    throw new Error('Enter a nonnegative annular ring size.');
  const issues: { location: string; message: string }[] = [];
  const labels = new Set<string>();
  function body(shape: PadShape): PolygonRegion {
    return {
      outer:
        shape.kind === 'polygon'
          ? shape.vertices
          : capsulePolygon(shape.start, shape.end, shape.widthNm),
      holes: [],
    };
  }
  for (const [index, { label, stack }] of footprint.pads.entries()) {
    const location = `Pad ${label || 'unlabelled'} (${index + 1})`;
    const add = (message: string) => issues.push({ location, message });
    if (label && labels.has(label))
      add('Repeated label. Confirm this land individually in the map.');
    labels.add(label);
    if (!stack) {
      add('No copper, drill, mask or paste geometry is defined.');
      continue;
    }
    const { drill } = stack;
    for (const side of ['top', 'bottom'] as const) {
      const copper = stack.copper[side];
      const mask = stack.mask?.[side];
      if (
        copper &&
        mask &&
        !kernel.boolean('intersection', [body(copper)], [body(mask)]).length
      )
        add(`The ${side} solder mask opening does not expose the copper land.`);
      if (drill?.plated) {
        const required = body({
          ...drill,
          kind: 'capsule',
          widthNm: drill.widthNm + 2 * minimumAnnulusNm,
        });
        if (
          !copper ||
          kernel.boolean('difference', [required], [body(copper)]).length
        )
          add(
            `The ${side} copper does not provide the requested annular ring around the drill or slot.`,
          );
      }
      if (drill && !drill.plated && copper) {
        const hole = body({ ...drill, kind: 'capsule' });
        if (kernel.boolean('intersection', [hole], [body(copper)]).length)
          add(`The non-plated drill intersects the ${side} copper land.`);
      }
    }
  }
  const courtyard = (footprint.graphics ?? []).filter(({ layer }) =>
    layer.endsWith('CrtYd'),
  );
  if (!courtyard.length) {
    issues.push({
      location: 'Courtyard',
      message: 'Define or review a footprint courtyard.',
    });
  }
  for (const side of ['top', 'bottom'] as const) {
    const layer = side === 'top' ? 'F.CrtYd' : 'B.CrtYd';
    const graphics = courtyard.filter((item) => item.layer === layer);
    if (!graphics.length) continue;
    try {
      const { regions, open } = courtyardRegions(graphics);
      if (open || !regions.length) {
        issues.push({
          location: layer,
          message: 'Use closed outlines on this courtyard layer.',
        });
        continue;
      }
      const area = kernel.boolean('union', regions, []);
      for (const [
        index,
        { label, stack, positionNm },
      ] of footprint.pads.entries()) {
        const land = stack?.copper[side];
        const drill = stack?.drill;
        const shapes: PadShape[] = [
          ...(land ? [land] : []),
          ...(drill ? [{ ...drill, kind: 'capsule' as const }] : []),
        ];
        if (
          shapes.some(
            (shape) =>
              kernel.boolean(
                'difference',
                [
                  {
                    outer: body(shape).outer.map(({ x, y }) => ({
                      x: x + positionNm.x,
                      y: y + positionNm.y,
                    })),
                    holes: [],
                  },
                ],
                area,
              ).length,
          )
        ) {
          issues.push({
            location: layer,
            message: `Pad or hole ${label || 'unlabelled'} (${
              index + 1
            }) falls outside the courtyard.`,
          });
        }
      }
    } catch (error) {
      issues.push({
        location: layer,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return issues;
}

export function translateFootprintOrigin(
  footprint: EmbeddedFootprint,
  origin: BoardPoint,
): Pick<EmbeddedFootprint, 'pads' | 'graphics' | 'models'> {
  const shift = ({ x, y }: BoardPoint): BoardPoint => {
    const point = { x: x - origin.x, y: y - origin.y };
    if (!isBoardPoint(point))
      throw new Error(
        'Changing the origin would move geometry outside the supported coordinate range.',
      );
    return point;
  };
  function graphic(item: FootprintGraphic): FootprintGraphic {
    switch (item.kind) {
      case 'line':
      case 'rect':
        return { ...item, start: shift(item.start), end: shift(item.end) };
      case 'arc':
        return {
          ...item,
          start: shift(item.start),
          mid: shift(item.mid),
          end: shift(item.end),
        };
      case 'circle':
        return { ...item, center: shift(item.center), end: shift(item.end) };
      case 'polygon':
        return { ...item, points: item.points.map(shift) };
      case 'text':
        return { ...item, at: shift(item.at) };
    }
  }
  return {
    pads: footprint.pads.map((pad) => ({
      ...pad,
      positionNm: shift(pad.positionNm),
    })),
    ...(footprint.graphics
      ? { graphics: footprint.graphics.map(graphic) }
      : {}),
    ...(footprint.models
      ? {
          models: footprint.models.map((model) => {
            const [x, y, z] = model.offsetNm;
            const point = shift({ x, y });
            return { ...model, offsetNm: [point.x, point.y, z] };
          }),
        }
      : {}),
  };
}

type AuthoredPad = EmbeddedFootprint['pads'][number];

export function footprintPadArray(
  seed: AuthoredPad,
  copies: number,
  spacing: BoardPoint,
): AuthoredPad[] {
  if (
    !Number.isSafeInteger(copies) ||
    copies < 1 ||
    copies > 512 ||
    !isBoardPoint(spacing) ||
    (spacing.x === 0 && spacing.y === 0)
  )
    throw new Error('Enter 1 to 512 copies and a nonzero pad spacing.');
  return Array.from({ length: copies }, (_, index) => {
    const multiplier = index + 1;
    const positionNm = {
      x: seed.positionNm.x + multiplier * spacing.x,
      y: seed.positionNm.y + multiplier * spacing.y,
    };
    if (!isBoardPoint(positionNm))
      throw new Error(
        'The array would extend beyond the footprint coordinate range.',
      );
    const label = /^\d+$/.test(seed.label)
      ? String(BigInt(seed.label) + BigInt(multiplier)).padStart(
          seed.label.length,
          '0',
        )
      : seed.label
      ? seed.label + '-' + (multiplier + 1)
      : '';
    return { ...seed, id: crypto.randomUUID(), label, positionNm };
  });
}
