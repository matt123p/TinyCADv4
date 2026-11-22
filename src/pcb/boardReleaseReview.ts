import { findingBlocksRelease } from './boardFindings';
import { canonicalJson } from '../util/canonicalJson';
import { digest } from '../util/sha256';
import type { BoardDocument } from './board';
import type { BoardCamPreview } from './boardCam';
import { encodeBoard } from './boardCodec';
import { boardRuleResolver } from './boardRules';
import { fabricationProfileFor } from './fabricationProfiles';
import { fabricationDocumentation } from './fabricationDrawing';

const encoder = new TextEncoder();
const normalizedTimestamp = '2000-01-01T00:00:00.000Z';

export const manufacturingOutputRoles: Readonly<Record<string, string>> = {
  'board.dpn': 'native-board',
  'fabrication.svg': 'fabrication-outline-and-drill-drawing',
  'drill-tools.csv': 'drill-tool-table',
  'drill-openings.csv': 'drill-opening-coordinates',
  'checks.json': 'design-check-report',
  'profile.gbr': 'board-outline',
  'plated.xnc': 'plated-drill-and-route',
  'non-plated.xnc': 'non-plated-drill-and-route',
  'copper-top.gbr': 'top-copper',
  'copper-bottom.gbr': 'bottom-copper',
  'mask-top.gbr': 'top-solder-mask-openings',
  'mask-bottom.gbr': 'bottom-solder-mask-openings',
  'paste-top.gbr': 'top-paste',
  'paste-bottom.gbr': 'bottom-paste',
  'silk-top.gbr': 'top-silkscreen',
  'silk-bottom.gbr': 'bottom-silkscreen',
  'bom.csv': 'board-bom',
  'bom-fitted.csv': 'fitted-bom',
  'placement.csv': 'fitted-placement',
  'assembly.csv': 'assembly-population',
  'jumpers.csv': 'hand-fitted-wire-jumpers',
  'assembly-top.svg': 'top-assembly-drawing',
  'assembly-bottom.svg': 'bottom-assembly-drawing',
};

export interface BoardReleaseReviewOptions {
  readonly projectId?: string;
  readonly reviewedFiles: readonly string[];
  readonly deterministic?: boolean;
}

export function prepareBoardReleaseReview(
  board: BoardDocument,
  preview: BoardCamPreview,
  options: BoardReleaseReviewOptions,
) {
  return prepareManufacturingArchive(board, preview, options, false);
}

export function unreviewedCamFiles(
  preview: BoardCamPreview,
  reviewedFiles: readonly string[],
) {
  const reviewed = new Set(reviewedFiles);
  return Object.keys(preview.files).filter((name) =>
    /\.(gbr|xnc)$/.test(name) && !reviewed.has(name)).sort();
}

export async function prepareBoardManufacturingRelease(
  board: BoardDocument,
  reviewed: BoardCamPreview,
  fresh: BoardCamPreview,
  options: BoardReleaseReviewOptions,
) {
  const unchanged = Object.keys(fresh.files).length === Object.keys(reviewed.files).length &&
    Object.keys(fresh.files).every((name) =>
      name === 'checks.json' || fresh.files[name] === reviewed.files[name]);
  const comparableReport = (preview: BoardCamPreview) =>
    canonicalJson({ ...preview.report, generatedAt: null });
  if (!unchanged || comparableReport(fresh) !== comparableReport(reviewed))
    throw new Error('The PCB or its schematic changed after the CAM review. Reopen the preview and review the current revision.');
  return prepareManufacturingArchive(board, fresh, options, true);
}

async function prepareManufacturingArchive(
  board: BoardDocument,
  preview: BoardCamPreview,
  options: BoardReleaseReviewOptions,
  release: boolean,
) {
  const { manifest, report, files: previewFiles } = preview;
  const boardDigest = await digest(encoder.encode(JSON.stringify(board)));
  if (
    board.boardId !== manifest.boardId ||
    board.revision !== manifest.revision ||
    boardDigest !== manifest.inputDigest ||
    report.inputDigest !== boardDigest ||
    report.boardId !== board.boardId ||
    report.revision !== board.revision ||
    report.engine !== manifest.engine
  )
    throw new Error(
      'The PCB changed after the CAM preview. Run a fresh review.',
    );

  const names = Object.keys(previewFiles).sort();
  const required = [
    'profile.gbr',
    'plated.xnc',
    'non-plated.xnc',
    'bom.csv',
    'bom-fitted.csv',
    'placement.csv',
    'assembly.csv',
    ...(board.jumpers?.length ? ['jumpers.csv'] : []),
    'assembly-top.svg',
    'assembly-bottom.svg',
    'checks.json',
    ...board.copperLayers.map(({ id }) => 'copper-' + id + '.gbr'),
    ...preview.artwork.map(({ kind, side }) => kind + '-' + side + '.gbr'),
  ];
  if (
    names.join('\n') !== [...new Set(required)].sort().join('\n') ||
    names.join('\n') !== Object.keys(manifest.files).sort().join('\n') ||
    previewFiles['checks.json'] !== JSON.stringify(report, null, 2)
  )
    throw new Error('The CAM preview files and report no longer match.');

  const reviewedFiles = [...new Set(options.reviewedFiles)].sort();
  if (
    reviewedFiles.some(
      (name) =>
        !Object.hasOwn(previewFiles, name) || !/\.(gbr|xnc)$/.test(name),
    )
  )
    throw new Error('Reviewed artwork must come from the current CAM preview.');

  const readiness = manufacturingReadiness(board, preview);
  if (release && readiness.length)
    throw new Error('Resolve the manufacturing blockers before releasing this board.');
  if (release && unreviewedCamFiles(preview, reviewedFiles).length)
    throw new Error('Review every Gerber and drill file before releasing this board.');

  const files: Record<string, Uint8Array> = Object.fromEntries(
    names.map((name) => [name, encoder.encode(previewFiles[name])]),
  );
  await Promise.all(
    names.map(async (name) => {
      if (
        !Object.hasOwn(manufacturingOutputRoles, name) ||
        (await digest(files[name])) !== manifest.files[name]
      )
        throw new Error(
          'CAM preview hash or file role did not match for ' + name + '.',
        );
    }),
  );

  const timestamp = options.deterministic
    ? normalizedTimestamp
    : report.generatedAt;
  if (options.deterministic)
    files['checks.json'] = encoder.encode(
      JSON.stringify({ ...report, generatedAt: timestamp }, null, 2),
    );
  files['board.dpn'] = await encodeBoard(board);
  for (const [name, payload] of Object.entries(
    fabricationDocumentation(board, previewFiles),
  ))
    files[name] = encoder.encode(payload);
  const outputs = await Promise.all(
    Object.keys(files)
      .sort()
      .map(async (name) => ({
        filename: name,
        role: manufacturingOutputRoles[name],
        bytes: files[name].byteLength,
        sha256: await digest(files[name]),
      })),
  );

  const profile = fabricationProfileFor(board);
  const resolver = boardRuleResolver(board);
  const scopedNets = (board.nets ?? []).filter(({ classId, routingRules }) => classId || routingRules);
  const flow = {
    schemaVersion: 1,
    kind: release ? 'tinycad-manufacturing-release' : 'tinycad-manufacturing-review',
    status: release ? 'RELEASED' : 'NOT RELEASED',
    projectId: options.projectId ?? null,
    boardId: board.boardId,
    revision: board.revision,
    ...(board.releaseParent ? { parentRelease: board.releaseParent } : {}),
    source: board.sourceCircuit ?? null,
    schematic: report.schematic ?? null,
    nativeBoardSha256: outputs.find(({ filename }) => filename === 'board.dpn')
      .sha256,
    footprintDefinitions: (board.footprintDefinitions ?? []).map(
      ({ id, revision, definitionDigest }) => ({
        id,
        revision,
        definitionDigest,
      }),
    ),
    deviceDefinitions: (board.deviceDefinitions ?? []).map(
      ({ id, revision, definitionDigest, library }) => ({
        id,
        revision,
        definitionDigest,
        libraryDigest: library?.digest,
      }),
    ),
    stepAssets: (board.modelAssets ?? []).map(({ id }) => id),
    fabrication: board.fabrication ?? null,
    profile: profile ?? null,
    copperLayers: board.copperLayers,
    rules: {
      configured: board.rules ?? null,
      effective: resolver.net(),
      ...(board.clearanceRules?.length ? { clearances: board.clearanceRules } : {}),
      ...(board.routingRegions?.length ? { routingRegions: board.routingRegions } : {}),
      ...(scopedNets.length || board.netClasses?.length ? {
        netClasses: board.netClasses ?? [],
        nets: scopedNets.map(({ id, name, classId, routingRules }) => ({
          id, name, classId: classId ?? null, configured: routingRules ?? null,
          effective: resolver.net(id),
        })),
      } : {}),
    },
    assembly: {
      selection: 'board population',
      csvText: 'spreadsheet',
      coordinates: manifest.placementCoordinates,
    },
    recipe: release ? 'tinycad-manufacturing-release/1' : 'tinycad-manufacturing-review/1',
    checks: {
      engine: report.engine,
      coverage: report.coverage,
      issues: report.issues,
      waivers: board.waivers ?? [],
      readiness,
    },
    cam: {
      writer: 'tinycad-gerber-x2-xnc/1',
      readback: 'tinycad-gerber-x2-xnc-readback/1',
      legendFont: manifest.legendFont,
      geometryVerified: true,
      reviewedFiles,
    },
    outputs,
    timestamp,
    timestampMode: options.deterministic ? 'normalized' : 'as-generated',
  } as const;
  const id = await digest(encoder.encode(canonicalJson(flow)));
  return {
    files,
    manifest: { reviewId: id, ...flow },
  };
}

export function manufacturingReadiness(
  board: BoardDocument,
  { report, layers }: Pick<BoardCamPreview, 'report' | 'layers'>,
) {
  const profile = fabricationProfileFor(board);
  const blockers = report.issues
    .filter(findingBlocksRelease)
    .map(({ code, message, objects, severity }) => ({ code, detail: message, objects, severity }));

  for (const { check, status, detail } of report.coverage) {
    const withoutSchematic =
      check === 'Schematic parity' &&
      !board.sourceCircuit &&
      !board.components?.some(({ role }) => role !== 'pcb-only') &&
      (!report.schematic || report.schematic.state === 'unlinked');
    const waitingForProfile = !profile && (check === 'Fabrication profile applicability' ||
      check === 'Routed outline and cutouts');
    if ((status === 'limited' || status === 'unavailable') && !withoutSchematic && !waitingForProfile)
      blockers.push({
        code: 'check-coverage',
        severity: 'unknown',
        detail: check + (detail ? ' · ' + detail : ''),
        objects: [],
      });
  }
  if (!profile)
    blockers.push({
      code: 'profile-required',
      severity: 'blocker',
      detail: 'Select a fabrication profile and board thickness.',
      objects: [],
    });
  if (board.sourceCircuit && report.schematic?.state !== 'current')
    blockers.push({
      code: 'schematic-not-current',
      severity: 'blocker',
      detail: 'Verify the linked schematic against the current PCB revision.',
      objects: [board.sourceCircuit.documentId],
    });
  if (!layers.some(({ copper }) => copper.length))
    blockers.push({
      code: 'copper-empty',
      severity: 'blocker',
      detail: 'The fabrication output contains no copper.',
      objects: [],
    });
  return blockers;
}

export async function archiveBoardReleaseReview(
  review: Awaited<ReturnType<typeof prepareBoardReleaseReview>>,
) {
  const { reviewId, ...evidence } = review.manifest;
  if (
    reviewId !== (await digest(encoder.encode(canonicalJson(evidence)))) ||
    Object.keys(review.files).length !== evidence.outputs.length
  )
    throw new Error('The frozen review has changed.');
  await Promise.all(
    evidence.outputs.map(async ({ filename, bytes, sha256 }) => {
      const file = review.files[filename];
      if (!file || file.byteLength !== bytes || (await digest(file)) !== sha256)
        throw new Error(
          'The frozen review payload has changed for ' + filename + '.',
        );
    }),
  );

  const { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } = await import(
    '@zip.js/zip.js'
  );
  const zip = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
    extendedTimestamp: false,
    // ZIP's DOS timestamp uses local calendar values. These are the same in every time zone.
    lastModDate: new Date(2000, 0, 1, 0, 0, 0),
  });
  const payloads: Record<string, Uint8Array> = {
    ...review.files,
    'manifest.json': encoder.encode(JSON.stringify(review.manifest, null, 2)),
  };
  for (const name of Object.keys(payloads).sort())
    await zip.add(name, new Uint8ArrayReader(payloads[name]), { level: 0 });
  return zip.close();
}
