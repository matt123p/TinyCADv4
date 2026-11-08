import { COMPRESSED_DRAWING_MIME } from '../../shared/drawingFiles.js';
import {
  ZipReader,
  ZipWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
} from '@zip.js/zip.js';

export const DSN_MIME = COMPRESSED_DRAWING_MIME;
const MAX_INPUT = 256 * 1024 * 1024;
const MAX_DECODED = 512 * 1024 * 1024;
const MAX_ENTRIES = 10000;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export type Payloads = Record<string, Uint8Array>;

export async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new Uint8Array(bytes).buffer,
  );
  return Array.from(new Uint8Array(hash), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
}

export function validPath(name: string): boolean {
  return /^(?:drawing\.xml|results\/[A-Za-z0-9_-]{1,80}\/(?:index\.json|\d+-(?:real|imaginary)\.bin))$/.test(
    name,
  );
}

function decodeXml(bytes: Uint8Array): string {
  let text: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
  else if (bytes[0] === 0xfe && bytes[1] === 0xff)
    text = new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
  else text = decoder.decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error(
      'External entities and document types are not supported in drawings.',
    );
  if (!/<(?:TinyCADSheets|TinyCAD)(?:\s|>)/.test(text))
    throw new Error('This is not a TinyCAD drawing.');
  return text;
}

export async function packDsn(
  xml: string,
  payloads: Payloads,
): Promise<Uint8Array> {
  const entries: Payloads = { 'drawing.xml': encoder.encode(xml), ...payloads };
  if (Object.keys(entries).length > MAX_ENTRIES - 2)
    throw new Error('Drawing has too many result entries.');
  let total = 0;
  const inventory = [];
  for (const [path, data] of Object.entries(entries)) {
    if (!validPath(path)) throw new Error('Invalid drawing payload path.');
    total += data.byteLength;
    if (
      total > MAX_DECODED ||
      (path === 'drawing.xml' && data.length > 32 * 1024 * 1024)
    )
      throw new Error('Drawing exceeds the file size limit.');
    inventory.push({ path, size: data.length, sha256: await digest(data) });
  }
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    // Entry timestamps carry no drawing metadata; keep identical saves stable.
    lastModDate: new Date(1980, 0, 1),
    extendedTimestamp: false,
    useWebWorkers: false,
    useCompressionStream: false,
    zip64: false,
  });
  await writer.add('mimetype', new Uint8ArrayReader(encoder.encode(DSN_MIME)), {
    level: 0,
  });
  await writer.add(
    'manifest.json',
    new Uint8ArrayReader(
      encoder.encode(
        JSON.stringify({
          format: 'tinycad-dsn',
          containerVersion: 1,
          documentSchemaVersion: 1,
          entries: inventory,
        }),
      ),
    ),
  );
  for (const [path, data] of Object.entries(entries))
    await writer.add(path, new Uint8ArrayReader(data), { level: 6 });
  const output = await writer.close();
  if (output.length > MAX_INPUT)
    throw new Error(
      'Compressed drawing exceeds 256 MiB. Remove stored results or save a compact copy.',
    );
  return output;
}

export async function unpackDsn(input: Uint8Array): Promise<{
  xml: string;
  payloads: Payloads;
  representation: 'zip-v1' | 'xml';
}> {
  if (input.length > MAX_INPUT) throw new Error('Drawing exceeds 256 MiB.');
  if (!(input[0] === 0x50 && input[1] === 0x4b))
    return { xml: decodeXml(input), payloads: {}, representation: 'xml' };
  if (input[2] !== 3 || input[3] !== 4)
    throw new Error('Invalid or empty compressed drawing header.');
  const reader = new ZipReader(new Uint8ArrayReader(input), {
    useWebWorkers: false,
    useCompressionStream: false,
    checkAmbiguity: true,
  });
  try {
    const entries = await reader.getEntries();
    if (entries.length > MAX_ENTRIES)
      throw new Error('Drawing archive contains too many entries.');
    const names = new Set<string>();
    let size = 0;
    for (const entry of entries) {
      if (
        names.has(entry.filename) ||
        entry.encrypted ||
        entry.symlink ||
        entry.executable ||
        entry.directory ||
        entry.zip64 ||
        entry.diskNumberStart !== 0 ||
        ![0, 8].includes(entry.compressionMethod) ||
        (!['mimetype', 'manifest.json'].includes(entry.filename) &&
          !validPath(entry.filename))
      )
        throw new Error('Unsafe or duplicate drawing archive entry.');
      names.add(entry.filename);
      size += entry.uncompressedSize;
      if (!Number.isSafeInteger(size) || size > MAX_DECODED)
        throw new Error('Decoded drawing exceeds its size limit.');
      const cap =
        entry.filename === 'manifest.json'
          ? 4 * 1024 * 1024
          : entry.filename === 'mimetype'
          ? 128
          : entry.filename === 'drawing.xml'
          ? 32 * 1024 * 1024
          : entry.filename.endsWith('index.json')
          ? 4 * 1024 * 1024
          : 64 * 1024 * 1024;
      if (entry.uncompressedSize > cap)
        throw new Error('Drawing archive entry exceeds its size limit.');
    }
    const read = async (name: string): Promise<Uint8Array> => {
      const entry = entries.find((e) => e.filename === name);
      if (!entry || entry.directory || !('getData' in entry))
        throw new Error(`Missing drawing entry: ${name}`);
      const chunks: Uint8Array[] = [];
      let actual = 0;
      const writable = new WritableStream<Uint8Array>({
        write(chunk) {
          actual += chunk.length;
          if (actual > entry.uncompressedSize || actual > MAX_INPUT)
            throw new Error('Archive decoded beyond its declared limit.');
          chunks.push(new Uint8Array(chunk));
        },
      });
      await entry.getData(writable, { checkSignature: true });
      if (actual !== entry.uncompressedSize)
        throw new Error('Truncated drawing entry.');
      const data = new Uint8Array(actual);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.length;
      }
      return data;
    };
    if (decoder.decode(await read('mimetype')) !== DSN_MIME)
      throw new Error('ZIP file is not a TinyCAD drawing.');
    const manifest = JSON.parse(decoder.decode(await read('manifest.json')));
    if (
      manifest.format !== 'tinycad-dsn' ||
      manifest.containerVersion !== 1 ||
      manifest.documentSchemaVersion !== 1 ||
      !Array.isArray(manifest.entries)
    )
      throw new Error('Unsupported compressed drawing version.');
    if (manifest.entries.length !== entries.length - 2)
      throw new Error('Drawing archive inventory does not match its contents.');
    const payloads: Payloads = {};
    const listed = new Set<string>();
    for (const item of manifest.entries) {
      if (!validPath(item.path) || listed.has(item.path))
        throw new Error('Invalid drawing inventory.');
      listed.add(item.path);
      const data = await read(item.path);
      if (item.size !== data.length || item.sha256 !== (await digest(data)))
        throw new Error(`Damaged drawing entry: ${item.path}`);
      payloads[item.path] = data;
    }
    if (!payloads['drawing.xml'])
      throw new Error('Compressed drawing has no document XML.');
    const xml = decodeXml(payloads['drawing.xml']);
    delete payloads['drawing.xml'];
    return { xml, payloads, representation: 'zip-v1' };
  } finally {
    await reader.close();
  }
}
