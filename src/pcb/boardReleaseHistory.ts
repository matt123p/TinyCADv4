import type { FileEntry } from '@zip.js/zip.js';
import { canonicalJson } from '../util/canonicalJson';
import { digest } from '../util/sha256';
import type { BoardDocument, BoardReleaseParent } from './board';
import type { BoardCamPreview } from './boardCam';
import { decodeBoard } from './boardCodec';
import { manufacturingOutputRoles } from './boardReleaseReview';
import { fabricationDocumentation } from './fabricationDrawing';

const sha256 = /^[a-f0-9]{64}$/;
const archiveLimit = 512 * 1024 * 1024;
const manifestLimit = 16 * 1024 * 1024;
const encoder = new TextEncoder();

export interface BoardReleaseBaseline {
  readonly board: BoardDocument;
  readonly parent: BoardReleaseParent;
  readonly outputs: ReadonlyMap<string, string>;
}

export async function readBoardRelease(archive: Blob): Promise<BoardReleaseBaseline> {
  if (!archive.size || archive.size > archiveLimit)
    throw new Error('Invalid manufacturing release archive size.');
  const { BlobReader, TextWriter, Uint8ArrayWriter, ZipReader } = await import('@zip.js/zip.js');
  const zip = new ZipReader(new BlobReader(archive), {
    useWebWorkers: false, checkOverlappingEntry: true,
  });
  try {
    const entries = new Map<string, FileEntry>();
    let unpacked = 0;
    for await (const entry of zip.getEntriesGenerator()) {
      const name = entry.filename;
      unpacked += entry.uncompressedSize;
      // TinyCAD writes stored entries. Require them before extracting to bound memory by the ZIP size.
      if (!('getData' in entry) || entry.encrypted || entry.compressionMethod !== 0 ||
        entry.compressedSize !== entry.uncompressedSize || entries.has(name) || unpacked > archiveLimit ||
        (name !== 'manifest.json' && !Object.hasOwn(manufacturingOutputRoles, name)))
        throw new Error('Unexpected files or size in manufacturing release.');
      entries.set(name, entry);
    }
    const index = entries.get('manifest.json');
    if (!index || index.uncompressedSize > manifestLimit)
      throw new Error('Invalid manufacturing release manifest.');
    const parsed: unknown = JSON.parse(await index.getData(new TextWriter(), { checkSignature: true }));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('Invalid manufacturing release manifest.');
    const { reviewId, ...manifest } = parsed as Awaited<ReturnType<
      typeof import('./boardReleaseReview')['prepareBoardManufacturingRelease']
    >>['manifest'];
    if (manifest.kind !== 'tinycad-manufacturing-release' || manifest.status !== 'RELEASED' ||
      manifest.schemaVersion !== 1 || !Array.isArray(manifest.outputs) ||
      manifest.outputs.length !== entries.size - 1 ||
      typeof reviewId !== 'string' || !sha256.test(reviewId) ||
      reviewId !== await digest(encoder.encode(canonicalJson(manifest))))
      throw new Error('The manufacturing release manifest is invalid or has changed.');
    const outputs = new Map<string, string>();
    let board: BoardDocument;
    for (const record of manifest.outputs) {
      if (!record || typeof record !== 'object')
        throw new Error('Invalid manufacturing release output entry.');
      const { filename, role, bytes, sha256: hash } = record;
      const entry = entries.get(filename);
      if (!entry || outputs.has(filename) ||
        !Object.hasOwn(manufacturingOutputRoles, filename) ||
        manufacturingOutputRoles[filename] !== role ||
        entry.uncompressedSize !== bytes || typeof hash !== 'string' || !sha256.test(hash))
        throw new Error('Manufacturing release output list does not match the archive.');
      const payload = await entry.getData(new Uint8ArrayWriter(), { checkSignature: true })
        .catch(() => {
          throw new Error('Cannot read manufacturing release payload: ' + filename);
        });
      if (payload.byteLength !== bytes || await digest(payload) !== hash)
        throw new Error('Manufacturing release payload has changed: ' + filename);
      if (filename === 'board.dpn') board = await decodeBoard(payload);
      outputs.set(filename, hash);
    }
    if (!board || board.boardId !== manifest.boardId || board.revision !== manifest.revision ||
      outputs.get('board.dpn') !== manifest.nativeBoardSha256 ||
      canonicalJson(board.releaseParent) !== canonicalJson(manifest.parentRelease))
      throw new Error('The released PCB does not match the manifest.');
    return {
      board, outputs,
      parent: { id: reviewId, revision: board.revision, boardSha256: manifest.nativeBoardSha256 },
    };
  } finally {
    await zip.close();
  }
}

export function startBoardRevision(working: BoardDocument, released: BoardReleaseBaseline): BoardDocument {
  if (working.boardId !== released.board.boardId)
    throw new Error('Choose a manufacturing release for this PCB.');
  if (working.revision < released.board.revision)
    throw new Error('The release is newer than this working PCB.');
  return {
    ...released.board,
    revision: working.revision,
    requiredFeatures: [...new Set([...released.board.requiredFeatures, 'release-parent' as const])],
    releaseParent: released.parent,
  };
}

function changes<T>(
  before: ReadonlyMap<string, T>,
  after: ReadonlyMap<string, T>,
  label: (item: T, id: string) => string,
) {
  return [...new Set([...before.keys(), ...after.keys()])].sort().flatMap((id) => {
    const a = before.get(id);
    const b = after.get(id);
    if (canonicalJson(a) === canonicalJson(b)) return [];
    const change = a === undefined ? 'Added' : b === undefined ? 'Removed' : 'Changed';
    return [{ id, change, name: label(b ?? a, id) }];
  });
}

const byId = <T extends { readonly id: string }>(items: readonly T[] = []) =>
  new Map(items.map((item) => [item.id, item]));

function componentStates(board: BoardDocument) {
  const placements = new Map(board.footprints?.map((item) => [item.componentId, item]));
  const devices = byId(board.deviceDefinitions);
  return new Map((board.components ?? []).map((part) => {
    const device = devices.get(part.deviceId);
    return [part.id, { part, placement: placements.get(part.id), device }];
  }));
}

function pads(board: BoardDocument) {
  return new Map((board.footprintDefinitions ?? []).flatMap((footprint) =>
    footprint.pads.map((pad) => [footprint.id + ':' + pad.id, {
      pad,
      name: footprint.name + ' · pad ' + pad.label,
    }]),
  ));
}

function rules(board: BoardDocument) {
  return new Map<string, unknown>([
    ['Fabrication profile and thickness', board.fabrication ?? null],
    ['Board routing rules', board.rules ?? null],
    ['Net classes', board.netClasses ?? []],
    ['Clearance rules', board.clearanceRules ?? []],
    ['Routing regions', board.routingRegions ?? []],
    ['Placement areas', board.placementAreas ?? []],
    ['Check waivers', board.waivers ?? []],
  ]);
}

export async function compareBoardRelease(
  baseline: BoardReleaseBaseline,
  working: BoardDocument,
  preview: BoardCamPreview,
) {
  const prior = baseline.board;
  if (working.boardId !== prior.boardId)
    throw new Error('Choose a manufacturing release for this PCB.');
  if (preview.report.inputDigest !== await digest(encoder.encode(JSON.stringify(working))))
    throw new Error('The PCB changed during comparison. Run it again.');
  const outputFiles: Record<string, string> = {
    ...preview.files, ...fabricationDocumentation(working, preview.files),
  };
  const previousOutputs = new Map(baseline.outputs);
  // Native PCB and check report hashes include the working revision and check timestamp.
  for (const name of ['board.dpn', 'checks.json']) {
    delete outputFiles[name];
    previousOutputs.delete(name);
  }
  const currentOutputs = new Map(await Promise.all(Object.entries(outputFiles).map(async ([name, text]) =>
    [name, await digest(encoder.encode(text))] as const)));
  const geometry = (board: BoardDocument) => new Map<string, unknown>([
    ['Outline and cutouts', board.profile ?? board.outline],
    ['Copper layers', board.copperLayers],
  ]);
  const identified = (label: string, a: readonly { id: string }[], b: readonly { id: string }[]) =>
    changes(byId(a), byId(b), ({ id }) => label + ' ' + id);
  const keyLabel = (_: unknown, id: string) => id;
  return [
    { name: 'Components', changes: changes(componentStates(prior), componentStates(working), ({ part }) => part.reference ?? part.id) },
    { name: 'Pads', changes: changes(pads(prior), pads(working), ({ name }) => name) },
    { name: 'Nets', changes: changes(byId(prior.nets), byId(working.nets), ({ name }) => name) },
    { name: 'Copper and board geometry', changes: [
      ...changes(geometry(prior), geometry(working), keyLabel),
      ...identified('Track', prior.tracks, working.tracks),
      ...identified('Via', prior.vias, working.vias),
      ...identified('Zone', prior.zones, working.zones),
      ...identified('Jumper', prior.jumpers, working.jumpers),
      ...identified('Hole or slot', prior.mechanicalHoles, working.mechanicalHoles),
    ] },
    { name: 'Rules', changes: changes(rules(prior), rules(working), keyLabel) },
    { name: 'Output files', changes: changes(previousOutputs, currentOutputs, keyLabel) },
  ];
}
