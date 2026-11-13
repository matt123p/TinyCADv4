import { createHash } from 'node:crypto';
import { vectorCanvas, escapeXML, textWidth } from './layout-artwork.mjs';

// Original equipment silhouettes. Each port is a whole cable, never a raw pinout.
export function audioSymbol(device) {
  const c = vectorCanvas(),
    { rect, ellipse, line, poly, text, art } = c;
  const ports = device.ports.map((p, i) => ({ ...p, number: String(i + 1) }));
  let w = 36,
    h = 26;
  const positions = [];
  const row = (list, x, y, pitch = 6) =>
    list.forEach((p, i) => positions.push({ ...p, x: x + i * pitch, y }));
  const panel = (width, height) => {
    w = width;
    h = height;
    rect(0, 0, w, h, 'dark');
    rect(1, 1, w - 2, h - 2, null, 2);
  };
  const knob = (x, y, r = 1) => {
    ellipse(x - r, y - r, r * 2, r * 2, 'metal');
    line(x, y - r, x, y);
  };
  const fader = (x, y, length = 12) => {
    rect(x - 0.3, y, 0.6, length, 'ink');
    rect(x - 1.1, y + length * 0.55, 2.2, 1.2, 'white');
  };
  const grille = (x, y, width, height) => {
    rect(x, y, width, height, 'ink');
    for (let yy = y + 1; yy < y + height; yy += 1.6)
      line(x + 0.6, yy, x + width - 0.6, yy, 2);
  };
  const basicPorts = (columns = 6, startY = 6) => {
    for (let i = 0; i < ports.length; i += columns)
      row(ports.slice(i, i + columns), 4, startY + Math.floor(i / columns) * 8);
  };
  switch (device.kind) {
    case 'microphone': {
      w = 24;
      h = 36;
      if (device.shape === 'boundary') {
        poly(
          [
            [2, 8],
            [20, 8],
            [23, 25],
            [0, 25],
          ],
          'dark',
        );
        grille(5, 10, 12, 10);
      } else if (device.shape === 'gooseneck') {
        ellipse(2, 26, 20, 6, 'dark');
        poly(
          [
            [12, 26],
            [12, 16],
            [19, 6],
            [16, 2],
          ],
          null,
        );
        ellipse(13, 0, 6, 4, 'dark');
      } else if (['lavalier', 'headset'].includes(device.shape)) {
        rect(2, 18, 18, 15, 'dark');
        line(6, 18, 6, 12);
        line(6, 12, 18, 8);
        if (device.shape === 'headset') {
          ellipse(3, 1, 18, 12, null);
          ellipse(17, 7, 4, 3, 'dark');
        } else {
          ellipse(17, 3, 4, 6, 'dark');
          line(15, 5, 15, 11);
        }
      } else {
        const pencil = device.shape === 'pencil',
          ribbon = device.shape === 'ribbon';
        rect(pencil ? 9 : 7, 10, pencil ? 6 : 10, 20, 'metal');
        if (device.shape === 'dynamic') {
          ellipse(6, 1, 12, 13, 'metal');
          grille(7, 4, 10, 6);
          rect(8, 14, 8, 14, 'dark');
        } else {
          rect(pencil ? 9 : 5, 2, pencil ? 6 : 14, ribbon ? 21 : 18, 'metal');
          grille(pencil ? 10 : 6, 3, pencil ? 4 : 12, ribbon ? 19 : 16);
        }
        if (device.id === 'mic-usb') {
          poly(
            [
              [4, 12],
              [4, 29],
              [20, 29],
              [20, 12],
            ],
            null,
          );
          rect(8, 30, 8, 2, 'dark');
        }
      }
      row(
        ports,
        ports.length === 1 ? 12 : 8,
        device.shape === 'boundary'
          ? 26
          : ['lavalier', 'headset'].includes(device.shape)
          ? 34
          : 30,
        8,
      );
      break;
    }
    case 'mixer': {
      const mono = device.mono ?? device.inputs ?? 4;
      const columns = mono > 16 ? Math.ceil(mono / 2) : mono;
      panel(Math.max(46, columns * 6 + 12), device.digital ? 66 : 72);
      const inputs = ports.filter((p) => /^(?:IN|MIC) \d+$/.test(p.name));
      const rest = ports.filter((p) => !inputs.includes(p));
      for (let i = 0; i < inputs.length; i += columns)
        row(inputs.slice(i, i + columns), 6, 6 + Math.floor(i / columns) * 8);
      const outColumns = Math.floor((w - 8) / 6);
      for (let i = 0; i < rest.length; i += outColumns)
        row(
          rest.slice(i, i + outColumns),
          4,
          inputs.length > columns
            ? 24 + Math.floor(i / outColumns) * 8
            : 16 + Math.floor(i / outColumns) * 8,
        );
      const strips = device.digital ? Math.min(12, mono) : mono + 3;
      const stripPitch = (w - 8) / strips;
      for (let i = 0; i < strips; i++) {
        const x = 4 + (i + 0.5) * stripPitch;
        rect(
          x - stripPitch * 0.4,
          38,
          stripPitch * 0.8,
          h - 41,
          i % 2 ? 'ink' : 'dark',
          2,
        );
        if (!device.digital) {
          knob(x, 40, 0.7);
          knob(x, 44, 0.7);
          knob(x, 48, 0.7);
        }
        fader(x, device.digital ? 49 : 52, 14);
        if (!device.digital) rect(x - 1, 68, 2, 1, 'green');
      }
      if (device.digital) {
        const screenWidth = w - 26;
        rect(7, 35, screenWidth, 10, 'blue');
        for (let i = 0; i < Math.min(8, Math.floor((screenWidth - 3) / 4)); i++)
          rect(9 + i * 4, 37, 2, 6, 'green');
        knob(w - 9, 39, 2);
      }
      break;
    }
    case 'interface':
    case 'recorder':
    case 'box':
    case 'beltpack': {
      const cols = Math.min(
        device.kind === 'beltpack' ? 3 : 8,
        Math.max(1, ports.length),
      );
      panel(
        Math.max(24, cols * 6 + 4),
        Math.ceil(ports.length / cols) * 8 + 14,
      );
      basicPorts(cols);
      if (device.kind === 'recorder') {
        rect(7, h - 10, w - 14, 5, 'blue');
        ellipse(5, h - 6, 2, 2, 'red');
      } else {
        knob(w - 6, h - 5, 2);
        for (let i = 0; i < Math.min(4, ports.length); i++)
          ellipse(4 + i * 3, h - 6, 1, 1, 'green');
      }
      if (device.kind === 'beltpack') {
        line(w - 3, 0, w - 3, -5);
        rect(3, h - 10, w - 12, 4, 'blue');
      }
      break;
    }
    case 'rack': {
      panel(64, (device.rack ?? 1) * 12);
      rect(0, 0, 3, h, 'metal');
      rect(w - 3, 0, 3, h, 'metal');
      for (const x of [1.5, w - 1.5])
        for (const y of [2, h - 2]) ellipse(x - 0.4, y - 0.4, 0.8, 0.8, 'ink');
      const columns = 9;
      for (let i = 0; i < ports.length; i += columns)
        row(ports.slice(i, i + columns), 6, 6 + Math.floor(i / columns) * 8, 6);
      if (ports.length < 7) {
        for (let i = 0; i < 4; i++) knob(8 + i * 6, h - 3, 0.7);
        rect(38, 2, 12, 3, 'blue');
      }
      break;
    }
    case 'computer': {
      const phone = device.shape === 'phone',
        pc = device.shape === 'pc';
      w = phone ? 24 : 48;
      h = phone ? 34 : 38;
      if (pc) {
        rect(4, 0, 30, 36, 'dark');
        rect(7, 4, 24, 4, 'ink');
        ellipse(29, 12, 2, 2, 'green');
        grille(7, 24, 24, 8);
      } else {
        rect(2, 0, w - 4, phone ? 29 : 24, 'dark');
        rect(4, 2, w - 8, phone ? 23 : 19, 'blue');
        if (!phone) {
          poly(
            [
              [2, 24],
              [w - 2, 24],
              [w, 34],
              [0, 34],
            ],
            'metal',
          );
          for (let y = 26; y < 30; y += 1.5) line(5, y, w - 5, y);
          rect(18, 30, 12, 3, 'dark');
        }
      }
      row(ports, 4, h - 2, phone ? 12 : 6);
      break;
    }
    case 'camera': {
      panel(30, 28);
      rect(3, 3, 18, 11, 'metal');
      ellipse(7, 4, 10, 10, 'dark');
      rect(21, 5, 7, 8, 'ink');
      line(10, 16, 10, 20);
      line(10, 20, 3, 25);
      line(10, 20, 18, 25);
      row(ports, 4, 26, 8);
      break;
    }
    case 'speaker': {
      const wedge = device.shape === 'wedge',
        sub = device.shape === 'sub',
        column = device.shape === 'column';
      w = column ? 24 : 32;
      h = column
        ? 56
        : sub
        ? 34
        : device.shape === 'array'
        ? 26
        : device.shape === 'installed'
        ? 28
        : 44;
      if (wedge)
        poly(
          [
            [0, 10],
            [w - 6, 0],
            [w, 25],
            [0, 30],
          ],
          'dark',
        );
      else rect(0, 0, w - 10, h, 'dark');
      const faceW = wedge ? w - 8 : w - 12;
      if (column) {
        for (let y = 4; y < 40; y += 6) ellipse(5, y, 6, 6, 'ink');
        rect(1, 42, 12, 12, 'ink');
      } else if (device.shape === 'installed') {
        ellipse(0, 0, 22, 22, 'metal');
        ellipse(2, 2, 18, 18, 'ink');
        ellipse(8, 8, 6, 6, 'dark');
      } else if (device.shape === 'array') {
        poly(
          [
            [0, 2],
            [22, 0],
            [20, 24],
            [2, 22],
          ],
          'dark',
        );
        grille(4, 4, 13, 15);
      } else {
        const diameter = wedge ? 14 : faceW - 4,
          y = sub ? 3 : wedge ? 12 : 14;
        ellipse(3, y, diameter, diameter, 'ink');
        ellipse(3 + diameter / 2 - 2.5, y + diameter / 2 - 2.5, 5, 5, 'dark');
        if (!sub) {
          rect(4, 3, faceW - 6, 7, 'ink');
        }
      }
      rect(w - 8, 0, 8, h, 'metal');
      ports.forEach((p, i) => positions.push({ ...p, x: w - 4, y: 6 + i * 8 }));
      if (device.shape === 'guitar' || device.shape === 'bass') {
        rect(0, 0, w - 10, 8, 'metal');
        for (let i = 0; i < 4; i++) knob(3 + i * 4, 4, 0.6);
      }
      break;
    }
    case 'headphones': {
      w = 28;
      h = 32;
      ellipse(2, 0, 24, 25, 'dark');
      ellipse(5, 3, 18, 22, 'white');
      rect(1, 13, 6, 13, 'dark');
      rect(21, 13, 6, 13, 'dark');
      line(4, 25, 4, 30);
      row(ports, 4, 30);
      break;
    }
    case 'guitar': {
      w = 24;
      h = 50;
      ellipse(2, 25, 20, 22, device.shape === 'acoustic' ? 'amber' : 'red');
      ellipse(5, 21, 14, 15, device.shape === 'acoustic' ? 'amber' : 'red');
      rect(10, 3, 4, 32, 'metal');
      rect(9, 0, 6, 8, 'amber');
      if (device.shape === 'acoustic') ellipse(9, 32, 6, 6, 'dark');
      else {
        rect(8, 32, 8, 2, 'dark');
        rect(8, 37, 8, 2, 'dark');
      }
      for (let i = 0; i < (device.shape === 'bass' ? 4 : 6); i++)
        line(10.5 + i * 0.5, 3, 10.5 + i * 0.5, 43, 2);
      row(ports, 20, 44);
      break;
    }
    case 'keyboard': {
      const keys = device.keys ?? 25;
      w = keys === 88 ? 86 : keys === 61 ? 70 : keys === 49 ? 60 : 42;
      h = 32;
      panel(w, h);
      row(ports, 4, 6, 6);
      const count = Math.round((keys * 7) / 12),
        keyW = (w - 8) / count;
      for (let i = 0; i < count; i++) {
        rect(4 + i * keyW, 16, keyW, 13, 'white');
        if (![2, 6].includes(i % 7) && i < count - 1)
          rect(4 + (i + 0.7) * keyW, 16, keyW * 0.6, 8, 'ink');
      }
      rect(6, 10, 13, 3, 'blue');
      knob(w - 7, 12);
      break;
    }
    case 'pads': {
      panel(device.dj ? 66 : 42, 36);
      row(ports, 4, 6, 6);
      if (device.dj) {
        for (const x of [14, 50]) {
          ellipse(x - 9, 12, 18, 18, 'metal');
          ellipse(x - 5, 16, 10, 10, 'ink');
        }
        for (let i = 0; i < 3; i++) fader(28 + i * 4, 15, 15);
      } else {
        for (let y = 0; y < 4; y++)
          for (let x = 0; x < 4; x++)
            rect(4 + x * 5, 12 + y * 5, 4, 4, (x + y) % 3 ? 'metal' : 'amber');
        rect(26, 13, 12, 6, 'blue');
        knob(31, 27, 3);
      }
      break;
    }
    case 'stagebox': {
      const inputs = ports.filter((p) => /^(?:IN|MIC) \d+$/.test(p.name)),
        outs = ports.filter((p) => /^OUT \d+$/.test(p.name)),
        other = ports.filter((p) => !inputs.includes(p) && !outs.includes(p));
      const cols = inputs.length > 16 ? 12 : 8;
      panel(cols * 6 + 8, 42);
      for (let i = 0; i < inputs.length; i += cols)
        row(inputs.slice(i, i + cols), 6, 6 + Math.floor(i / cols) * 8);
      row(outs, 6, 26);
      row(other, 6, 36, 10);
      rect(0, 0, 2, h, 'metal');
      rect(w - 2, 0, 2, h, 'metal');
      break;
    }
    case 'patchbay': {
      panel(64, 12);
      rect(0, 0, 3, h, 'metal');
      rect(w - 3, 0, 3, h, 'metal');
      row(ports.slice(0, 24), 8, 4, 2);
      row(ports.slice(24), 8, 10, 2);
      text(2, 3, 'A', 1, 'ink');
      text(2, 9, 'B', 1, 'ink');
      break;
    }
    case 'connector': {
      w = 24;
      h = 20;
      const kind = ports[0].kind;
      if (['jack', 'minijack'].includes(kind)) {
        rect(1, 8, 12, 4, 'metal');
        const rings =
          device.id === 'connector-ts-instrument'
            ? [4]
            : device.id === 'connector-trrs-ctia'
            ? [3, 6, 9]
            : [4, 8];
        for (const x of rings) rect(x, 8, 0.6, 4, 'ink');
        rect(12, 6, 8, 8, 'dark');
        rect(1, 8, 2, 4, 'gold');
      } else if (
        kind.startsWith('xlr') ||
        ['din5', 'speakon', 'rca'].includes(kind)
      ) {
        rect(1, 6, 12, 8, kind === 'speakon' ? 'blue' : 'metal');
        rect(3, 5, 3, 10, 'dark');
        ellipse(14, 6, 8, 8, 'metal');
        line(0, 8, 1, 8);
        line(0, 12, 1, 12);
      } else {
        poly(
          [
            [0, 7],
            [5, 7],
            [8, 5],
            [18, 5],
            [22, 8],
            [22, 13],
            [8, 15],
            [5, 12],
            [0, 12],
          ],
          'metal',
        );
        if (kind === 'ethernet') rect(8, 3, 7, 2, 'white');
      }
      row(ports, 18, 10);
      break;
    }
    case 'adapter': {
      w = 32;
      h = 22;
      poly(
        [
          [4, 10],
          [16, 10],
          [28, ports.length === 2 ? 10 : 6],
        ],
        null,
      );
      if (ports.length > 2)
        poly(
          [
            [16, 10],
            [28, 14],
          ],
          null,
        );
      rect(3, 8, 3, 4, 'metal');
      rect(25, ports.length === 2 ? 8 : 4, 3, 4, 'metal');
      if (ports.length > 2) rect(25, 12, 3, 4, 'metal');
      positions.push({ ...ports[0], x: 4, y: 10 });
      ports.slice(1).forEach((p, i) =>
        positions.push({
          ...p,
          x: 28,
          y: ports.length === 2 ? 10 : 6 + i * 8,
        }),
      );
      break;
    }
    case 'stand': {
      w = 32;
      h = 42;
      line(16, 9, 16, 34);
      line(16, 9, 30, 2);
      line(16, 9, 1, 17);
      ellipse(27, 0, 5, 4, 'dark');
      for (const [x, y] of [
        [2, 40],
        [30, 40],
        [16, 27],
      ])
        line(16, 34, x, y);
      break;
    }
    case 'popfilter': {
      w = 24;
      h = 32;
      ellipse(2, 0, 20, 20, 'dark');
      grille(6, 3, 12, 13);
      poly(
        [
          [12, 20],
          [15, 26],
          [7, 31],
        ],
        null,
      );
      break;
    }
    case 'drums': {
      w = 48;
      h = 40;
      ellipse(14, 15, 20, 20, 'metal');
      ellipse(3, 10, 13, 13, 'white');
      ellipse(31, 10, 13, 13, 'white');
      ellipse(17, 2, 13, 13, 'white');
      for (const [x, y] of [
        [5, 3],
        [39, 3],
        [39, 30],
      ])
        ellipse(x - 4, y, 10, 3, 'gold');
      break;
    }
    case 'lectern': {
      w = 28;
      h = 34;
      poly(
        [
          [2, 0],
          [26, 0],
          [28, 10],
          [0, 10],
        ],
        'amber',
      );
      rect(6, 10, 16, 20, 'metal');
      rect(2, 30, 24, 3, 'dark');
      break;
    }
    case 'treatment': {
      w = 28;
      h = 36;
      rect(0, 0, w, h, 'dark');
      for (let x = 2; x < w - 2; x += 3)
        poly(
          [
            [x, 2],
            [x + 1, 4],
            [x, h - 2],
          ],
          null,
          2,
        );
      break;
    }
    default:
      throw new Error('Unknown audio artwork ' + device.kind);
  }
  // A socket face and its native active point always share exactly the same centre.
  for (const p of positions) {
    const { x, y, kind } = p;
    if (device.kind === 'patchbay') {
      ellipse(x - 0.8, y - 0.8, 1.6, 1.6, 'metal');
      ellipse(x - 0.4, y - 0.4, 0.8, 0.8, 'ink');
    } else if (
      [
        'usb-a',
        'ethernet',
        'ethercon',
        'usb-b',
        'usb-c',
        'hdmi',
        'optical',
        'iec',
        'terminal',
        'multicore',
      ].includes(kind)
    ) {
      rect(x - 1.8, y - 1.3, 3.6, 2.6, 'ink');
      rect(x - 1.2, y - 0.5, 2.4, 1, 'gold');
      if (kind === 'ethercon') {
        rect(x - 0.8, y + 1, 0.8, 0.7, 'ink');
      }
    } else if (kind === 'rf') {
      line(x, y + 1.6, x, y - 1.6);
      poly(
        [
          [x - 1.7, y - 1],
          [x - 2, y],
          [x - 1.7, y + 1],
        ],
        null,
        2,
      );
      poly(
        [
          [x + 1.7, y - 1],
          [x + 2, y],
          [x + 1.7, y + 1],
        ],
        null,
        2,
      );
      ellipse(x - 0.3, y - 0.3, 0.6, 0.6, 'green');
    } else {
      ellipse(x - 1.6, y - 1.6, 3.2, 3.2, 'metal');
      ellipse(x - 1.2, y - 1.2, 2.4, 2.4, 'ink');
      if (kind.startsWith('xlr') || kind === 'combo') {
        for (const [dx, dy] of [
          [-0.6, -0.4],
          [0.6, -0.4],
          [0, 0.6],
        ])
          ellipse(
            x + dx - 0.18,
            y + dy - 0.18,
            0.36,
            0.36,
            kind === 'xlr-m' ? 'gold' : 'metal',
          );
        if (kind === 'combo') ellipse(x - 0.4, y - 0.4, 0.8, 0.8, 'white');
      } else if (kind === 'din5') {
        for (let i = 0; i < 5; i++) {
          const a = Math.PI * (0.1 + i * 0.2);
          ellipse(
            x + Math.cos(a) * 0.8 - 0.15,
            y + Math.sin(a) * 0.8 - 0.15,
            0.3,
            0.3,
            'gold',
          );
        }
      } else if (kind === 'speakon') {
        rect(x - 0.3, y - 1, 0.6, 2, 'gold');
      } else
        ellipse(x - 0.45, y - 0.45, 0.9, 0.9, kind === 'rca' ? 'red' : 'gold');
    }
    const label =
      device.kind === 'patchbay'
        ? (p.label ?? p.name).replace(/^[AB]/, '')
        : p.label ?? p.name;
    if (label)
      text(
        x - textWidth(label) / 2 + 0.6,
        device.kind === 'connector' ? 2 : y - 2.2,
        label,
        1,
        [
          'connector',
          'adapter',
          'speaker',
          'microphone',
          'headphones',
          'guitar',
          'computer',
        ].includes(device.kind)
          ? 'ink'
          : 'white',
      );
    art.push(
      `<PIN pos="${x},${y}" which="0" elec="4" direction="0" part="0" number="${
        p.number
      }" show="0" length="0" number_pos="0" centre_name="0">${escapeXML(
        p.name,
      )}</PIN>`,
    );
  }
  text(0, h + 4, device.short, 2);
  return {
    device,
    width: Math.ceil(Math.max(w, textWidth(device.short, 8)) / 2) * 2,
    height: Math.ceil((h + 7) / 2) * 2,
    bodyWidth: w,
    bodyHeight: h,
    ports: positions,
    xml: c.xml(),
  };
}

export function audioArtwork(recipe) {
  const records = recipe.devices.map(audioSymbol);
  const provenance = {
    version: 1,
    id: recipe.id,
    name: recipe.name,
    artwork: recipe.artwork,
    scope: recipe.scope,
    reviewed: recipe.reviewed,
    references: recipe.references,
    sourceReview: recipe.sourceReview,
    entries: records.map((r) => ({
      ...r.device,
      width: r.width,
      height: r.height,
      bodyWidth: r.bodyWidth,
      bodyHeight: r.bodyHeight,
      ports: r.ports,
      xmlSha256: createHash('sha256').update(r.xml).digest('hex'),
    })),
  };
  const library = {
    name: recipe.name,
    names: records.map((r, i) => ({
      NameID: i + 1,
      SymbolID: i + 1,
      Type: 0,
      Name: r.device.name,
      Reference: 'A?',
      ppp: 1,
      ShowName: 1,
      ShowRef: 1,
      DefRotate: 0,
      Description: [r.device.name, r.device.notes, recipe.scope]
        .filter(Boolean)
        .join('. '),
      Attributes: [
        {
          AttName: 'Ports',
          AttValue: r.ports
            .map((p) => `${p.number}: ${p.name} | ${p.kind} | ${p.signal}`)
            .join('\n'),
          ShowAtt: 1,
        },
        {
          AttName: 'Source',
          AttValue: r.device.sources
            .map((id) => recipe.references.find((s) => s.id === id)?.url ?? id)
            .join('\n'),
          ShowAtt: 1,
        },
        { AttName: 'Artwork', AttValue: recipe.artwork, ShowAtt: 1 },
      ],
    })),
    symbols: records.map((r, i) => ({ SymbolId: i + 1, Data: r.xml })),
  };
  return { recipe, records, provenance, library };
}
