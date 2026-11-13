import { createHash } from 'node:crypto';
import { vectorCanvas, escapeXML, textWidth } from './layout-artwork.mjs';

// Native setup artwork: conductor terminals and complete cable/hose ports are
// deliberately distinguished in metadata. These are not simulation primitives.
export function testMeasurementSymbol(device) {
  const c = vectorCanvas(),
    { rect, ellipse, poly, line, text, art } = c;
  const ports = device.ports.map((p, i) => ({
    ...p,
    number: p.number ?? String(i + 1),
  }));
  const placed = [];
  let w = 40,
    h = 30;
  const at = (p, x, y) => placed.push({ ...p, x, y });
  const row = (ps, x, y, pitch = 6) =>
    ps.forEach((p, i) => at(p, x + i * pitch, y));
  const knob = (x, y, r = 2) => {
    ellipse(x - r, y - r, r * 2, r * 2, 'dark');
    line(x, y - r + 0.5, x, y, 2);
  };
  const housing = (width, height) => {
    w = width;
    h = height;
    rect(0, 0, w, h, 'metal');
    rect(1, 1, w - 2, h - 2, 'white', 2);
    rect(2, h - 1, 5, 2, 'dark');
    rect(w - 7, h - 1, 5, 2, 'dark');
  };
  const screen = (x, y, width, height, mode = 'numeric') => {
    rect(x, y, width, height, 'dark');
    if (['scope', 'wave', 'spectrum', 'vna'].includes(mode)) {
      for (let xx = x + 4; xx < x + width; xx += 4)
        line(xx, y + 1, xx, y + height - 1, 2);
      for (let yy = y + 4; yy < y + height; yy += 4)
        line(x + 1, yy, x + width - 1, yy, 2);
      const pts = [];
      for (let i = 0; i <= 50; i++) {
        const v =
          mode === 'spectrum'
            ? Math.exp(-Math.pow((i - 24) / 3, 2)) * 0.35 +
              Math.sin(i * 3) * 0.05
            : mode === 'vna'
            ? Math.sin(i * 0.1) * 0.3
            : Math.sin(i * 0.32) * 0.3;
        pts.push([
          x + 1 + (i * (width - 2)) / 50,
          y + height * 0.5 - v * height,
        ]);
      }
      poly(pts, null, 3);
    } else {
      text(
        x + 2,
        y + height * 0.45,
        mode === 'frequency' ? '1.000 MHz' : '0.000',
        2,
        'green',
      );
      if (height >= 10) text(x + 2, y + height * 0.8, 'V / A / R', 1, 'white');
    }
  };
  const benchPorts = (y = 30, columns = 10) => {
    for (let i = 0; i < ports.length; i += columns)
      row(ports.slice(i, i + columns), 4, y + Math.floor(i / columns) * 8, 6);
  };
  const coil = (x, y) => {
    rect(x, y, 6, 9, 'amber');
    for (let yy = y + 1; yy < y + 8; yy += 1) line(x, yy, x + 6, yy, 2);
  };
  const heat = (x, y, width = 15) =>
    poly(
      [
        [x, y],
        [x + 3, y - 2],
        [x + 6, y],
        [x + 9, y - 2],
        [x + 12, y],
        [x + width, y - 2],
      ],
      null,
      3,
    );
  switch (device.kind) {
    case 'scope': {
      housing(64, 40);
      screen(3, 3, 36, 21, 'scope');
      for (let x = 44; x < 60; x += 6)
        for (let y = 7; y < 21; y += 6) knob(x, y, 1.4);
      benchPorts(32);
      break;
    }
    case 'supply':
    case 'load':
    case 'meter':
    case 'generator':
    case 'analyzer': {
      const rows = Math.ceil(ports.length / 10);
      housing(ports.length > 8 ? 64 : 56, 32 + (rows - 1) * 8);
      screen(
        3,
        3,
        w - 24,
        15,
        device.kind === 'generator'
          ? device.display === 'rf'
            ? 'frequency'
            : 'wave'
          : device.kind === 'analyzer'
          ? device.display
          : device.display ?? 'numeric',
      );
      knob(w - 9, 9, 3);
      for (let i = 0; i < 4; i++) rect(w - 20 + i * 4, 16, 2.5, 2, 'metal');
      if (device.kind === 'load')
        for (let x = 3; x < 25; x += 2) line(x, 20, x + 1, 23, 2);
      benchPorts(28);
      break;
    }
    case 'variac': {
      housing(36, 40);
      ellipse(4, 3, 28, 24, 'dark');
      ellipse(8, 7, 20, 16, 'metal');
      knob(18, 15, 4);
      for (let i = 0; i < 10; i++) {
        const a = Math.PI * (0.15 + i * 0.08);
        line(
          18 + Math.cos(a) * 11,
          15 + Math.sin(a) * 10,
          18 + Math.cos(a) * 12,
          15 + Math.sin(a) * 11,
        );
      }
      benchPorts(34);
      break;
    }
    case 'handheld': {
      w = 26;
      h = device.clamp ? 52 : 40;
      if (device.clamp) {
        ellipse(3, 0, 20, 22, 'amber');
        ellipse(7, 4, 12, 14, 'white');
        rect(3, 14, 20, 36, 'amber');
      } else rect(2, 0, 22, 38, 'amber');
      const offset = device.clamp ? 16 : 0;
      rect(4, offset + 2, 18, 10, 'white');
      screen(5, offset + 3, 16, 8, 'numeric');
      knob(13, offset + 21, 6);
      for (let i = 0; i < 4; i++)
        line(6 + i * 4, offset + 29, 7 + i * 4, offset + 29);
      row(ports, ports.length === 1 ? 12 : 4, h - 4, 6);
      break;
    }
    case 'daq':
    case 'logger': {
      const columns = 8,
        rows = Math.ceil(ports.length / columns);
      housing(48, 16 + rows * 8);
      if (device.kind === 'logger') screen(5, 3, 24, 9, 'numeric');
      else {
        rect(5, 3, 22, 6, 'blue');
        text(6, 7, 'USB / DATA', 1, 'white');
      }
      for (let i = 0; i < 3; i++) ellipse(34 + i * 3, 5, 1, 1, 'green');
      for (let i = 0; i < ports.length; i += columns)
        row(
          ports.slice(i, i + columns),
          4,
          18 + Math.floor(i / columns) * 8,
          6,
        );
      break;
    }
    case 'decade': {
      housing(48, 30);
      for (let i = 0; i < 5; i++) {
        knob(6 + i * 9, 10, 3);
        text(4 + i * 9, 17, '0', 1);
      }
      row(ports, 10, 26, 10);
      break;
    }
    case 'probe': {
      w = 36;
      h = 34;
      if (device.shape === 'current') {
        ellipse(0, 1, 18, 18, 'dark');
        ellipse(4, 4, 10, 11, 'white');
        rect(3, 15, 12, 12, 'blue');
        poly(
          [
            [9, 27],
            [9, 30],
            [30, 30],
          ],
          null,
        );
        row(ports, 24, 30, 8);
      } else if (device.shape === 'differential') {
        rect(10, 7, 20, 15, 'blue');
        rect(13, 10, 10, 5, 'white');
        text(14, 13, 'DIFF', 1);
        at(ports[0], 4, 4);
        at(ports[1], 12, 4);
        at(ports[2], 24, 28);
        at(ports[3], 32, 28);
        for (const x of [4, 12])
          poly(
            [
              [x, 4],
              [x, 8],
              [14, 12],
            ],
            null,
          );
        line(24, 22, 24, 28);
        line(28, 22, 32, 28);
      } else if (device.shape === 'scope') {
        rect(6, 4, 4, 16, 'blue');
        poly(
          [
            [7, 4],
            [8, 0],
            [9, 4],
          ],
          'metal',
        );
        line(8, 20, 8, 28);
        line(8, 28, 30, 28);
        at(ports[0], 8, 2);
        at(ports[1], 20, 14);
        at(ports[2], 30, 28);
        poly(
          [
            [10, 10],
            [16, 10],
            [20, 14],
          ],
          null,
        );
      } else if (device.shape === 'pressure') {
        rect(8, 7, 16, 16, 'metal');
        poly(
          [
            [8, 7],
            [12, 3],
            [20, 3],
            [24, 7],
          ],
          'metal',
        );
        rect(12, 23, 8, 7, 'metal');
        at(ports[0], 16, 30);
        at(ports[1], 10, 4);
        at(ports[2], 22, 4);
      } else {
        const bead = device.shape === 'bead',
          surface = device.shape === 'surface',
          ph = device.shape === 'ph';
        if (bead) {
          ellipse(6, 20, 5, 5, 'amber');
          poly(
            [
              [8, 20],
              [8, 4],
              [22, 4],
              [28, 8],
            ],
            null,
          );
        } else {
          rect(6, 8, 4, 20, ph ? 'white' : 'metal');
          rect(4, 2, 8, 10, 'dark');
          if (ph) ellipse(6, 25, 4, 5, 'blue');
          if (surface) rect(2, 25, 12, 3, 'metal');
        }
        if (ports.every((p) => p.kind === 'lead')) {
          row(ports, 16, 4, 6);
          for (const [i, p] of placed.entries())
            poly(
              [
                [8 + i * 0.5, 8],
                [12 + i, 6],
                [p.x, 4],
              ],
              null,
            );
          w = Math.max(36, 16 + (ports.length - 1) * 6 + 4);
        } else {
          poly(
            [
              [8, 4],
              [20, 4],
              [28, 12],
            ],
            null,
          );
          row(ports, 28, 12);
        }
      }
      break;
    }
    case 'loadcell': {
      w = 40;
      h = 24;
      rect(0, 5, 38, 13, 'metal');
      ellipse(3, 8, 6, 6, 'white');
      ellipse(29, 8, 6, 6, 'white');
      rect(14, 4, 10, 15, 'dark');
      row(ports, 10, 22, 6);
      for (const p of placed)
        poly(
          [
            [19, 17],
            [19, 20],
            [p.x, 22],
          ],
          null,
        );
      break;
    }
    case 'hotplate': {
      housing(38, 34);
      ellipse(3, 0, 30, 19, 'metal');
      ellipse(6, 2, 24, 14, 'white');
      if (device.stir) {
        ellipse(10, 5, 15, 8, null, 2);
        rect(14, 8, 8, 2, 'blue');
      }
      heat(9, 15, 14);
      screen(4, 22, 12, 6);
      knob(24, 25, 2);
      row(ports, 8, 32, 22);
      break;
    }
    case 'heater': {
      w = 36;
      h = 28;
      if (device.shape === 'cartridge') {
        rect(2, 8, 23, 8, 'metal');
        ellipse(0, 8, 4, 8, 'metal');
      } else if (device.shape === 'mat') {
        rect(1, 3, 24, 19, 'red');
        for (let y = 6; y < 20; y += 4) heat(3, y, 18);
      } else if (device.shape === 'band') {
        ellipse(1, 1, 24, 22, 'metal');
        ellipse(5, 3, 16, 16, 'white');
        rect(20, 8, 7, 9, 'dark');
      } else if (device.shape === 'immersion') {
        poly(
          [
            [6, 2],
            [6, 20],
            [12, 24],
            [18, 20],
            [18, 2],
          ],
          null,
          2,
        );
        rect(4, 0, 16, 5, 'dark');
      } else {
        rect(2, 2, 22, 22, 'white');
        rect(3, 3, 20, 2, 'blue');
        rect(3, 21, 20, 2, 'red');
        heat(5, 13, 15);
      }
      row(ports, 28, 10, 6);
      for (const [i, p] of placed.entries())
        poly(
          [
            [20, 10 + i * 4],
            [24, 10 + i * 4],
            [p.x, p.y],
          ],
          null,
        );
      w = 40;
      break;
    }
    case 'thermal': {
      housing(device.shape === 'chiller' ? 44 : 40, 42);
      if (device.shape === 'bath') {
        rect(3, 2, 34, 20, 'metal');
        rect(6, 5, 28, 12, 'blue');
        for (let x = 8; x < 32; x += 5) ellipse(x, 7, 3, 6, 'white');
        screen(4, 24, 16, 6);
      } else if (device.shape === 'drywell') {
        rect(2, 1, 36, 18, 'metal');
        for (const x of [8, 16, 24, 32]) ellipse(x - 2, 6, 4, 6, 'dark');
        screen(4, 23, 20, 8);
      } else if (device.shape === 'oven') {
        rect(3, 3, 34, 27, 'metal');
        rect(6, 6, 25, 20, 'dark');
        rect(11, 10, 15, 12, 'white');
        rect(32, 11, 2, 10, 'dark');
      } else {
        screen(4, 3, 23, 9);
        for (let y = 16; y < 30; y += 3) line(4, y, 28, y, 2);
        knob(35, 8, 2);
      }
      row(ports, 4, 38, 8);
      break;
    }
    case 'relay': {
      const shape = device.shape;
      housing(shape === 'din' ? 20 : 34, shape === 'din' ? 42 : 34);
      if (shape === 'ssr') {
        for (let x = 2; x < 32; x += 3) line(x, 2, x, 32, 2);
        rect(5, 2, 24, 29, 'metal');
        rect(9, 11, 16, 12, 'white');
        text(11, 17, 'SSR', 2);
        at(ports[0], 10, 6);
        at(ports[1], 24, 6);
        at(ports[2], 10, 28);
        at(ports[3], 24, 28);
      } else if (shape === 'contactor') {
        rect(3, 11, 28, 13, 'dark');
        rect(12, 14, 10, 7, 'amber');
        row(ports.slice(0, 3), 6, 6, 10);
        row(ports.slice(3, 6), 6, 30, 10);
        row(ports.slice(6), 6, 20, 22);
      } else if (shape === 'din') {
        rect(4, 8, 12, 23, 'blue');
        coil(7, 15);
        at(ports[0], 6, 6);
        at(ports[1], 14, 6);
        row(ports.slice(2), 4, 38, 6);
        ellipse(8, 27, 3, 3, 'green');
      } else {
        rect(3, 9, 28, 16, 'blue');
        coil(7, 12);
        poly(
          [
            [18, 21],
            [22, 13],
            [26, 13],
          ],
          null,
        );
        row(ports.slice(0, 2), 8, 6, 16);
        row(ports.slice(2, 5), 6, 30, 8);
        row(ports.slice(5), 6, 20, 8);
      }
      break;
    }
    case 'relayboard': {
      housing(58, 38);
      rect(1, 1, 56, 36, 'green');
      for (let i = 0; i < 4; i++) {
        rect(4 + i * 13, 11, 11, 13, 'blue');
        text(7 + i * 13, 18, String(i + 1), 2, 'white');
      }
      row(ports.slice(0, 6), 4, 6, 8);
      for (let i = 0; i < 4; i++)
        row(ports.slice(6 + i * 3, 9 + i * 3), 4 + i * 14, 32, 4);
      break;
    }
    case 'controller': {
      housing(38, 34);
      rect(3, 3, 32, 18, 'dark');
      text(6, 10, '100.0', 2, 'red');
      text(6, 16, '100.0', 2, 'green');
      for (let x = 6; x < 32; x += 6) rect(x, 23, 3, 2, 'metal');
      row(ports.slice(0, 5), 4, 30, 6);
      row(ports.slice(5), 4, 40, 8);
      rect(0, 36, 38, 8, 'metal');
      h = 44; // Rear terminal bank shown below panel.
      break;
    }
    case 'switch': {
      housing(32, 30);
      if (device.shape === 'estop') {
        ellipse(6, 2, 20, 20, 'amber');
        ellipse(9, 3, 14, 14, 'red');
        rect(9, 17, 14, 5, 'dark');
      } else {
        knob(12, 12, 8);
        poly(
          [
            [20, 12],
            [26, 12],
            [26, 6],
            [32, 6],
          ],
          null,
        );
        ellipse(28, 3, 4, 6, 'metal');
      }
      row(ports, 4, 26, 8);
      break;
    }
    case 'actuator': {
      w = 34;
      h = 34;
      if (device.shape === 'fan') {
        rect(2, 2, 26, 26, 'dark');
        ellipse(4, 4, 22, 22, 'metal');
        ellipse(12, 12, 6, 6, 'dark');
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2,
            x = 15 + Math.cos(a) * 7,
            y = 15 + Math.sin(a) * 7;
          ellipse(x - 4, y - 2, 8, 4, 'dark');
        }
        row(ports, 10, 32, 8);
        for (const p of placed) line(26, 25, p.x, 32);
      } else {
        rect(8, 13, 20, 10, 'metal');
        rect(10, 1, 16, 12, 'dark');
        coil(15, 3);
        at(ports[0], 12, 2);
        at(ports[1], 24, 2);
        at(ports[2], 6, 18);
        at(ports[3], 30, 18);
        line(6, 18, 30, 18);
      }
      break;
    }
    case 'apparatus': {
      housing(40, 36);
      if (device.shape === 'peristaltic') {
        ellipse(3, 3, 25, 22, 'white');
        ellipse(8, 7, 14, 14, 'metal');
        for (const [x, y] of [
          [13, 7],
          [8, 16],
          [20, 16],
        ])
          ellipse(x, y, 4, 4, 'dark');
        poly(
          [
            [4, 24],
            [4, 6],
            [26, 6],
            [26, 24],
          ],
          null,
          3,
        );
        knob(33, 12, 3);
      } else if (device.shape === 'vacuum') {
        rect(3, 8, 24, 19, 'dark');
        for (let x = 5; x < 25; x += 3) line(x, 10, x, 25, 2);
        rect(9, 1, 16, 8, 'metal');
        poly(
          [
            [10, 1],
            [10, -1],
            [24, -1],
            [24, 1],
          ],
          null,
        );
        knob(32, 16, 3);
      } else if (device.shape === 'balance') {
        ellipse(6, 3, 28, 16, 'metal');
        ellipse(9, 5, 22, 12, 'white');
        screen(5, 24, 22, 7);
        rect(31, 25, 4, 3, 'blue');
      } else if (device.shape === 'microscope') {
        rect(3, 28, 30, 4, 'dark');
        poly(
          [
            [7, 27],
            [7, 7],
            [15, 2],
            [23, 7],
            [16, 15],
            [16, 25],
          ],
          'metal',
        );
        rect(18, 1, 7, 6, 'dark');
        rect(15, 20, 18, 2, 'dark');
        ellipse(8, 13, 7, 7, 'dark');
      } else {
        screen(3, 3, 18, 12);
        knob(31, 10, 4);
        poly(
          [
            [8, 18],
            [8, 22],
            [25, 22],
            [32, 27],
          ],
          null,
        );
        rect(24, 21, 9, 3, 'dark');
        line(33, 22, 37, 26);
      }
      row(ports, 4, 34, 12);
      break;
    }
    case 'computer': {
      w = 44;
      h = 34;
      rect(2, 0, 40, 23, 'dark');
      rect(4, 2, 36, 18, 'blue');
      poly(
        [
          [2, 23],
          [42, 23],
          [44, 30],
          [0, 30],
        ],
        'metal',
      );
      for (let y = 25; y < 29; y += 1) line(4, y, 40, y);
      row(ports, 4, 34, 10);
      break;
    }
    case 'glassware': {
      w = 28;
      h = 34;
      if (device.shape === 'flask')
        poly(
          [
            [10, 0],
            [18, 0],
            [18, 12],
            [27, 30],
            [25, 33],
            [3, 33],
            [1, 30],
            [10, 12],
            [10, 0],
          ],
          'white',
        );
      else
        poly(
          [
            [3, 1],
            [24, 1],
            [22, 5],
            [22, 31],
            [4, 31],
            [4, 1],
          ],
          'white',
        );
      if (device.shape === 'flask')
        poly(
          [
            [6, 23],
            [22, 23],
            [25, 30],
            [23, 31],
            [5, 31],
            [3, 30],
          ],
          'blue',
        );
      else rect(5, 17, 16, 13, 'blue');
      for (let y = 8; y < 30; y += 5) line(5, y, 9, y, 2);
      break;
    }
    case 'stand': {
      w = 32;
      h = 40;
      rect(2, 36, 27, 3, 'metal');
      rect(6, 0, 1, 36, 'dark');
      line(7, 10, 27, 10);
      ellipse(23, 7, 7, 7, null);
      knob(9, 10, 1.4);
      break;
    }
    case 'terminalblock': {
      housing(40, 18);
      rect(1, 1, 38, 16, 'green');
      row(ports.slice(0, 8), 6, 4, 4);
      row(ports.slice(8), 6, 14, 4);
      break;
    }
    case 'connector': {
      w = 30;
      h = 24;
      if (device.shape === 'tee') {
        poly(
          [
            [4, 12],
            [26, 12],
          ],
          null,
        );
        line(14, 4, 14, 12);
        at(ports[0], 4, 12);
        at(ports[1], 26, 12);
        at(ports[2], 14, 4);
      } else if (device.shape === 'terminator') {
        rect(3, 7, 17, 10, 'metal');
        for (let x = 6; x < 17; x += 3) line(x, 8, x, 16, 2);
        at(ports[0], 22, 12);
      } else {
        rect(5, 5, 20, 15, 'metal');
        at(ports[0], 4, 12);
        at(ports[1], 26, 8);
        at(ports[2], 26, 18);
      }
      break;
    }
    default:
      throw new Error('Unknown laboratory artwork ' + device.kind);
  }
  for (const p of placed) {
    const { x, y, kind } = p;
    if (kind === 'terminal') {
      rect(x - 1.6, y - 1.6, 3.2, 3.2, 'green');
      ellipse(x - 0.8, y - 0.8, 1.6, 1.6, 'metal');
      line(x - 0.5, y + 0.5, x + 0.5, y - 0.5);
    } else if (
      ['usb', 'ethernet', 'serial', 'iec', 'pod', 'tc'].includes(kind)
    ) {
      rect(x - 2, y - 1.3, 4, 2.6, kind === 'tc' ? 'amber' : 'dark');
      if (kind === 'tc') {
        rect(x - 1.2, y - 0.6, 0.6, 1.2, 'ink');
        rect(x + 0.5, y - 0.8, 0.6, 1.6, 'ink');
      } else rect(x - 1.2, y - 0.4, 2.4, 0.8, 'gold');
    } else {
      const radius = ['tip', 'clip', 'lead'].includes(kind)
        ? 1
        : kind === 'hose'
        ? 2
        : 1.6;
      const colour =
        p.signal === 'earth'
          ? 'green'
          : p.name.includes('+') || p.name === 'INPUT HI'
          ? 'red'
          : p.name.includes('SENSE')
          ? 'amber'
          : 'metal';
      ellipse(
        x - radius,
        y - radius,
        radius * 2,
        radius * 2,
        kind === 'post' ? colour : 'metal',
      );
      ellipse(
        x - radius * 0.55,
        y - radius * 0.55,
        radius * 1.1,
        radius * 1.1,
        kind === 'hose' ? 'blue' : 'dark',
      );
      if (['bnc', 'coax'].includes(kind)) {
        rect(x - 2, y - 0.3, 0.7, 0.6, 'metal');
        rect(x + 1.3, y - 0.3, 0.7, 0.6, 'metal');
        ellipse(x - 0.22, y - 0.22, 0.44, 0.44, 'gold');
      }
    }
    const tw = textWidth(p.label);
    rect(x - tw / 2, y - 4.3, tw, 2.1, 'white', 2);
    // Avoid Markdown list syntax while retaining polarity in the native and
    // service renderers (the latter renders NOTE_TEXT as plain text).
    const displayLabel =
      p.label === '+' ? '＋' : p.label === '-' ? '−' : p.label;
    text(x - tw / 2 + 0.6, y - 2.4, displayLabel);
    art.push(
      `<PIN pos="${x},${y}" which="0" elec="4" direction="0" part="0" number="${escapeXML(
        p.number,
      )}" show="0" length="0" number_pos="0" centre_name="0">${escapeXML(
        p.name,
      )}</PIN>`,
    );
  }
  text(0, h + 5, device.short, 2);
  const width = Math.ceil(Math.max(w, textWidth(device.short, 8)) / 2) * 2;
  const height = Math.ceil((h + 8) / 2) * 2;
  // A transparent native rectangle defines the full placement/preview envelope,
  // including captions. Without it, narrow probes can crop their own captions.
  c.resources.splice(
    c.resources.findIndex((r) => r.startsWith('<FILL')),
    0,
    '<STYLE id="4"><STYLE>5</STYLE><COLOR>000000</COLOR><THICKNESS>1</THICKNESS></STYLE>',
  );
  rect(0, -4, width, height + 4, null, 4);
  return {
    device,
    width,
    height,
    bodyWidth: w,
    bodyHeight: h,
    ports: placed,
    xml: c.xml(),
  };
}

export function testMeasurementArtwork(recipe) {
  const records = recipe.devices.map(testMeasurementSymbol);
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
      Reference: 'T?',
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
            .map(
              (p) =>
                `${p.number}: ${p.name} | ${p.kind} | ${p.unit} | ${p.signal}`,
            )
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
