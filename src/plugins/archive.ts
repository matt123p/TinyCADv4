import { unzipSync } from 'fflate';
import { check, LIMITS, path } from './validation';

/** Inspect the central directory before allocating decompressed data. */
export function unpackPlugin(bytes: Uint8Array): Record<string, Uint8Array> {
  check(bytes.length <= LIMITS.package && bytes.length >= 22, 'Invalid or oversized plugin archive.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  check(end >= 0, 'ZIP directory is missing.');
  check(view.getUint16(end + 4, true) === 0 && view.getUint16(end + 6, true) === 0, 'Multi-volume ZIP is unsupported.');
  const count = view.getUint16(end + 10, true); check(count > 0 && count <= LIMITS.files, 'Too many archive entries.');
  let cursor = view.getUint32(end + 16, true); let total = 0;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    check(cursor + 46 <= end && view.getUint32(cursor, true) === 0x02014b50, 'Invalid ZIP directory.');
    const length = view.getUint16(cursor + 28, true);
    const extra = view.getUint16(cursor + 30, true); const comment = view.getUint16(cursor + 32, true);
    check(cursor + 46 + length + extra + comment <= end, 'Truncated ZIP directory.');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(cursor + 46, cursor + 46 + length));
    path(name.endsWith('/') ? name.slice(0, -1) : name);
    check(!names.has(name) && !names.has(name.toLowerCase()), 'Duplicate archive path.'); names.add(name); names.add(name.toLowerCase());
    check((view.getUint16(cursor + 8, true) & 1) === 0, 'Encrypted archives are unsupported.');
    const mode = view.getUint32(cursor + 38, true) >>> 16;
    check((mode & 0xf000) !== 0xa000, 'Archive symlinks are not allowed.');
    const size = view.getUint32(cursor + 24, true); check(size <= LIMITS.file, 'Archive file is too large.'); total += size;
    check(total <= LIMITS.package, 'Archive expansion limit exceeded.');
    cursor += 46 + length + extra + comment;
  }
  const decoded = unzipSync(bytes, { filter: file => !file.name.endsWith('/') });
  const files: Record<string, Uint8Array> = Object.create(null);
  for (const [name, data] of Object.entries(decoded)) {
    path(name); check(data.length <= LIMITS.file, 'Archive file exceeds limit.'); files[name] = data;
  }
  check(Object.keys(files).length <= LIMITS.files, 'Too many plugin resources.'); return files;
}
