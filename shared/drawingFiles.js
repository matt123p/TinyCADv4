export const COMPRESSED_DRAWING_MIME = 'application/x-tinycad-dsn+zip';

/** @param {string | Uint8Array} content */
export function isCompressedDrawing(content) {
  return (
    typeof content !== 'string' &&
    content[0] === 0x50 &&
    content[1] === 0x4b &&
    content[2] === 3 &&
    content[3] === 4
  );
}

/** @param {string} name */
export function isDrawingFile(name) {
  return /\.(?:dsn|dzn)$/i.test(name);
}

/** @param {string} name @param {boolean} compressed */
export function drawingFileName(name, compressed) {
  return (
    (name || 'drawing').replace(/(?:\.(?:dsn|dzn))+$/i, '') +
    (compressed ? '.dzn' : '.dsn')
  );
}

/** @param {string | Uint8Array} content */
export function drawingMimeType(content) {
  return isCompressedDrawing(content)
    ? COMPRESSED_DRAWING_MIME
    : 'application/xml';
}
