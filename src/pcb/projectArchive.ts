import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js';
import { digest, unpackDsn } from '../io/dsnContainer';
import { MAX_PROJECT_FILE_BYTES } from '../../shared/projectFiles';
import { isEntityId } from '../model/schematicIdentity';
import { XMLBuilder } from '../util/xmlbuilder';
import { parseBoard } from './board';
import {
  circuitConnectivityDigest,
  validateCircuitSnapshot,
} from './circuitSnapshot';

export { PROJECT_FILE_EXTENSION } from '../../shared/projectFiles';
const format = 'tinycad-project';
const manifestPath = 'manifest.json';
const maxEntries = 10_000;
const maxDecodedBytes = 512 * 1024 * 1024;
const maxManifestBytes = 4 * 1024 * 1024;
const maxDocumentBytes = 32 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const sha256 = /^[0-9a-f]{64}$/;

export type ProjectEntryKind =
  | 'schematic'
  | 'circuit'
  | 'board'
  | 'rules'
  | 'recipe'
  | 'asset';

export interface ProjectAssetMetadata {
  readonly source: string;
  readonly mediaType: string;
  readonly license: string;
}

export interface ProjectEntry {
  readonly kind: ProjectEntryKind;
  readonly id: string;
  readonly path: string;
  readonly data: Uint8Array;
  readonly asset?: ProjectAssetMetadata;
}

export interface PcbProject {
  readonly projectId: string;
  readonly revisionId: string;
  readonly parentRevisionId?: string;
  readonly title: string;
  readonly requiredFeatures: readonly string[];
  readonly entries: readonly ProjectEntry[];
}

type InventoryItem = Omit<ProjectEntry, 'data'> & {
  size: number;
  sha256: string;
};
type Manifest = Omit<PcbProject, 'entries'> & {
  format: typeof format;
  schemaVersion: 1;
  entries: InventoryItem[];
};

const kinds: Readonly<
  Record<ProjectEntryKind, readonly [directory: string, extension: string]>
> = {
  schematic: ['schematics', 'dsn'],
  circuit: ['circuits', 'json'],
  board: ['boards', 'dpn'],
  rules: ['rules', 'json'],
  recipe: ['recipes', 'json'],
  asset: ['assets', ''],
};

function canonicalId(id: string): boolean {
  return isEntityId(id) && id === id.toLowerCase();
}

export function projectEntryPath(
  kind: ProjectEntryKind,
  id: string,
  compressedDrawing = false,
): string {
  if (
    !Object.prototype.hasOwnProperty.call(kinds, kind) ||
    !(kind === 'asset' ? sha256.test(id) : canonicalId(id))
  )
    throw new Error('Invalid project entry identity.');
  const [directory, extension] = kinds[kind];
  return `${directory}/${id}${
    extension
      ? '.' + (kind === 'schematic' && compressedDrawing ? 'dzn' : extension)
      : ''
  }`;
}

function validateProjectHeader(project: Omit<PcbProject, 'entries'>): void {
  if (
    !canonicalId(project?.projectId) ||
    !canonicalId(project.revisionId) ||
    typeof project.title !== 'string' ||
    !project.title.trim() ||
    project.title.length > 1024 ||
    (project.parentRevisionId !== undefined &&
      (!canonicalId(project.parentRevisionId) ||
        project.parentRevisionId === project.revisionId))
  ) {
    throw new Error('Invalid project identity, title, or revision lineage.');
  }
  if (
    !Array.isArray(project.requiredFeatures) ||
    project.requiredFeatures.length
  )
    throw new Error('Unsupported required project features.');
}

function validateEntry(item: Omit<ProjectEntry, 'data'>): void {
  if (
    typeof item?.path !== 'string' ||
    item.path !==
      projectEntryPath(item.kind, item.id, item.path.endsWith('.dzn'))
  ) {
    throw new Error('Invalid project entry path.');
  }
  if (item.kind === 'asset') {
    const asset = item.asset;
    if (
      !asset ||
      ![asset.source, asset.mediaType, asset.license].every(
        (field) =>
          typeof field === 'string' && field.trim() && field.length <= 4096,
      )
    ) {
      throw new Error(
        'Project assets need source, media type and license metadata.',
      );
    }
  } else if (item.asset !== undefined) {
    throw new Error('Unexpected project asset metadata.');
  }
}

function validateInventory(items: readonly InventoryItem[]): void {
  if (!Array.isArray(items) || items.length > maxEntries)
    throw new Error('Invalid project inventory size.');
  const paths = new Set<string>();
  const identities = new Set<string>();
  let bytes = 0;
  for (const entry of items) {
    validateEntry(entry);
    const identity = `${entry.kind}:${entry.id}`;
    if (
      paths.has(entry.path) ||
      identities.has(identity) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 1 ||
      entry.size > maxDocumentBytes ||
      typeof entry.sha256 !== 'string' ||
      !sha256.test(entry.sha256) ||
      (entry.kind === 'asset' && entry.sha256 !== entry.id)
    )
      throw new Error('Duplicate or invalid project inventory entry.');
    paths.add(entry.path);
    identities.add(identity);
    bytes += entry.size;
    if (bytes > maxDecodedBytes)
      throw new Error('Project exceeds its decoded size limit.');
  }
}

async function validateDocuments(
  entries: readonly ProjectEntry[],
): Promise<void> {
  const schematics = new Set(
    entries.filter(({ kind }) => kind === 'schematic').map(({ id }) => id),
  );
  const circuits = new Map<string, string>();
  const linkedBoards: ReturnType<typeof parseBoard>[] = [];
  for (const entry of entries) {
    if (entry.kind === 'asset') continue;
    if (entry.kind === 'schematic') {
      const source = await unpackDsn(entry.data);
      const builder = new XMLBuilder();
      builder.fromText(source.xml);
      const root = builder.xmlDoc.documentElement;
      const identifiers =
        root?.nodeName === 'TinyCADSheets'
          ? Array.from(root.childNodes as NodeListOf<Element>).filter(
              (child) => child.nodeName === 'DSNIDENTITY',
            )
          : [];
      if (
        builder.getElementsByTagName('parsererror').length ||
        identifiers.length !== 1 ||
        identifiers[0].getAttribute('id')?.toLowerCase() !== entry.id ||
        (source.representation === 'zip-v1') !== entry.path.endsWith('.dzn')
      )
        throw new Error(
          `Schematic identity or format differs from its inventory: ${entry.path}`,
        );
    } else if (entry.kind === 'board') {
      const board = parseBoard(decoder.decode(entry.data));
      if (board.boardId.toLowerCase() !== entry.id)
        throw new Error(
          `Board identity differs from its inventory: ${entry.path}`,
        );
      if (board.sourceCircuit) linkedBoards.push(board);
    } else {
      const payload = JSON.parse(decoder.decode(entry.data));
      if (entry.kind === 'circuit') {
        validateCircuitSnapshot(payload);
        const documentId = payload.documentId.toLowerCase();
        const key = `${documentId}:${payload.revision}`;
        if (
          payload.snapshotId.toLowerCase() !== entry.id ||
          !schematics.has(documentId) ||
          circuits.has(key)
        ) {
          throw new Error(
            `Circuit snapshot has a missing schematic or conflicting identity: ${entry.path}`,
          );
        }
        circuits.set(key, await circuitConnectivityDigest(payload));
      } else if (
        payload?.schemaVersion !== 1 ||
        !isEntityId(payload.id) ||
        payload.id.toLowerCase() !== entry.id
      ) {
        throw new Error(
          `Project ${entry.kind} identity or schema version is invalid: ${entry.path}`,
        );
      }
    }
  }
  for (const { sourceCircuit, boardId } of linkedBoards) {
    const key = `${sourceCircuit.documentId.toLowerCase()}:${
      sourceCircuit.revision
    }`;
    if (circuits.get(key) !== sourceCircuit.connectivityDigest)
      throw new Error(
        `Board ${boardId} has a missing or inconsistent source circuit snapshot.`,
      );
  }
}

/** Produce the same validated file inventory for an archive or a source-control directory. */
export async function encodeProjectFiles(
  project: PcbProject,
): Promise<ReadonlyMap<string, Uint8Array>> {
  validateProjectHeader(project);
  if (!Array.isArray(project.entries) || project.entries.length > maxEntries)
    throw new Error('Invalid project inventory size.');
  let total = 0;
  const entries = project.entries
    .map((entry) => {
      validateEntry(entry);
      if (
        !(entry.data instanceof Uint8Array) ||
        !entry.data.byteLength ||
        entry.data.byteLength > maxDocumentBytes
      )
        throw new Error('Invalid project entry data.');
      total += entry.data.byteLength;
      if (total > maxDecodedBytes)
        throw new Error('Project exceeds its decoded size limit.');
      const { id, kind, path, asset } = entry;
      return {
        id,
        kind,
        path,
        ...(asset ? { asset: { ...asset } } : {}),
        data: new Uint8Array(entry.data),
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const { projectId, revisionId, parentRevisionId, title } = project;
  const inventory: InventoryItem[] = [];
  for (const { data, ...item } of entries)
    inventory.push({
      ...item,
      size: data.byteLength,
      sha256: await digest(data),
    });
  validateInventory(inventory);
  await validateDocuments(entries);
  const manifest: Manifest = {
    format,
    schemaVersion: 1,
    projectId,
    revisionId,
    parentRevisionId,
    title,
    requiredFeatures: [],
    entries: inventory,
  };
  const manifestBytes = encoder.encode(
    JSON.stringify(manifest, null, 2) + '\n',
  );
  if (manifestBytes.length > maxManifestBytes)
    throw new Error('Project manifest exceeds its size limit.');
  return new Map([
    [manifestPath, manifestBytes],
    ...entries.map(({ path, data }): [string, Uint8Array] => [path, data]),
  ]);
}

function readManifest(bytes: Uint8Array): Manifest {
  if (!(bytes instanceof Uint8Array) || bytes.length > maxManifestBytes)
    throw new Error('Missing or oversized project manifest.');
  const manifest: Manifest = JSON.parse(decoder.decode(bytes));
  if (manifest?.format !== format || manifest.schemaVersion !== 1)
    throw new Error('Unsupported TinyCAD project format or version.');
  validateProjectHeader(manifest);
  validateInventory(manifest.entries);
  return manifest;
}

export async function decodeProjectFiles(
  files: ReadonlyMap<string, Uint8Array>,
): Promise<PcbProject> {
  const manifest = readManifest(files.get(manifestPath));
  if (files.size !== manifest.entries.length + 1)
    throw new Error('Project inventory does not match its files.');
  const entries: ProjectEntry[] = [];
  for (const { size, sha256: hash, ...item } of manifest.entries) {
    const source = files.get(item.path);
    if (!(source instanceof Uint8Array) || source.length !== size)
      throw new Error(`Missing or damaged project entry: ${item.path}`);
    const data = new Uint8Array(source);
    if ((await digest(data)) !== hash)
      throw new Error(`Missing or damaged project entry: ${item.path}`);
    entries.push({ ...item, data });
  }
  await validateDocuments(entries);
  const { projectId, revisionId, parentRevisionId, title, requiredFeatures } =
    manifest;
  return {
    projectId,
    revisionId,
    ...(parentRevisionId ? { parentRevisionId } : {}),
    title,
    requiredFeatures,
    entries,
  };
}

export async function encodeProjectArchive(
  project: PcbProject,
): Promise<Uint8Array> {
  const files = await encodeProjectFiles(project);
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    lastModDate: new Date(1980, 0, 1),
    extendedTimestamp: false,
    useWebWorkers: false,
    useCompressionStream: false,
    zip64: false,
  });
  for (const [name, data] of files)
    await writer.add(name, new Uint8ArrayReader(data), {
      level: name.endsWith('.dzn') ? 0 : 6,
    });
  const archive = await writer.close();
  if (archive.length > MAX_PROJECT_FILE_BYTES)
    throw new Error('Compressed project exceeds its size limit.');
  return archive;
}

export async function decodeProjectArchive(
  bytes: Uint8Array,
): Promise<PcbProject> {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length > MAX_PROJECT_FILE_BYTES ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 3 ||
    bytes[3] !== 4
  )
    throw new Error('Invalid or oversized project archive.');
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    useWebWorkers: false,
    useCompressionStream: false,
    checkAmbiguity: true,
  });
  try {
    const zipEntries = await reader.getEntries();
    if (zipEntries.length > maxEntries + 1)
      throw new Error('Too many project archive entries.');
    const byName = new Map(zipEntries.map((entry) => [entry.filename, entry]));
    if (
      byName.size !== zipEntries.length ||
      zipEntries.some(
        (entry) =>
          entry.encrypted ||
          entry.directory ||
          entry.executable ||
          entry.symlink ||
          entry.zip64 ||
          entry.diskNumberStart !== 0 ||
          ![0, 8].includes(entry.compressionMethod),
      )
    )
      throw new Error('Unsafe or duplicate project archive entry.');
    const read = async (
      name: string,
      limit: number,
      size?: number,
    ): Promise<Uint8Array> => {
      const entry = byName.get(name);
      if (
        !entry ||
        !('getData' in entry) ||
        !Number.isSafeInteger(entry.uncompressedSize) ||
        entry.uncompressedSize < 1 ||
        entry.uncompressedSize > limit ||
        (size !== undefined && entry.uncompressedSize !== size)
      ) {
        throw new Error(`Missing or invalid project archive entry: ${name}`);
      }
      const data = new Uint8Array(entry.uncompressedSize);
      let offset = 0;
      await entry.getData(
        new WritableStream<Uint8Array>({
          write(chunk) {
            if (offset + chunk.length > data.length)
              throw new Error('Project entry exceeds its declared size.');
            data.set(chunk, offset);
            offset += chunk.length;
          },
        }),
        { checkSignature: true },
      );
      if (offset !== data.length)
        throw new Error('Truncated project archive entry.');
      return data;
    };
    const manifest = await read(manifestPath, maxManifestBytes);
    const inventory = readManifest(manifest).entries;
    if (
      zipEntries.length !== inventory.length + 1 ||
      inventory.some(({ path }) => !byName.has(path))
    ) {
      throw new Error('Project inventory does not match its archive.');
    }
    const files = new Map([[manifestPath, manifest]]);
    for (const item of inventory)
      files.set(item.path, await read(item.path, maxDocumentBytes, item.size));
    return await decodeProjectFiles(files);
  } finally {
    await reader.close();
  }
}
