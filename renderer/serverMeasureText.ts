import ArialMetrics from '../src/util/font_metrics/Arial.js';
import CourierMetrics from '../src/util/font_metrics/Courier.js';
import TimesMetrics from '../src/util/font_metrics/Times.js';
import { Text } from '../src/model/dsnItem';

type FontFaceMetrics = {
  widths: Record<string, number>;
  kerning: Record<string, Record<string, number>>;
};

type FontMetrics = {
  regular: FontFaceMetrics;
  bold: FontFaceMetrics;
  italic: FontFaceMetrics;
  bold_italic: FontFaceMetrics;
  size: number;
};

type FontFace = Exclude<keyof FontMetrics, 'size'>;

const DEFAULT_FONT_SIZE = 10;
const FALLBACK_GLYPH = '77';
const SPACE_GLYPH = '32';

function parseFont(font: string): { size: number; family: string; face: FontFace } {
  const match = /^\s*((?:(?:italic|bold)\s+)*)(\d+(?:\.\d+)?)px\s+(.+?)\s*$/i.exec(font || '');
  if (!match) {
    return {
      size: DEFAULT_FONT_SIZE,
      family: 'Arial',
      face: 'regular',
    };
  }

  const styles = match[1].toLowerCase();
  const bold = styles.includes('bold');
  const italic = styles.includes('italic');
  const face = bold ? (italic ? 'bold_italic' : 'bold') : (italic ? 'italic' : 'regular');
  return {
    size: Math.max(1, Number.parseFloat(match[2]) || DEFAULT_FONT_SIZE),
    family: match[3],
    face,
  };
}

function selectMetrics(family: string): FontMetrics {
  if (/courier/i.test(family)) {
    return CourierMetrics as FontMetrics;
  }
  if (/times/i.test(family)) {
    return TimesMetrics as FontMetrics;
  }
  return ArialMetrics as FontMetrics;
}

function glyphWidth(widths: FontFaceMetrics['widths'], size: number, code: string) {
  if (widths[code] != null) {
    return widths[code];
  }
  if (widths[FALLBACK_GLYPH] != null) {
    return widths[FALLBACK_GLYPH];
  }
  if (widths[SPACE_GLYPH] != null) {
    return widths[SPACE_GLYPH];
  }
  return size * 0.6;
}

export function getFont(item: Text) {
  return item.font_size + 'px ' + item.font_name;
}

export function getStyledFont(item: Text) {
  const style = item.font_italic ? 'italic ' : '';
  const weight = item.font_bold ? 'bold ' : '';
  return style + weight + getFont(item);
}

export function measureText(font: string, value: string) {
  if (!value) {
    return 0;
  }

  const { size, family, face } = parseFont(font);
  const metrics = selectMetrics(family);
  const { widths, kerning } = metrics[face];
  let width = 0;
  let previous = '';

  for (let index = 0; index < value.length; ++index) {
    const code = String(value.charCodeAt(index));
    width += glyphWidth(widths, metrics.size, code);

    if (previous) {
      width += kerning[previous]?.[code] ?? 0;
    }

    previous = code;
  }

  return (width / metrics.size) * size;
}

export function measureTextOffset(font: string) {
  const { size } = parseFont(font);
  return size * 0.22;
}
