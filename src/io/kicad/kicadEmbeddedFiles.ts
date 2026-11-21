import { Decompress } from 'fzstd';

export const maxKicadModelBytes = 8 * 1024 * 1024;

function frameContentSize(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  if (bytes.length < 6 || view.getUint32(0, true) !== 0xfd2fb528)
    throw new Error('Invalid KiCad embedded model compression.');

  const descriptor = bytes[4];
  const singleSegment = !!(descriptor & 0x20);
  const sizeField = [singleSegment ? 1 : 0, 2, 4, 8][descriptor >> 6];
  const sizeOffset = singleSegment ? 5 : 6;
  const headerEnd = sizeOffset + sizeField;
  if (!sizeField || (descriptor & 0x0b) || headerEnd > bytes.length)
    throw new Error('Unsupported KiCad embedded model compression.');

  const contentSize = sizeField === 1 ? bytes[sizeOffset] :
    sizeField === 2 ? view.getUint16(sizeOffset, true) + 256 :
    sizeField === 8 && view.getUint32(sizeOffset + 4, true) !== 0 ? Infinity :
    view.getUint32(sizeOffset, true);
  const windowBase = 2 ** (10 + (bytes[5] >> 3));
  const windowSize = singleSegment ? contentSize : windowBase * (1 + (bytes[5] & 7) / 8);
  if (contentSize > maxKicadModelBytes || windowSize > maxKicadModelBytes)
    throw new Error('KiCad embedded SPICE model exceeds 8 MiB.');

  // KiCad writes one frame. Reject trailing frames before the decoder can
  // allocate memory from another header.
  let offset = headerEnd;
  while (offset + 3 <= bytes.length) {
    const block = bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16;
    const type = (block >> 1) & 3;
    if (type === 3) break;
    offset += 3 + (type === 1 ? 1 : block >> 3);
    if (block & 1) {
      if (offset + (descriptor & 4 ? 4 : 0) === bytes.length) return contentSize;
      break;
    }
  }
  throw new Error('Invalid KiCad embedded model frame.');
}

export function decodeKicadEmbeddedModel(payload: string): string {
  if (payload.length > Math.ceil((maxKicadModelBytes + 65536) / 3) * 4)
    throw new Error('KiCad embedded SPICE model exceeds 8 MiB.');
  const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
  const output = new Uint8Array(frameContentSize(bytes));
  let length = 0;
  const decoder = new Decompress((chunk) => {
    if (length + chunk.length > output.length)
      throw new Error('Invalid KiCad embedded model length.');
    output.set(chunk, length);
    length += chunk.length;
  });
  decoder.push(bytes, true);
  if (length !== output.length) throw new Error('Invalid KiCad embedded model length.');
  return new TextDecoder('utf-8', { fatal: true }).decode(output);
}
