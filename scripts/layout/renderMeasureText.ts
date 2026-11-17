import {
  measureText as width,
  measureTextOffset as offset,
} from '../../renderer/serverMeasureText';
// Preview generation is headless. Reserve extra room for platform font fallback
// and bold advances; the editor reflows the stored Markdown with its own canvas.
export function measureText(font: string, text: string) {
  const match = /(\d+(?:\.\d+)?)px\s+(.+)$/.exec(font || '');
  const normalized = match ? match[1] + 'px ' + match[2] : '10px Arial';
  return width(normalized, text) * (/bold/.test(font) ? 1.4 : 1.3);
}
export function measureTextOffset(font: string) {
  return offset(font);
}
export function getFont(item: any) {
  return item.font_size + 'px ' + item.font_name;
}
