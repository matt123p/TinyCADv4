import { dsnImage } from './dsnItem';
import { libImage, Size } from './dsnDrawing';

export const imageClipFields = [
  'clip_left',
  'clip_right',
  'clip_top',
  'clip_bottom',
] as const;
export type ImageClipField = (typeof imageClipFields)[number];
export type ImageProperties = Pick<dsnImage, ImageClipField | 'fixed_aspect'>;
const dimensions = new WeakMap<libImage, Size>();

// Read dimensions from the original embedded bitmap, including legacy files
// whose IMAGE resources do not have separate pixel dimensions.
export function imagePixelSize(image: libImage): Size {
  const cached = dimensions.get(image);
  if (cached) return cached;
  let size: Size = [1, 1];
  try {
    const base64 = image.imageData.split(',')[1];
    const header = atob(base64.slice(0, 44));
    const u32 = (s: string, i: number) =>
      s.charCodeAt(i) * 0x1000000 +
      (s.charCodeAt(i + 1) << 16) +
      (s.charCodeAt(i + 2) << 8) +
      s.charCodeAt(i + 3);
    if (header.startsWith('\x89PNG\r\n\x1a\n'))
      size = [u32(header, 16), u32(header, 20)];
    else if (header.charCodeAt(0) === 255 && header.charCodeAt(1) === 216) {
      const bytes = atob(base64);
      for (let i = 2; i + 8 < bytes.length; ) {
        if (bytes.charCodeAt(i++) !== 255) break;
        while (bytes.charCodeAt(i) === 255) i++;
        const marker = bytes.charCodeAt(i++);
        if (marker === 218 || marker === 217) break;
        const length = bytes.charCodeAt(i) * 256 + bytes.charCodeAt(i + 1);
        if (length < 2 || i + length > bytes.length) break;
        if (
          [
            192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
          ].includes(marker)
        ) {
          size = [
            bytes.charCodeAt(i + 5) * 256 + bytes.charCodeAt(i + 6),
            bytes.charCodeAt(i + 3) * 256 + bytes.charCodeAt(i + 4),
          ];
          break;
        }
        i += length;
      }
    }
  } catch {
    /* Invalid legacy resources retain a safe, unclipped viewport. */
  }
  if (!size.every((value) => Number.isFinite(value) && value > 0))
    size = [1, 1];
  dimensions.set(image, size);
  return size;
}

export function imageClip(item: dsnImage): Record<ImageClipField, number> {
  const [width, height] = imagePixelSize(item.imageData);
  const pixel = (value: number, max: number) =>
    Math.min(max, Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0));
  const clip_left = pixel(item.clip_left, width - 1);
  const clip_right = pixel(item.clip_right, width - clip_left - 1);
  const clip_top = pixel(item.clip_top, height - 1);
  const clip_bottom = pixel(item.clip_bottom, height - clip_top - 1);
  return { clip_left, clip_right, clip_top, clip_bottom };
}

export function setImageProperties(
  item: dsnImage,
  patch: ImageProperties & { reset_aspect?: boolean },
): dsnImage {
  const [width, height] = imagePixelSize(item.imageData);
  const before = imageClip(item);
  const after = { ...before };
  const opposite = {
    clip_left: 'clip_right',
    clip_right: 'clip_left',
    clip_top: 'clip_bottom',
    clip_bottom: 'clip_top',
  } as const;
  for (const key of imageClipFields) {
    if (patch[key] == null || !Number.isFinite(patch[key])) continue;
    const dimension =
      key === 'clip_left' || key === 'clip_right' ? width : height;
    after[key] = Math.max(
      0,
      Math.min(dimension - after[opposite[key]] - 1, Math.floor(patch[key])),
    );
  }
  if (
    !patch.reset_aspect &&
    imageClipFields.every((key) => before[key] === after[key]) &&
    (patch.fixed_aspect == null ||
      patch.fixed_aspect === (item.fixed_aspect ?? false))
  )
    return item;
  const sx =
    (item.point_b[0] - item.point[0]) /
    (width - before.clip_left - before.clip_right);
  const sy =
    (item.point_b[1] - item.point[1]) /
    (height - before.clip_top - before.clip_bottom);
  const result: dsnImage = {
    ...item,
    ...after,
    fixed_aspect: patch.fixed_aspect ?? item.fixed_aspect ?? false,
    point: [
      item.point[0] + (after.clip_left - before.clip_left) * sx,
      item.point[1] + (after.clip_top - before.clip_top) * sy,
    ],
    point_b: [
      item.point_b[0] - (after.clip_right - before.clip_right) * sx,
      item.point_b[1] - (after.clip_bottom - before.clip_bottom) * sy,
    ],
  };
  if (patch.reset_aspect) {
    const visibleWidth = width - after.clip_left - after.clip_right;
    const visibleHeight = height - after.clip_top - after.clip_bottom;
    result.point_b = [result.point_b[0], result.point[1] +
      (result.point_b[0] - result.point[0]) * visibleHeight / visibleWidth];
  }
  return result;
}
