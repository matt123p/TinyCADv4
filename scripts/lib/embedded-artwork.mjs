import { createHash } from 'node:crypto';
import { compactEmbedded } from './compact-embedded-artwork.mjs';
import { drawEmbeddedDisplay } from './embedded-display-artwork.mjs';

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[
        c
      ]),
  );
const bgr = (rgb) => rgb.slice(4, 6) + rgb.slice(2, 4) + rgb.slice(0, 2);
const palette = {
  ink: '23343e',
  pcb: '176e65',
  blue: '185a85',
  black: '303b44',
  metal: 'cbd5da',
  white: 'f4f8f6',
  gold: 'd9b75c',
  red: 'edaa91',
  signal: '92d9c0',
  cream: 'e7f1e9',
  accent: 'd29439',
};
const colours = Object.keys(palette);
const fill = (name) => (name ? colours.indexOf(name) + 1 : 0);
const resources = () => [
  ...[6, 8, 10].map(
    (size, i) =>
      `<FONT id="${i + 1}"><HEIGHT>${size}</HEIGHT><WIDTH>0</WIDTH><WEIGHT>${
        i === 2 ? 700 : 400
      }</WEIGHT><ITALIC>0</ITALIC><UNDERLINE>0</UNDERLINE><STRIKEOUT>0</STRIKEOUT><CHARSET>0</CHARSET><FACENAME>Arial</FACENAME></FONT>`,
  ),
  ...['ink', 'white', 'gold', 'accent'].map(
    (c, i) =>
      `<STYLE id="${i + 1}"><STYLE>0</STYLE><COLOR>${bgr(
        palette[c],
      )}</COLOR><THICKNESS>${i === 3 ? 2 : 1}</THICKNESS></STYLE>`,
  ),
  ...colours.map(
    (c) =>
      `<FILL id="${fill(c)}"><INDEX>0</INDEX><COLOR>${bgr(
        palette[c],
      )}</COLOR></FILL>`,
  ),
];

// Original artwork. The recipe contains independently reviewed terminal facts;
// no manufacturer paths, traces, logos, photographs or silkscreen are imported.
export function embeddedSymbol(device) {
  const art = [],
    { width: w, height: h } = device;
  const rect = (x, y, width, height, c = 'metal', s = 1) =>
    art.push(
      `<RECTANGLE a="${x},${y}" b="${x + width},${
        y + height
      }" style="${s}" fill="${fill(c)}"/>`,
    );
  const ellipse = (x, y, width, height, c = 'white', s = 1) =>
    art.push(
      `<ELLIPSE a="${x},${y}" b="${x + width},${
        y + height
      }" style="${s}" fill="${fill(c)}"/>`,
    );
  const poly = (points, c = null, s = 1) =>
    art.push(
      `<POLYGON pos="0,0" style="${s}" fill="${fill(c)}">${points
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
  const text = (x, y, value, font = 1, c = 'white') => {
    const size = [6, 8, 10][font - 1],
      width = (String(value).length * size * (font === 3 ? 1.5 : 1.3) + 6) / 5;
    art.push(
      `<NOTE_TEXT a="${x - 0.6},${y - (size + 3) / 5}" b="${x - 0.6 + width},${
        y - (size + 3) / 5 + (size * 1.4 + 6) / 5
      }" direction="3" font="${font}" color="${bgr(
        palette[c],
      )}" style="1" fill="0" border_style="2">${escape(value)}</NOTE_TEXT>`,
    );
  };
  const vertical = (x, y, value, c = 'white', height = 27) =>
    art.push(
      `<NOTE_TEXT a="${x - 1.8},${y}" b="${x + 1.8},${
        y + height
      }" direction="0" font="2" color="${bgr(
        palette[c],
      )}" style="1" fill="0" border_style="2">${escape(value)}</NOTE_TEXT>`,
    );
  const hole = (x, y) => {
    ellipse(x - 2.3, y - 2.3, 4.6, 4.6, 'gold');
    ellipse(x - 1.5, y - 1.5, 3, 3, 'white');
  };
  const chip = (x, y, cw, ch, label) => {
    rect(x, y, cw, ch, 'black');
    for (let i = 2; i < ch; i += 3) {
      rect(x - 1, y + i, 1, 1.2, 'metal');
      rect(x + cw, y + i, 1, 1.2, 'metal');
    }
    if (label) text(x + 2, y + ch / 2, label, 1);
  };
  const usb = (x, y, uw = 16, uh = 12, label = 'USB') => {
    rect(x, y, uw, uh, 'metal');
    rect(x + 2, y, uw - 4, 2, 'black');
    text(x + 2, y + uh - 2, label, 1, 'ink');
  };
  const passive = (x, y) => {
    rect(x, y, 4, 2, 'metal');
    rect(x + 1, y, 2, 2, 'cream');
  };
  const button = (x, y) => {
    rect(x - 3, y - 3, 6, 6, 'metal');
    ellipse(x - 1.8, y - 1.8, 3.6, 3.6, 'black');
  };
  function antenna(x, y, aw = 26) {
    rect(x, y, aw, 13, 'cream');
    poly(
      [
        [x + 3, y + 10],
        [x + 3, y + 3],
        [x + 8, y + 3],
        [x + 8, y + 9],
        [x + 13, y + 9],
        [x + 13, y + 3],
        [x + 18, y + 3],
        [x + 18, y + 9],
        [x + aw - 3, y + 9],
      ],
      null,
      3,
    );
  }
  function icon(kind, x, y) {
    // All pictograms are drawn here from simple native vector primitives.
    ellipse(x - 13, y - 13, 26, 26, 'cream');
    if (['climate', 'temperature'].includes(kind)) {
      rect(x - 7, y - 8, 4, 13, 'white');
      ellipse(x - 8, y + 2, 6, 6, 'red');
      line(x - 5, y - 5, x - 5, y + 5, 4);
      if (kind === 'climate') {
        poly(
          [
            [x + 5, y - 8],
            [x + 1, y - 1],
            [x + 1, y + 4],
            [x + 4, y + 7],
            [x + 8, y + 5],
            [x + 9, y + 1],
            [x + 5, y - 8],
          ],
          'blue',
        );
      } else {
        for (let i = 0; i < 3; i++)
          line(x + 1, y - 6 + i * 4, x + 6, y - 6 + i * 4, 4);
      }
    } else if (kind === 'light') {
      ellipse(x - 5, y - 5, 10, 10, 'gold');
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        line(
          x + Math.cos(a) * 7,
          y + Math.sin(a) * 7,
          x + Math.cos(a) * 10,
          y + Math.sin(a) * 10,
          4,
        );
      }
    } else if (kind === 'pressure') {
      ellipse(x - 9, y - 9, 18, 18, 'white');
      line(x, y, x + 6, y - 5, 4);
      ellipse(x - 1, y - 1, 2, 2, 'accent');
      for (const a of [
        Math.PI,
        Math.PI * 1.25,
        Math.PI * 1.5,
        Math.PI * 1.75,
        Math.PI * 2,
      ])
        line(
          x + Math.cos(a) * 6,
          y + Math.sin(a) * 6,
          x + Math.cos(a) * 8,
          y + Math.sin(a) * 8,
          4,
        );
    } else if (kind === 'touch') {
      ellipse(x - 8, y - 9, 16, 16, null, 4);
      rect(x - 2, y - 6, 4, 14, 'red');
      poly(
        [
          [x - 2, y + 3],
          [x - 7, y],
          [x - 9, y + 3],
          [x - 3, y + 10],
          [x + 6, y + 10],
          [x + 9, y + 1],
          [x + 2, y - 1],
        ],
        'red',
      );
    } else if (['buzzer', 'sound'].includes(kind)) {
      if (kind === 'buzzer')
        poly(
          [
            [x - 10, y - 3],
            [x - 6, y - 3],
            [x - 1, y - 8],
            [x - 1, y + 8],
            [x - 6, y + 3],
            [x - 10, y + 3],
            [x - 10, y - 3],
          ],
          'accent',
        );
      else {
        rect(x - 7, y - 8, 6, 12, 'metal');
        ellipse(x - 7, y - 10, 6, 6, 'metal');
        poly(
          [
            [x - 10, y],
            [x - 10, y + 6],
            [x - 4, y + 9],
            [x + 2, y + 6],
            [x + 2, y],
          ],
          null,
          4,
        );
        line(x - 4, y + 9, x - 4, y + 11, 4);
      }
      poly(
        [
          [x + 3, y - 6],
          [x + 7, y - 3],
          [x + 7, y + 3],
          [x + 3, y + 6],
        ],
        null,
        4,
      );
      poly(
        [
          [x + 7, y - 9],
          [x + 11, y - 4],
          [x + 11, y + 4],
          [x + 7, y + 9],
        ],
        null,
        4,
      );
    } else if (kind === 'pir') {
      ellipse(x - 3, y - 10, 6, 6, 'accent');
      line(x, y - 3, x, y + 4, 4);
      line(x - 7, y, x + 7, y - 2, 4);
      line(x, y + 4, x - 6, y + 10, 4);
      line(x, y + 4, x + 6, y + 10, 4);
      poly(
        [
          [x + 7, y - 10],
          [x + 11, y - 6],
          [x + 11, y - 2],
        ],
        null,
        4,
      );
    } else if (kind === 'distance') {
      line(x - 10, y + 8, x + 10, y + 8, 4);
      line(x - 10, y - 8, x - 10, y + 10, 4);
      line(x + 10, y - 8, x + 10, y + 10, 4);
      poly(
        [
          [x - 6, y + 4],
          [x - 10, y + 8],
          [x - 6, y + 11],
        ],
        null,
        4,
      );
      poly(
        [
          [x + 6, y + 4],
          [x + 10, y + 8],
          [x + 6, y + 11],
        ],
        null,
        4,
      );
      text(x - 6, y - 1, 'ToF', 2, 'ink');
    } else if (kind === 'motion') {
      line(x, y + 9, x, y - 10, 4);
      line(x, y + 9, x + 10, y + 2, 4);
      line(x, y + 9, x - 10, y + 2, 4);
      text(x + 2, y - 4, 'Z', 1, 'ink');
      text(x + 6, y + 6, 'X', 1, 'ink');
      text(x - 11, y - 1, 'Y', 1, 'ink');
    } else if (kind === 'soil') {
      line(x, y + 10, x, y - 4, 4);
      ellipse(x - 9, y - 7, 9, 5, 'signal');
      ellipse(x, y - 10, 9, 5, 'signal');
      line(x - 10, y + 10, x + 10, y + 10, 4);
    } else if (kind === 'water') {
      poly(
        [
          [x, y - 11],
          [x - 7, y],
          [x - 7, y + 6],
          [x - 3, y + 10],
          [x + 4, y + 10],
          [x + 8, y + 5],
          [x + 7, y],
          [x, y - 11],
        ],
        'blue',
      );
      line(x - 4, y + 4, x + 4, y + 4, 2);
    } else if (kind === 'door') {
      rect(x - 9, y - 10, 13, 21, 'accent');
      rect(x + 6, y - 7, 4, 14, 'signal');
      ellipse(x, y, 2, 2, 'white');
      line(x - 5, y - 5, x - 5, y + 6, 2);
    } else if (kind === 'button') {
      ellipse(x - 10, y - 10, 20, 20, 'metal');
      ellipse(x - 7, y - 7, 14, 14, 'red');
    } else if (kind === 'air') {
      text(x - 10, y + 2, 'CO2', 3, 'ink');
      for (const [dx, dy] of [
        [-7, -7],
        [4, -8],
        [8, 7],
      ])
        ellipse(x + dx, y + dy, 3, 3, 'signal');
    } else if (kind === 'relay') {
      ellipse(x - 9, y - 2, 3, 3, 'accent');
      ellipse(x + 6, y - 7, 3, 3, 'accent');
      ellipse(x + 6, y + 5, 3, 3, 'accent');
      line(x - 6, y, x + 5, y - 5, 4);
    }
  }

  if (device.kind === 'display') {
    drawEmbeddedDisplay(device, {
      rect,
      ellipse,
      line,
      text,
      chip,
      hole,
      icon,
    });
  } else if (device.id === 'adafruit-soil') {
    poly(
      [
        [0, 0],
        [w - 26, 0],
        [w, h / 2],
        [w - 26, h],
        [0, h],
        [0, 0],
      ],
      'pcb',
    );
    text(40, 12, 'STEMMA SOIL', 3);
    text(40, 20, 'I2C / capacitive', 1);
    icon('soil', 78, 42);
    for (let i = 0; i < 5; i++) {
      line(120 + i * 6, 12, 120 + i * 6, h - 12, 3);
      line(158 + i * 6, 12, 158 + i * 6, h - 12, 3);
    }
    line(110, 2, 110, h - 2, 2);
  } else if (device.id === 'gravity-soil') {
    poly(
      [
        [0, 0],
        [w, 0],
        [w, h - 22],
        [w / 2, h],
        [0, h - 22],
        [0, 0],
      ],
      'black',
    );
    text(8, 42, 'SOIL', 3);
    text(8, 49, 'ANALOG', 1);
    icon('soil', w / 2, 68);
    for (let i = 0; i < 5; i++) line(9 + i * 8, 100, 9 + i * 8, h - 28, 3);
    line(2, 90, w - 2, 90, 2);
  } else {
    rect(
      0,
      0,
      w,
      h,
      ['uno', 'nano', 'mega', 'd1mini'].includes(device.kind) ? 'blue' : 'pcb',
    );
    rect(1.5, 1.5, w - 3, h - 3, null, 2);
    const holes =
      device.kind === 'pi'
        ? [
            [8, 12],
            [w - 18, 12],
            [8, h - 12],
            [w - 18, h - 12],
          ]
        : [
            [7, 7],
            [w - 7, 7],
            [7, h - 7],
            [w - 7, h - 7],
          ];
    if (device.kind !== 'ultrasonic')
      (device.mountingHoles === 'top-pair' ? holes.slice(0, 2) : holes).forEach(
        ([x, y]) => hole(x, y),
      );
    if (['esp32', 'esp32s3', 'esp8266', 'd1mini'].includes(device.kind)) {
      antenna(w / 2 - 13, 3);
      rect(w / 2 - 13, 16, 26, 32, 'metal');
      text(
        w / 2 - 11,
        26,
        device.kind === 'esp8266'
          ? 'ESP-12E'
          : device.kind === 'd1mini'
          ? 'ESP8266'
          : 'WROOM',
        1,
        'ink',
      );
      text(w / 2 - 15, 57, device.short, 2);
      text(w / 2 - 12, 63, '3.3V GPIO', 1);
      chip(w / 2 - 7, h - 32, 14, 12);
      button(15, h - 9);
      button(w - 15, h - 9);
      if (device.kind === 'esp32s3') {
        usb(w / 2 - 20, h - 12);
        usb(w / 2 + 4, h - 12);
      } else usb(w / 2 - 8, h - 12);
      for (let i = 0; i < 3; i++) passive(w / 2 - 5, 70 + i * 5);
    } else if (device.kind === 'pi') {
      rect(38, 70, 32, 30, 'black');
      text(42, 85, 'CPU', 2);
      chip(90, 70, 22, 20, 'RAM');
      antenna(5, 80, 22);
      text(16, 112, device.short, 3);
      text(16, 119, '40-pin GPIO / BCM labels', 1);
      const ethY = device.model === 5 ? 20 : 104;
      rect(w - 32, ethY, 36, 32, 'metal');
      text(w - 28, ethY + 18, 'ETH', 2, 'ink');
      for (const yy of device.model === 5 ? [64, 106] : [24, 64]) {
        rect(w - 32, yy, 36, 28, 'metal');
        rect(w - 28, yy + 4, 25, 4, device.model === 3 ? 'black' : 'blue');
      }
      usb(10, h - 10, 18, 12, device.model === 3 ? 'PWR' : 'USB-C');
      if (device.model === 3) {
        rect(50, h - 9, 30, 11, 'metal');
        text(54, h - 2, 'HDMI', 1, 'ink');
        ellipse(107, h - 8, 10, 10, 'black');
      } else {
        for (const x of [50, 78]) {
          rect(x, h - 7, 20, 9, 'metal');
          text(x + 1, h - 1, 'HDMI', 1, 'ink');
        }
      }
      rect(133, h - 18, 6, 18, 'cream');
      rect(148, h - 18, 6, 18, 'cream');
      if (device.model === 5) {
        chip(132, 76, 26, 22, 'RP1');
        button(2, h - 22);
      } else chip(142, 80, 25, 24, 'I/O');
    } else if (['uno', 'nano', 'mega'].includes(device.kind)) {
      usb(
        w * 0.6,
        0,
        device.kind === 'nano' ? 18 : 26,
        20,
        device.kind === 'nano' ? 'MINI USB' : 'USB-B',
      );
      if (device.kind !== 'nano') {
        rect(12, 0, 18, 25, 'black');
        ellipse(15, 2, 12, 8, 'ink');
        button(w - 10, 12);
        chip(60, 30, 15, 16);
        ellipse(17, 39, 10, 10, 'metal');
        ellipse(17, 53, 10, 10, 'metal');
      }
      if (device.kind === 'uno') {
        chip(45, 74, 18, 54);
        text(48, 103, '328P', 1);
        text(38, 64, 'UNO R3', 3);
      } else if (device.kind === 'nano') {
        chip(28, 44, 20, 20, '328P');
        button(w / 2, 77);
        text(26, 34, 'NANO', 2);
      } else {
        chip(52, 90, 34, 34, '2560');
        text(32, 76, 'MEGA 2560', 3);
        chip(68, 190, 15, 15);
      }
    } else if (device.kind === 'ultrasonic') {
      for (const x of [26, 88]) {
        ellipse(x - 20, 6, 40, 40, 'metal');
        ellipse(x - 15, 11, 30, 30, 'black');
        for (let yy = 0; yy < 5; yy++)
          line(x - 11, 17 + yy * 4, x + 11, 17 + yy * 4, 2);
      }
      text(43, 18, 'HC-SR04', 2);
      text(46, 25, 'SONAR', 1);
    } else if (device.kind === 'relay') {
      rect(34, 18, 30, 52, 'black');
      icon('relay', 49, 43);
      text(36, 78, 'RELAY', 2);
      rect(1, 21, 12, 39, 'cream');
      rect(w - 14, 12, 12, 64, 'signal');
    } else {
      const hasTop = device.pins.some((p) => p.side === 'top'),
        grove = device.kind === 'grove';
      const cx = grove ? w - 31 : w / 2,
        cy = device.icon === 'touch' ? 47 : hasTop ? 55 : 39;
      if (grove) {
        rect(2, 18, 12, 38, 'cream');
        text(37, 12, device.short, 2);
      } else text(24, hasTop ? 34 : 17, device.short, 2);
      if (device.icon === 'touch') {
        rect(13, 25, w - 26, 58, 'gold');
        icon('touch', w / 2, 48);
        text(22, 78, 'TOUCH PAD', 1, 'ink');
      } else if (device.icon === 'pir') {
        ellipse(cx - 21, 17, 42, 42, 'white');
        for (let i = 0; i < 5; i++)
          line(cx - 14, 22 + i * 7, cx + 14, 22 + i * 7, 1);
        icon('pir', cx, 39);
        button(26, h - 12);
        button(42, h - 12);
      } else {
        icon(device.icon, cx, cy);
        if (device.icon === 'water')
          for (let i = 0; i < 6; i++)
            line(34 + i * 8, 55, 34 + i * 8, h - 5, 3);
        if (device.icon === 'soil')
          for (let i = 0; i < 5; i++)
            line(16 + i * 12, 70, 16 + i * 12, h - 12, 3);
      }
      if (!['touch', 'water', 'pir', 'soil'].includes(device.icon))
        for (let i = 0; i < 3; i++) passive(w - 21, 22 + i * 5);
    }
  }
  // Fitted connector housings distinguish user sockets from bare solder pads.
  const groups = new Map();
  for (const pin of device.pins) {
    const id = device.kind === 'pi' ? 'GPIO' : pin.number.split('-')[0];
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(pin);
  }
  for (const [id, pins] of groups) {
    const qt = id.startsWith('CONN'),
      soil = device.id === 'adafruit-soil';
    if (qt || soil || ['uno', 'nano', 'mega', 'pi'].includes(device.kind)) {
      const xs = pins.map((p) => p.x),
        ys = pins.map((p) => p.y);
      rect(
        Math.min(...xs) - 3,
        Math.min(...ys) - 3,
        Math.max(...xs) - Math.min(...xs) + 6,
        Math.max(...ys) - Math.min(...ys) + 6,
        qt || soil ? 'cream' : 'black',
      );
    }
  }
  // Pin labels and copper pads are separate from native pin text, keeping
  // terminal centres exactly on the normal grid without protruding stems.
  for (const p of device.pins) {
    const supply = p.electricalType === 9 || p.electricalType === 10;
    const colour =
      p.name === 'GND'
        ? 'metal'
        : supply
        ? 'red'
        : p.electricalType === 6
        ? 'metal'
        : 'gold';
    rect(p.x - 2, p.y - 2, 4, 4, colour);
    ellipse(p.x - 0.8, p.y - 0.8, 1.6, 1.6, 'black');
    const isPi = device.kind === 'pi';
    const isICSP = p.number.startsWith('ICSP');
    const piName = p.name.replace('/ID_SD', '/ID').replace('/ID_SC', '/ID');
    const label =
      device.kind === 'display'
        ? `${p.number.split('-').at(-1)} ${p.name}`
        : isPi
        ? `${p.number} ${piName.length > 10 ? piName.split('/')[0] : piName}`
        : p.name;
    if (isICSP) {
      const digit = p.number.split('-').at(-1);
      text(p.x + 2.2, p.y + 0.8, digit, 1);
    } else if (p.side === 'left') text(p.x + 3, p.y + 1.1, label, 2);
    else if (p.side === 'right')
      text(p.x - 3 - label.length * 1.0, p.y + 1.1, label, 2);
    else if (p.side === 'top') {
      if (isPi || device.kind === 'mega') vertical(p.x, p.y - 29, label);
      else
        vertical(
          p.x,
          p.y + 3,
          label,
          'white',
          Math.max(6, (label.length * 8 * 1.3 + 6) / 5),
        );
    } else if (
      isPi ||
      (device.kind === 'mega' && p.number.startsWith('EXT-'))
    ) {
      vertical(
        p.x,
        p.y + 3,
        label,
        'white',
        Math.max(6, (label.length * 8 * 1.3 + 6) / 5),
      );
    } else vertical(p.x, p.y - 29, label);
    art.push(
      `<PIN pos="${p.x},${p.y}" which="0" elec="${
        p.electricalType
      }" direction="${
        { left: 2, right: 3, top: 0, bottom: 1 }[p.side]
      }" part="0" number="${escape(
        p.number,
      )}" show="0" length="0" number_pos="0" centre_name="0">${escape(
        p.name,
      )}</PIN>`,
    );
  }
  if (['uno', 'mega', 'nano'].includes(device.kind)) {
    const y = device.kind === 'nano' ? 88 : device.kind === 'uno' ? 142 : 132;
    text(device.kind === 'nano' ? 22 : 42, y, 'ICSP  1 MISO  2 5V', 1);
    text(device.kind === 'nano' ? 22 : 42, y + 4, '3 SCK  4 MOSI', 1);
    text(device.kind === 'nano' ? 22 : 42, y + 8, '5 RST  6 GND', 1);
    if (device.kind !== 'nano') {
      text(60, 51, 'USB ICSP1', 1);
      text(60, 55, '1 MISO  2 5V  3 SCK', 1);
      text(60, 59, '4 MOSI  5 RST  6 GND', 1);
    }
  }
  return {
    device,
    width: w,
    height: h,
    pins: device.pins,
    xml: '<TinyCAD>\n' + [...resources(), ...art].join('\n') + '\n</TinyCAD>\n',
  };
}

export function embeddedArtwork(recipe) {
  const records = recipe.devices.map(embeddedSymbol).map(compactEmbedded);
  const provenance = {
    version: 1,
    id: recipe.id,
    name: recipe.name,
    artwork: recipe.artwork,
    scope: recipe.scope,
    powerConvention: recipe.powerConvention,
    survey: recipe.survey,
    sourceReview: recipe.sourceReview,
    entries: records.map((r) => ({
      ...r.device,
      width: r.width,
      height: r.height,
      pins: r.pins,
      layout: r.layout,
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
      Reference: r.device.kind === 'relay' ? 'K?' : 'U?',
      ppp: 1,
      ShowName: 1,
      ShowRef: 1,
      DefRotate: 0,
      Description: `${r.device.name}. ${r.device.notes} ${
        r.device.view || ''
      } ${recipe.scope}`,
      Attributes: [
        {
          AttName: 'Source',
          AttValue: r.device.sources.join('\n'),
          ShowAtt: 1,
        },
        {
          AttName: 'Pinout',
          AttValue: r.pins.map((p) => `${p.number}=${p.name}`).join('; '),
          ShowAtt: 1,
        },
        { AttName: 'Artwork', AttValue: recipe.artwork, ShowAtt: 1 },
      ],
    })),
    symbols: records.map((r, i) => ({ SymbolId: i + 1, Data: r.xml })),
  };
  return { recipe, records, provenance, library };
}
