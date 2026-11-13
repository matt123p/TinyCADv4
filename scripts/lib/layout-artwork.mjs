import { readFileSync } from 'node:fs';
const metricsSource = readFileSync(
  new URL('../../src/util/font_metrics/Arial.js', import.meta.url),
  'utf8',
);
const metrics = JSON.parse(
  metricsSource.slice(
    metricsSource.indexOf('{'),
    metricsSource.lastIndexOf('}') + 1,
  ),
);
export const escapeXML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[
        c
      ]),
  );
export const bgr = (rgb) => rgb.slice(4, 6) + rgb.slice(2, 4) + rgb.slice(0, 2);
export function textWidth(value, size = 6) {
  let width = 0,
    last = '';
  for (const char of String(value)) {
    const code = String(char.charCodeAt(0));
    width += metrics.regular.widths[code] ?? metrics.regular.widths['77'];
    if (last && metrics.regular.kerning[last]?.[code])
      width += metrics.regular.kerning[last][code];
    last = code;
  }
  return ((width / metrics.size) * size * 1.35 + 7) / 5;
}
export function note(
  x,
  y,
  value,
  {
    size = 6,
    font = 1,
    colour = 'f4f8f6',
    vertical = false,
    above = false,
  } = {},
) {
  const length = textWidth(value, size),
    thickness = (size * 1.45 + 7) / 5;
  const left = vertical ? x - thickness / 2 : x - 0.6,
    top = vertical ? (above ? y - length : y) : y - (size + 3) / 5;
  return `<NOTE_TEXT a="${left},${top}" b="${
    left + (vertical ? thickness : length)
  },${top + (vertical ? length : thickness)}" direction="${
    vertical ? 0 : 3
  }" font="${font}" color="${bgr(
    colour,
  )}" style="1" fill="0" border_style="2">${escapeXML(value)}</NOTE_TEXT>`;
}
export function vectorCanvas(colours = {}) {
  const palette = {
      ink: '263645',
      metal: 'cbd4dc',
      white: 'f4f7fa',
      dark: '26313d',
      edge: '8393a2',
      gold: 'd8b760',
      blue: '487aaf',
      green: '69b59b',
      red: 'd88e8e',
      amber: 'e5bd73',
      ...colours,
    },
    names = Object.keys(palette),
    art = [];
  const fill = (c) => (c ? names.indexOf(c) + 1 : 0);
  const resources = [
    ...[6, 8, 10].map(
      (h, i) =>
        `<FONT id="${i + 1}"><HEIGHT>${h}</HEIGHT><WIDTH>0</WIDTH><WEIGHT>${
          i === 2 ? 700 : 400
        }</WEIGHT><ITALIC>0</ITALIC><UNDERLINE>0</UNDERLINE><STRIKEOUT>0</STRIKEOUT><CHARSET>0</CHARSET><FACENAME>Arial</FACENAME></FONT>`,
    ),
    ...[
      ['ink', 1],
      ['edge', 1],
      ['gold', 1],
    ].map(
      ([c, t], i) =>
        `<STYLE id="${i + 1}"><STYLE>0</STYLE><COLOR>${bgr(
          palette[c],
        )}</COLOR><THICKNESS>${t}</THICKNESS></STYLE>`,
    ),
    ...names.map(
      (c) =>
        `<FILL id="${fill(c)}"><INDEX>0</INDEX><COLOR>${bgr(
          palette[c],
        )}</COLOR></FILL>`,
    ),
  ];
  const rect = (x, y, w, h, c = 'metal', s = 1) =>
    art.push(
      `<RECTANGLE a="${x},${y}" b="${x + w},${y + h}" style="${s}" fill="${fill(
        c,
      )}"/>`,
    );
  const ellipse = (x, y, w, h, c = 'white', s = 1) =>
    art.push(
      `<ELLIPSE a="${x},${y}" b="${x + w},${y + h}" style="${s}" fill="${fill(
        c,
      )}"/>`,
    );
  const poly = (pts, c = null, s = 1) =>
    art.push(
      `<POLYGON pos="0,0" style="${s}" fill="${fill(c)}">${pts
        .map(([x, y]) => `<POINT pos="${x},${y}" arc="0"/>`)
        .join('')}</POLYGON>`,
    );
  const line = (x, y, x2, y2, s = 1) =>
    poly(
      [
        [x, y],
        [x2, y2],
      ],
      null,
      s,
    );
  const text = (x, y, value, font = 1, c = 'ink') =>
    art.push(
      note(x, y, value, {
        size: [6, 8, 10][font - 1],
        font,
        colour: palette[c],
      }),
    );
  return {
    art,
    resources,
    palette,
    fill,
    rect,
    ellipse,
    poly,
    line,
    text,
    xml: () =>
      '<TinyCAD>\n' + [...resources, ...art].join('\n') + '\n</TinyCAD>\n',
  };
}
