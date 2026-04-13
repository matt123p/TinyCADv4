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
  size: number;
};

const DEFAULT_FONT_SIZE = 10;
const FALLBACK_GLYPH = '77';
const SPACE_GLYPH = '32';

function parseFont(font: string) {
  const match = /^\s*(\d+(?:\.\d+)?)px\s+(.+?)\s*$/i.exec(font || '');
  if (!match) {
    return {
      size: DEFAULT_FONT_SIZE,
      family: 'Arial',
    };
  }

  return {
    size: Math.max(1, Number.parseFloat(match[1]) || DEFAULT_FONT_SIZE),
    family: match[2],
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

function glyphWidth(metrics: FontMetrics, charCode: number) {
  const widths = metrics.regular.widths;
  const code = String(charCode);
  if (widths[code] != null) {
    return widths[code];
  }
  if (widths[FALLBACK_GLYPH] != null) {
    return widths[FALLBACK_GLYPH];
  }
  if (widths[SPACE_GLYPH] != null) {
    return widths[SPACE_GLYPH];
  }
  return metrics.size * 0.6;
}

export function getFont(item: Text) {
  return item.font_size + 'px ' + item.font_name;
}

export function measureText(font: string, value: string) {
  if (!value) {
    return 0;
  }

  const { size, family } = parseFont(font);
  const metrics = selectMetrics(family);
  let width = 0;
  let previous = '';

  for (let index = 0; index < value.length; ++index) {
    const charCode = value.charCodeAt(index);
    const code = String(charCode);
    width += glyphWidth(metrics, charCode);

    if (previous && metrics.regular.kerning[previous]?.[code] != null) {
      width += metrics.regular.kerning[previous][code];
    }

    previous = code;
  }

  return (width / metrics.size) * size;
}

export function measureTextOffset(font: string) {
  const { size } = parseFont(font);
  return size * 0.22;
}
