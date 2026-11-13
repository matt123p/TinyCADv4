import { createHash } from 'node:crypto';
import { vectorCanvas, textWidth, escapeXML } from './layout-artwork.mjs';

export function motorsMotionSymbol(device) {
  const c = vectorCanvas(),
    { rect, ellipse, poly, line, text, art } = c;
  const ports = device.ports.map((p, i) => ({
    ...p,
    number: p.number ?? String(i + 1),
  }));
  const placed = [];
  let w = 40,
    h = 32;
  const at = (p, x, y) => placed.push({ ...p, x, y });
  const row = (ps, x, y, pitch = 6) =>
    ps.forEach((p, i) => at(p, x + i * pitch, y));
  const panel = (width, height, colour = 'metal') => {
    w = width;
    h = height;
    rect(0, 0, w, h, colour);
  };
  const screw = (x, y) => {
    ellipse(x - 1, y - 1, 2, 2, 'metal');
    line(x - 0.5, y + 0.5, x + 0.5, y - 0.5);
  };
  const shaft = (x, y, length = 8) => {
    rect(x, y, length, 3, 'metal');
    line(x + 2, y + 1, x + length, y + 1, 2);
  };
  const gear = (x, y, r = 5) => {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      line(
        x + Math.cos(a) * (r - 1),
        y + Math.sin(a) * (r - 1),
        x + Math.cos(a) * (r + 1),
        y + Math.sin(a) * (r + 1),
      );
    }
    ellipse(x - r, y - r, 2 * r, 2 * r, 'metal');
    ellipse(x - 1.5, y - 1.5, 3, 3, 'dark');
  };
  const bank = (startY = 28, columns = 6, pitch = 6) => {
    for (let i = 0; i < ports.length; i += columns)
      row(
        ports.slice(i, i + columns),
        4,
        startY + Math.floor(i / columns) * 8,
        pitch,
      );
  };
  const motorCan = (x, y, width = 23, height = 16) => {
    rect(x, y, width, height, 'metal');
    ellipse(x + width - 3, y, 6, height, 'metal');
    rect(x - 2, y + 2, 4, height - 4, 'dark');
    for (let yy = y + 3; yy < y + height - 1; yy += 4)
      rect(x + 5, yy, 5, 1, 'dark');
  };
  const chip = (x, y, width = 10, height = 10) => {
    rect(x, y, width, height, 'dark');
    for (let yy = y + 1; yy < y + height; yy += 2) {
      rect(x - 1, yy, 1, 1, 'metal');
      rect(x + width, yy, 1, 1, 'metal');
    }
  };
  const coil = (x, y, width = 15, height = 12) => {
    rect(x, y, width, height, 'amber');
    for (let xx = x + 1; xx < x + width - 1; xx += 2)
      line(xx, y, xx, y + height, 2);
  };
  switch (device.kind) {
    case 'dc-motor': {
      w = 44;
      h = device.shape === 'encoder' ? 38 : 30;
      const geared = [
        'microgear',
        'ttgear',
        'planetary',
        'worm',
        'encoder',
      ].includes(device.shape);
      if (device.shape === 'ttgear') {
        rect(5, 3, 24, 17, 'amber');
        rect(7, 17, 15, 8, 'amber');
        ellipse(21, 9, 12, 12, 'metal');
        shaft(29, 13, 10);
        motorCan(0, 1, 17, 10);
      } else if (device.shape === 'worm') {
        motorCan(0, 3, 19, 14);
        rect(20, 1, 14, 23, 'metal');
        gear(27, 13, 5);
        shaft(30, 12, 11);
      } else {
        const height =
          device.shape === 'coreless'
            ? 11
            : device.shape === 'can775'
            ? 21
            : 16;
        motorCan(2, 3, geared ? 18 : 25, height);
        if (geared) {
          rect(22, 2, 9, height + 2, 'metal');
          gear(27, 3 + height / 2, 3);
        }
        shaft(geared ? 31 : 29, 3 + height / 2 - 1.5, 10);
        if (device.shape === 'encoder') {
          rect(0, 2, 4, height + 3, 'green');
          ellipse(1, 7, 3, 5, 'dark');
        }
      }
      bank(device.shape === 'encoder' ? 34 : 28, 6, 6);
      for (const [i, p] of placed.entries())
        poly(
          [
            [4 + i * 0.4, device.shape === 'coreless' ? 12 : 18],
            [p.x, 23],
            [p.x, p.y],
          ],
          null,
        );
      break;
    }
    case 'bldc': {
      w = 42;
      h = device.shape === 'hall' ? 42 : 32;
      if (device.shape === 'outrunner') {
        rect(5, 5, 23, 13, 'dark');
        ellipse(3, 3, 8, 17, 'metal');
        ellipse(23, 3, 8, 17, 'metal');
        for (let x = 10; x < 23; x += 4) rect(x, 6, 1.5, 10, 'red');
        shaft(28, 10, 11);
      } else {
        motorCan(3, 3, 26, 18);
        shaft(31, 10, 9);
        rect(1, 6, 3, 12, 'dark');
      }
      bank(28, 4, 8);
      for (const [i, p] of placed.entries())
        poly(
          [
            [3 + i * 0.4, 20],
            [p.x, 24],
            [p.x, p.y],
          ],
          null,
        );
      break;
    }
    case 'stepper': {
      const size = { 14: 22, 17: 26, 23: 30, 34: 34 }[device.frame];
      w = Math.max(38, size + 4);
      h = ports.length > 4 ? 48 : 40;
      rect(3, 2, size, size, 'dark');
      rect(3, 2, size, 5, 'metal');
      rect(3, size - 3, size, 5, 'metal');
      ellipse(3 + size / 2 - 6, 2 + size / 2 - 6, 12, 12, 'metal');
      ellipse(3 + size / 2 - 2, 2 + size / 2 - 2, 4, 4, 'dark');
      for (const x of [6, size]) for (const y of [5, size - 1]) screw(x, y);
      bank(ports.length > 4 ? 36 : 38, 4, 8);
      for (const [i, p] of placed.entries())
        poly(
          [
            [5 + i * 0.5, 2 + size],
            [p.x, p.y],
          ],
          null,
        );
      break;
    }
    case 'servo': {
      const micro = device.shape === 'micro',
        smart = device.shape === 'smart';
      w = micro ? 28 : 36;
      h = smart ? 42 : 34;
      rect(5, 7, micro ? 18 : 26, 18, micro ? 'blue' : 'dark');
      rect(2, 13, w - 2, 4, 'metal');
      for (const x of [4, w - 2]) screw(x, 15);
      ellipse(8, 1, 12, 10, 'metal');
      ellipse(12, 4, 4, 4, 'dark');
      rect(6, 5, 23, 2, 'white');
      for (const x of [8, 12, 18, 22, 26])
        ellipse(x - 0.35, 5.6, 0.7, 0.7, 'dark');
      if (device.shape === 'continuous')
        poly(
          [
            [26, 3],
            [31, 5],
            [29, 9],
            [26, 8],
          ],
          null,
          3,
        );
      if (smart) {
        const n = device.bus === 'ttl' ? 3 : 4;
        row(ports.slice(0, n), 8, 30, 6);
        row(ports.slice(n), 8, 38, 6);
      } else {
        row(ports, 8, 32, 6);
        for (const [i, p] of placed.entries())
          poly(
            [
              [9 + i, 25],
              [p.x, 29],
              [p.x, 32],
            ],
            null,
          );
      }
      break;
    }
    case 'carrier': {
      panel(device.id === 'driver-drv8825' ? 56 : 34, 38, device.colour);
      if (w > 34) {
        rect(34, 0, 22, 38, 'white');
        rect(42, 12, 12, 16, 'green');
        rect(45, 16, 6, 8, 'gold');
        text(40, 6, 'REAR', 1);
      }
      for (const p of ports) {
        if (p.side === 'rear') at(p, 48, 20);
        else at(p, p.side === 'L' ? 2 : 32, 4 + (p.order - 1) * 4);
      }
      chip(12, 13, 10, 11);
      for (const y of [6, 29]) {
        rect(12, y, 4, 2, 'metal');
        rect(18, y, 4, 2, 'metal');
      }
      const potY = device.id === 'driver-drv8825' ? 7 : 33;
      if (device.id !== 'driver-tb6612') {
        ellipse(14, potY - 2, 5, 5, 'metal');
        line(14.8, potY + 1.2, 18, potY - 1);
      }
      break;
    }
    case 'driver-board':
    case 'enclosed-driver': {
      const columns = 6,
        rows = Math.ceil(ports.length / columns);
      panel(
        46,
        22 + rows * 8,
        device.kind === 'driver-board' ? 'green' : 'metal',
      );
      if (device.kind === 'driver-board') {
        h = 44;
        rect(0, 0, w, h, 'green');
        chip(15, 12, 14, 10);
        ellipse(4, 13, 5, 7, 'dark');
        rect(35, 11, 5, 10, 'metal');
        if (device.id === 'driver-dual-hbridge') {
          row(ports.slice(0, 4), 4, 6, 12);
          row(ports.slice(4, 11), 4, 38, 6);
          row(ports.slice(11), 4, 28, 12);
        } else {
          row(ports.slice(0, 4), 4, 28, 12);
          row(ports.slice(4), 4, 38, 8);
        }
      } else {
        rect(2, 2, 42, 18, 'dark');
        for (let x = 4; x < 36; x += 3) line(x, 3, x, 18, 2);
        rect(33, 5, 8, 8, 'blue');
        text(34, 10, 'DRV', 1, 'white');
      }
      if (device.kind !== 'driver-board') bank(26, columns, 6);
      break;
    }
    case 'esc': {
      panel(38, 30, 'blue');
      rect(3, 3, 32, 15, 'dark');
      for (let x = 6; x < 34; x += 4) line(x, 4, x, 17, 2);
      row(ports.slice(0, 2), 4, 26, 8);
      row(ports.slice(2, 5), 22, 26, 6);
      row(ports.slice(5), 10, 36, 8);
      h = 40;
      break;
    }
    case 'servo-controller': {
      panel(76, 36, 'green');
      for (const x of [2, 74]) for (const y of [2, 34]) screw(x, y);
      row(ports.slice(0, 6), 6, 6, 6);
      row(ports.slice(6, 8), 62, 6, 8);
      chip(30, 10, 14, 6);
      poly(
        [
          [32, 13],
          [34, 11],
          [36, 15],
          [38, 11],
          [40, 15],
          [42, 13],
        ],
        null,
        3,
      );
      for (let i = 0; i < 16; i++) text(5.5 + i * 4, 18, String(i), 1, 'white');
      for (const p of ports.slice(8))
        at(
          p,
          6 + p.channel * 4,
          p.name.endsWith('PWM') ? 22 : p.name.endsWith('V+') ? 28 : 34,
        );
      break;
    }
    case 'encoder': {
      w = 40;
      h = ports.length > 6 ? 40 : 32;
      if (device.shape === 'linear') {
        rect(3, 6, 28, 10, 'metal');
        rect(15, 4, 6, 14, 'dark');
        rect(16, 0, 4, 6, 'metal');
        line(5, 11, 29, 11, 2);
      } else {
        ellipse(3, 2, 24, 24, 'metal');
        ellipse(8, 7, 14, 14, 'dark');
        ellipse(12, 11, 6, 6, 'metal');
        shaft(24, 12, 13);
        for (let i = 0; i < 12; i++) {
          const a = (i * Math.PI) / 6;
          line(
            15 + Math.cos(a) * 8,
            14 + Math.sin(a) * 8,
            15 + Math.cos(a) * 10,
            14 + Math.sin(a) * 10,
            2,
          );
        }
      }
      bank(30, 4, 8);
      break;
    }
    case 'encoder-board': {
      panel(32, 30, 'green');
      for (const x of [3, 29]) screw(x, 3);
      ellipse(10, 3, 12, 12, 'white');
      ellipse(13, 6, 6, 6, 'red');
      poly(
        [
          [16, 2],
          [22, 8],
          [16, 14],
          [10, 8],
          [16, 2],
        ],
        null,
        3,
      );
      row(ports, 4, 26, 4);
      break;
    }
    case 'limit': {
      w = device.shape === 'estop' ? 34 : 30;
      h = 30;
      if (device.shape === 'estop') {
        rect(3, 8, 28, 15, 'dark');
        ellipse(5, 0, 24, 18, 'amber');
        ellipse(8, 1, 18, 12, 'red');
      } else {
        rect(3, 10, 23, 12, 'dark');
        for (const x of [7, 22]) screw(x, 17);
        if (device.shape === 'plunger') {
          rect(13, 5, 5, 6, 'metal');
          ellipse(13, 3, 5, 4, 'red');
        } else {
          poly(
            [
              [5, 9],
              [25, 3],
              [28, 4],
            ],
            null,
          );
          if (device.shape === 'roller') ellipse(24, 0, 6, 6, 'metal');
        }
      }
      row(ports, 4, 28, 8);
      break;
    }
    case 'limit-board': {
      panel(32, 30, 'green');
      screw(3, 3);
      screw(29, 3);
      if (device.optical) {
        rect(7, 6, 18, 14, 'dark');
        rect(12, 5, 7, 9, 'white');
      } else {
        rect(5, 10, 22, 10, 'dark');
        poly(
          [
            [6, 9],
            [25, 3],
            [27, 4],
          ],
          null,
        );
        ellipse(23, 1, 5, 5, 'metal');
      }
      row(ports, 6, 26, 8);
      break;
    }
    case 'proximity': {
      w = 38;
      h = 30;
      if (device.shape === 'reed') {
        rect(3, 9, 26, 6, 'white');
        poly(
          [
            [5, 12],
            [16, 12],
            [22, 10],
            [28, 12],
          ],
          null,
        );
        rect(9, 1, 15, 4, 'red');
      } else {
        rect(4, 7, 24, 12, 'metal');
        ellipse(25, 7, 6, 12, 'blue');
        for (let x = 6; x < 22; x += 2) line(x, 7, x + 2, 19, 2);
        rect(2, 8, 4, 10, 'dark');
      }
      row(ports, 6, 26, 8);
      break;
    }
    case 'solenoid': {
      w = 42;
      h = 34;
      if (device.shape === 'rotary') {
        ellipse(3, 3, 25, 22, 'metal');
        ellipse(9, 8, 13, 12, 'dark');
        rect(14, 3, 3, 14, 'metal');
        poly(
          [
            [28, 4],
            [33, 10],
            [29, 15],
          ],
          null,
          3,
        );
      } else {
        rect(3, 3, 27, 20, 'metal');
        coil(6, 6, 20, 14);
        rect(10, 10, 27, 5, 'metal');
        rect(35, 7, 4, 11, 'metal');
        if (device.shape === 'frame') {
          rect(3, 6, 2, 14, 'white');
          rect(27, 6, 2, 14, 'white');
        }
      }
      bank(30, 4, 8);
      break;
    }
    case 'actuator': {
      w = 52;
      h = ports.length > 6 ? 46 : 38;
      if (device.shape === 'rod') {
        rect(6, 8, 26, 10, 'metal');
        rect(8, 16, 13, 12, 'dark');
        shaft(32, 11, 16);
        ellipse(1, 9, 7, 8, 'metal');
        ellipse(46, 9, 5, 7, 'metal');
      } else if (device.shape === 'stage') {
        rect(2, 4, 46, 20, 'metal');
        line(4, 8, 46, 8);
        line(4, 20, 46, 20);
        rect(16, 3, 14, 22, 'blue');
        for (let x = 4; x < 47; x += 3) line(x, 12, x + 2, 16, 2);
        rect(0, 5, 8, 18, 'dark');
      } else if (device.shape === 'cylinder') {
        rect(8, 7, 28, 16, 'metal');
        rect(5, 5, 5, 20, 'dark');
        rect(34, 5, 5, 20, 'dark');
        shaft(39, 13, 11);
        for (const y of [9, 21]) line(10, y, 34, y);
      } else if (device.shape === 'valve') {
        rect(9, 6, 34, 16, 'metal');
        rect(0, 6, 10, 16, 'dark');
        coil(2, 9, 6, 10);
        rect(43, 9, 7, 10, 'dark');
      } else {
        rect(13, 7, 24, 15, 'dark');
        poly(
          [
            [15, 8],
            [9, 2],
            [3, 4],
            [8, 9],
            [12, 16],
          ],
          'metal',
        );
        poly(
          [
            [35, 8],
            [41, 2],
            [47, 4],
            [42, 9],
            [38, 16],
          ],
          'metal',
        );
        ellipse(20, 10, 10, 10, 'metal');
      }
      bank(32, 6, 8);
      break;
    }
    case 'mechanical': {
      w = 42;
      h = 32;
      if (device.shape === 'wheel') {
        ellipse(5, 0, 26, 28, 'dark');
        ellipse(9, 4, 18, 20, 'metal');
        ellipse(15, 10, 6, 8, 'dark');
        for (let y = 3; y < 27; y += 4) line(5, y, 8, y, 2);
      } else if (device.shape === 'caster') {
        rect(10, 0, 19, 5, 'metal');
        ellipse(15, 3, 10, 9, 'metal');
        poly(
          [
            [15, 8],
            [12, 21],
            [26, 24],
            [28, 8],
          ],
          null,
        );
        ellipse(13, 14, 17, 16, 'dark');
        ellipse(19, 19, 5, 6, 'metal');
      } else if (device.shape === 'coupling') {
        rect(4, 6, 32, 17, 'metal');
        for (let x = 8; x < 32; x += 4) line(x, 7, x + 3, 22, 2);
        shaft(0, 12, 6);
        shaft(36, 12, 6);
      } else if (device.shape === 'lead-axis' || device.shape === 'belt-axis') {
        rect(1, 5, 40, 17, 'metal');
        line(3, 8, 39, 8);
        line(3, 20, 39, 20);
        rect(16, 3, 10, 21, 'blue');
        if (device.shape === 'lead-axis')
          for (let x = 3; x < 38; x += 2) line(x, 12, x + 1, 16, 2);
        else {
          ellipse(3, 10, 8, 9, 'dark');
          ellipse(31, 10, 8, 9, 'dark');
          line(7, 11, 35, 11);
          line(7, 18, 35, 18);
        }
      } else if (device.shape === 'pantilt') {
        ellipse(9, 24, 24, 6, 'metal');
        poly(
          [
            [12, 25],
            [9, 6],
            [30, 6],
            [31, 25],
          ],
          null,
        );
        rect(12, 0, 18, 6, 'blue');
        ellipse(17, 8, 9, 9, 'metal');
      } else {
        rect(4, 4, 4, 24, 'metal');
        rect(4, 24, 31, 4, 'metal');
        ellipse(10, 3, 20, 15, 'white');
        ellipse(17, 8, 6, 5, 'dark');
        for (const x of [13, 25]) screw(x, 10);
      }
      break;
    }
    default:
      throw new Error('Unknown motion artwork ' + device.kind);
  }
  // Pad faces and their native electrical points share an exact on-grid centre.
  for (const p of placed) {
    const { x, y, kind } = p;
    if (kind === 'pad' || kind === 'header') {
      rect(
        x - 0.8,
        y - 0.8,
        1.6,
        1.6,
        p.signal === 'reference'
          ? 'metal'
          : p.electricalType === 9
          ? 'red'
          : 'gold',
      );
      ellipse(x - 0.25, y - 0.25, 0.5, 0.5, 'dark');
    } else if (kind === 'terminal') {
      rect(x - 1.5, y - 1.5, 3, 3, 'green');
      ellipse(x - 0.8, y - 0.8, 1.6, 1.6, 'metal');
      line(x - 0.5, y + 0.5, x + 0.5, y - 0.5);
    } else if (
      ['usb', 'feedback-cable', 'ethernet', 'serial-cable'].includes(kind)
    ) {
      rect(x - 2, y - 1.3, 4, 2.6, 'dark');
      rect(x - 1.2, y - 0.4, 2.4, 0.8, 'gold');
    } else {
      const r = kind === 'hose' ? 1.8 : 1;
      ellipse(x - r, y - r, 2 * r, 2 * r, 'metal');
      ellipse(
        x - r * 0.5,
        y - r * 0.5,
        r,
        r,
        kind === 'hose' ? 'blue' : 'dark',
      );
    }
    if (device.kind === 'carrier' && p.side !== 'rear') {
      const left = p.side === 'L';
      text(
        left ? x + 1.4 : x - 1.4 - textWidth(p.label) + 1.2,
        y + 0.5,
        p.label,
        1,
        'white',
      );
    } else {
      const tw = textWidth(p.label);
      rect(x - tw / 2, y - 4, tw, 2, 'white', 2);
      text(x - tw / 2 + 0.6, y - 2.2, p.label);
    }
    art.push(
      `<PIN pos="${x},${y}" which="0" elec="${p.electricalType}" direction="${
        p.side === 'L' ? 3 : p.side === 'R' ? 2 : 0
      }" part="0" number="${escapeXML(
        p.number,
      )}" show="0" length="0" number_pos="0" centre_name="0">${escapeXML(
        p.name,
      )}</PIN>`,
    );
  }
  text(0, h + 5, device.short, 2);
  const width = Math.ceil(Math.max(w, textWidth(device.short, 8)) / 2) * 2,
    height = Math.ceil((h + 8) / 2) * 2;
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

export function motorsMotionArtwork(recipe) {
  const records = recipe.devices.map(motorsMotionSymbol);
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
      Reference: [
        'carrier',
        'driver-board',
        'enclosed-driver',
        'esc',
        'servo-controller',
      ].includes(r.device.kind)
        ? 'U?'
        : r.device.kind === 'servo'
        ? 'SV?'
        : r.device.kind.startsWith('encoder')
        ? 'ENC?'
        : ['limit', 'limit-board', 'proximity'].includes(r.device.kind)
        ? 'SW?'
        : r.device.kind === 'solenoid'
        ? 'SOL?'
        : r.device.kind === 'actuator'
        ? 'A?'
        : r.device.kind === 'mechanical'
        ? 'MECH?'
        : 'M?',
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
                `${p.number}: ${p.name} | ${p.kind} | ${p.unit} | ${
                  p.signal
                } | electrical type ${p.electricalType}${
                  p.activeLow ? ' | active low' : ''
                }`,
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
