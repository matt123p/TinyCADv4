import type { CopperLayer } from './board';
import type { BoardProfile, Polygon, PolygonRegion } from './contours';
import { capsulePolygon, profileRegion } from './contours';
import type { BoardDrill } from './copper';
import type { BoardPoint } from './geometry';
import { pointInPolygon, samePoint } from './geometry';
import type { PolygonKernel } from './polygonKernel';

export interface CamArtwork {
  readonly kind: 'mask' | 'paste' | 'silk';
  readonly side: CopperLayer['id'];
  readonly regions: readonly PolygonRegion[];
}

export interface CamSnapshot {
  readonly profile: BoardProfile;
  readonly layers: readonly {
    id: CopperLayer['id'];
    copper: readonly PolygonRegion[];
  }[];
  readonly drills: readonly BoardDrill[];
  readonly artwork?: readonly CamArtwork[];
}

export type CamFiles = Readonly<Record<string, string>>;

function gerberHeader(fileFunction: string, polarity = 'Positive'): string[] {
  return [
    '%FSLAX46Y46*%',
    '%MOMM*%',
    `%TF.FileFunction,${fileFunction}*%`,
    `%TF.FilePolarity,${polarity}*%`,
    '%ADD10C,0.001000*%',
    'D10*',
  ];
}

const xy = (p: BoardPoint) => `X${p.x}Y${p.y}`;

function regionGerber(
  kernel: PolygonKernel,
  regions: readonly PolygonRegion[],
  fileFunction: string,
  polarity?: string,
): string {
  const lines = gerberHeader(fileFunction, polarity);
  const merged = kernel.boolean('union', regions, []);
  const rings = merged.flatMap(({ outer, holes }) => [
    { polygon: outer, polarity: 'D' },
    ...holes.map((polygon) => ({ polygon, polarity: 'C' })),
  ]);
  // Emit each enclosing ring before its descendants so that clear holes preserve dark islands.
  const depth = (polygon: Polygon) =>
    rings.filter(
      (ring) =>
        ring.polygon !== polygon &&
        polygon.some(
          (point) => pointInPolygon(point, ring.polygon) === 'inside',
        ),
    ).length;
  const ordered = rings
    .map((ring) => ({ ...ring, depth: depth(ring.polygon) }))
    .sort((a, b) => a.depth - b.depth);
  for (const { polygon, polarity } of ordered) {
    const first = polygon[0];
    lines.push(
      `%LP${polarity}*%`,
      'G36*',
      `${xy(first)}D02*`,
      'G01*',
      ...polygon.slice(1).map((point) => `${xy(point)}D01*`),
      `${xy(first)}D01*`,
      'G37*',
    );
  }
  return [...lines, 'M02*', ''].join('\n');
}

function profileGerber(profile: BoardProfile): string {
  profileRegion(profile);
  const lines = [...gerberHeader('Profile,NP'), '%LPD*%', 'G75*'];
  for (const contour of [profile.outline, ...profile.cutouts]) {
    lines.push(`${xy(contour[0].start)}D02*`);
    for (const edge of contour) {
      if (edge.kind === 'line') lines.push('G01*', `${xy(edge.end)}D01*`);
      else
        lines.push(
          edge.clockwise ? 'G02*' : 'G03*',
          `${xy(edge.end)}I${edge.centre.x - edge.start.x}J${
            edge.centre.y - edge.start.y
          }D01*`,
        );
    }
  }
  return [...lines, 'M02*', ''].join('\n');
}

function drillFile(
  drills: readonly BoardDrill[],
  plated: boolean,
  layerCount: number,
): string {
  const selected = drills.filter((drill) => drill.plated === plated);
  const widths = [...new Set(selected.map(({ widthNm }) => widthNm))].sort(
    (a, b) => a - b,
  );
  if (widths.length > 99)
    throw new Error('An XNC file can declare at most 99 tools.');
  const toolNumber = (index: number) => String(index + 1).padStart(2, '0');
  const decimal = (nm: number) => (nm / 1_000_000).toFixed(6);
  const coord = (point: BoardPoint) =>
    `X${decimal(point.x)}Y${decimal(point.y)}`;
  const fileFunction = plated
    ? `Plated,1,${layerCount},PTH`
    : `NonPlated,1,${layerCount},NPTH`;
  const header = [
    'M48',
    `; #@! TF.FileFunction,${fileFunction}`,
    'METRIC',
    ...widths.map((width, index) => `T${toolNumber(index)}C${decimal(width)}`),
    '%',
    'G05',
  ];
  const body = widths.flatMap((width, index) => [
    `T${toolNumber(index)}`,
    ...selected
      .filter(({ widthNm }) => widthNm === width)
      .flatMap(({ start, end, widthNm }) => {
        capsulePolygon(start, end, widthNm);
        return samePoint(start, end)
          ? [coord(start)]
          : [`G00${coord(start)}`, 'M15', `G01${coord(end)}`, 'M16', 'G05'];
      }),
  ]);
  return [...header, ...body, 'M30', ''].join('\n');
}

/** Writes the bounded diagnostic G0 subset from one geometry snapshot. */
export function writeCamFiles(
  kernel: PolygonKernel,
  snapshot: CamSnapshot,
): CamFiles {
  if (
    !snapshot.layers.length ||
    snapshot.layers[0].id !== 'top' ||
    snapshot.layers.length > 2 ||
    (snapshot.layers.length === 2 && snapshot.layers[1].id !== 'bottom')
  )
    throw new Error('Invalid CAM copper stack.');
  const layerCount = snapshot.layers.length;
  return {
    ...Object.fromEntries(
      snapshot.layers.map(({ id, copper }, index) => [
        `copper-${id}.gbr`,
        regionGerber(
          kernel,
          copper,
          `Copper,L${index + 1},${id === 'top' ? 'Top' : 'Bot'}`,
        ),
      ]),
    ),
    ...Object.fromEntries(
      (snapshot.artwork ?? []).map(({ kind, side, regions }) => [
        `${kind}-${side}.gbr`,
        regionGerber(
          kernel,
          regions,
          `${
            kind === 'mask'
              ? 'Soldermask'
              : kind === 'paste'
              ? 'Paste'
              : 'Legend'
          },${side === 'top' ? 'Top' : 'Bot'}`,
          kind === 'mask' ? 'Negative' : 'Positive',
        ),
      ]),
    ),
    'profile.gbr': profileGerber(snapshot.profile),
    'plated.xnc': drillFile(snapshot.drills, true, layerCount),
    'non-plated.xnc': drillFile(snapshot.drills, false, layerCount),
  };
}
