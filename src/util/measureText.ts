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
let canvas: HTMLCanvasElement = null;
let context: CanvasRenderingContext2D = null;

export function getFont(item: Text) {
  return item.font_size + 'px ' + item.font_name;
}

export function measureText(font: string, string: string) {
  if (!context) {
    canvas = document.createElement('canvas');
    context = canvas.getContext('2d');
  }
  context.font = font;
  const metrics = context.measureText(string);
  return metrics.width;
}

export function measureTextOffset(font: string) {
  if (!context) {
    canvas = document.createElement('canvas');
    context = canvas.getContext('2d');
  }
  context.font = font;
  const metrics = context.measureText('gyEW');
  return metrics.actualBoundingBoxDescent;
}
