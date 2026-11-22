import { assemblyDrawing } from './assemblyDrawing';
import type { BoardDocument } from './board';
import { boardArtwork } from './boardArtwork';
import { boardAssembly } from './boardAssembly';
import { checkBoard } from './boardChecks';
import type { ProjectCircuitInput } from './boardParity';
import { boardCopperGeometry } from './boardCopperGeometry';
import { editableProfile } from './boardProfiles';
import { footprintStrokeFontVersion } from './footprintStrokeFont';
import { boardZoneGeometry } from './boardZoneGeometry';
import {
  gerberPaintRegions,
  readGerber,
  readXnc,
  verifyCamFiles,
} from './camReadback';
import { writeCamFiles } from './camWriter';
import type { CamArtwork, CamSnapshot } from './camWriter';
import { capsulePolygon, profileRegion } from './contours';
import type { PolygonRegion } from './contours';
import { openingRegion } from './copper';
import type { PolygonKernel } from './polygonKernel';
import { digest } from '../util/sha256';

export async function prepareCamPreview(
  board: BoardDocument,
  kernel: PolygonKernel,
  projectCircuit?: ProjectCircuitInput,
) {
  const geometry = boardCopperGeometry(board);
  const zones = boardZoneGeometry(board, kernel, geometry, true);
  const artworkGeometry = boardArtwork(board, kernel);
  const report = await checkBoard(board, kernel, {
    geometry,
    zones,
    artwork: artworkGeometry,
    projectCircuit,
  });
  const voids = geometry.drills.map(openingRegion);
  const features = [...geometry.features, ...zones.fills];
  const snapshot: CamSnapshot = {
    profile: editableProfile(board),
    drills: geometry.drills,
    artwork: (['mask', 'paste', 'silk', 'adhesive'] as const).flatMap((kind) =>
      (['top', 'bottom'] as const).flatMap((side): CamArtwork[] => {
        const regions =
          kind === 'silk'
            ? artworkGeometry.silk
                .filter((art) => art.side === side)
                .flatMap(({ regions }) => regions)
            : [...geometry.apertures
                .filter(
                  (aperture) =>
                    aperture.side === side && aperture.kind === kind,
                )
                .map(({ polygon }) => ({
                  outer: polygon,
                  holes: [] as PolygonRegion['holes'],
                })), ...artworkGeometry.apertures.filter((item) => item.kind === kind && item.side === side)
                  .flatMap(({ regions }) => regions)];
        return regions.length || (kind === 'mask' && board.vias?.length)
          ? [{ kind, side, regions }]
          : [];
      }),
    ),
    layers: board.copperLayers.map(({ id }) => ({
      id,
      copper: kernel.boolean(
        'difference',
        features
          .filter(({ layerId }) => layerId === id)
          .map(({ region }) => region),
        voids,
      ),
    })),
  };
  const camFiles = writeCamFiles(kernel, snapshot);
  const readbackIssues = verifyCamFiles(kernel, snapshot, camFiles);
  if (readbackIssues.length) throw new Error(readbackIssues.join('\n'));
  const [outline, ...cutouts] = readGerber(camFiles['profile.gbr']).contours;
  const profile = profileRegion({ outline, cutouts });
  const layers = snapshot.layers.map(({ id }) => ({
    id,
    copper: gerberPaintRegions(
      kernel,
      readGerber(camFiles[`copper-${id}.gbr`]).paints,
    ),
  }));
  const artwork = snapshot.artwork.map(({ kind, side }) => ({
    kind,
    side,
    regions: gerberPaintRegions(
      kernel,
      readGerber(camFiles[`${kind}-${side}.gbr`]).paints,
    ),
  }));
  const drills = [
    ...readXnc(camFiles['plated.xnc']).drills,
    ...readXnc(camFiles['non-plated.xnc']).drills,
  ].map(({ start, end, widthNm, plated }) => ({
    plated,
    polygon: capsulePolygon(start, end, widthNm),
  }));
  const files: Record<string, string> = {
    ...camFiles,
    ...boardAssembly(board),
    'checks.json': JSON.stringify(report, null, 2),
    'assembly-top.svg': assemblyDrawing(
      board,
      profile,
      geometry.drills,
      artworkGeometry.courtyards,
      'top',
    ),
    'assembly-bottom.svg': assemblyDrawing(
      board,
      profile,
      geometry.drills,
      artworkGeometry.courtyards,
      'bottom',
    ),
  };
  const fileHashes = Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([name, payload]) => [
        name,
        await digest(new TextEncoder().encode(payload)),
      ]),
    ),
  );
  const manifest = {
    kind: 'tinycad-cam-preview',
    status: 'NOT RELEASED',
    legendFont: footprintStrokeFontVersion,
    fabrication: report.fabrication,
    ...(report.schematic ? { schematic: report.schematic } : {}),
    placementCoordinates: {
      unit: 'mm',
      datum: 'board (0, 0)',
      axes: 'top-view, X right, Y up',
      rotation:
        'CCW, degrees from footprint-local axes after mounting on its declared side',
      population:
        'bom-fitted.csv lists fitted parts including hand-fitted jumpers. placement.csv lists fitted placements. bom.csv and assembly.csv also identify DNP and unplaced parts.',
    },
    version: 1,
    source: board.sourceCircuit ?? null,
    boardId: report.boardId,
    revision: report.revision,
    inputDigest: report.inputDigest,
    files: fileHashes,
    engine: report.engine,
    generatedAt: report.generatedAt,
  };
  return { files, manifest, report, profile, layers, artwork, drills };
}

export type BoardCamPreview = Awaited<ReturnType<typeof prepareCamPreview>>;
