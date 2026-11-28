//
// The measure text service
//

import { Text } from '../model/dsnItem';

//
// import Arial from './font_metrics/Arial';

/*
export function measureText(font, string) {
  var px = font.indexOf('px');
  var size = font.substr(0, px) | 0;
  var face = font.substr(px + 2).trim();

  var f = Arial.regular;
  var last_c = 0;
  var width = 0;
  for (var i = 0; i < string.length; ++i) {
    var c = string.charCodeAt(i);

    width += f.widths[c];
    if (last_c in f.kerning) {
      if (c in f.kerning[last_c]) {
        width += f.kerning[last_c][c];
      }
    }
    last_c = c;
  }

  return width / Arial.size * size;
}
*/

// re-use canvas object for better performance
let context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D = null;

export function loadDrawingFonts() {
  const families = ['Arial', 'Courier New', 'Times'];
  const styles = ['normal', 'bold', 'italic', 'italic bold'];

  // Canvas can measure with a fallback while a font loads. Wait for the
  // bundled faces before storing line breaks derived from their widths.
  return Promise.allSettled(
    families.flatMap((family) =>
      styles.map((style) => document.fonts.load(`${style} 10px "${family}"`)),
    ),
  );
}

function textContext() {
  if (!context) {
    const canvas = typeof document === 'undefined'
      ? new OffscreenCanvas(1, 1)
      : document.createElement('canvas');
    context = canvas.getContext('2d') as typeof context;
  }
  return context;
}

export function getFont(item: Text) {
  return item.font_size + 'px ' + item.font_name;
}

export function getStyledFont(item: Text) {
  const style = item.font_italic ? 'italic ' : '';
  const weight = item.font_bold ? 'bold ' : '';
  return style + weight + getFont(item);
}

export function measureText(font: string, string: string) {
  const ctx = textContext();
  ctx.font = font;
  const metrics = ctx.measureText(string);
  return metrics.width;
}

export function measureTextOffset(font: string) {
  const ctx = textContext();
  ctx.font = font;
  const metrics = ctx.measureText('gyEW');
  return metrics.actualBoundingBoxDescent;
}
