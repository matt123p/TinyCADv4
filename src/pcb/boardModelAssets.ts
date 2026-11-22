import { digest } from '../util/sha256';
import type { BoardModelAsset } from './boardAssets';

const maxAssetBytes = 32 * 1024 * 1024;

export async function createBoardModelAsset(
  bytes: Uint8Array,
  source: string,
  license?: string,
): Promise<BoardModelAsset> {
  if (
    !bytes.length ||
    bytes.length > maxAssetBytes ||
    !source?.trim() ||
    (license !== undefined && !license.trim())
  )
    throw new Error('Invalid STEP asset size or provenance.');
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 24576)
    chunks.push(
      btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24576))),
    );
  return {
    id: await digest(bytes),
    mediaType: 'model/step',
    source,
    ...(license === undefined ? {} : { license }),
    base64: chunks.join(''),
  };
}

export async function readBoardModelAsset(
  asset: BoardModelAsset,
): Promise<Uint8Array> {
  const { base64 } = asset;
  if (
    typeof base64 !== 'string' ||
    !base64.length ||
    base64.length % 4 ||
    base64.length > Math.ceil(maxAssetBytes / 3) * 4
  )
    throw new Error('Invalid STEP asset encoding or size.');
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const decodedLength = (base64.length / 4) * 3 - padding;
  if (decodedLength > maxAssetBytes)
    throw new Error('Invalid STEP asset encoding or size.');

  const bytes = new Uint8Array(decodedLength);
  const chunkSize = 32_768;
  for (let offset = 0; offset < base64.length; offset += chunkSize) {
    const chunk = base64.slice(offset, offset + chunkSize);
    const start = (offset / 4) * 3;
    const expected = Math.min((chunk.length / 4) * 3, decodedLength - start);
    const raw = atob(chunk);
    // Only the last chunk may have padding. Re-encoding also rejects noncanonical pad bits.
    if (raw.length !== expected || btoa(raw) !== chunk)
      throw new Error('Invalid STEP asset encoding or size.');
    for (let i = 0; i < raw.length; i++) bytes[start + i] = raw.charCodeAt(i);
  }
  if ((await digest(bytes)) !== asset.id)
    throw new Error('STEP asset SHA-256 does not match its ID.');
  return bytes;
}
