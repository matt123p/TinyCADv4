// Original front-face graphics plus a separate rear PCB view for actual wiring.
// Manufacturer documentation supplies connector facts, not artwork paths.
export function drawEmbeddedDisplay(
  device,
  { rect, ellipse, line, text, chip, hole, icon },
) {
  const { boardWidth: bw, boardHeight: bh } = device,
    rear = bw + 24,
    top = 12;
  text(3, 7, 'FRONT', 2, 'ink');
  text(rear + 3, 7, 'REAR / WIRING', 2, 'ink');
  for (const x of [0, rear]) {
    rect(x, top, bw, bh, device.displayType === 'character' ? 'pcb' : 'blue');
    rect(x + 1.5, top + 1.5, bw - 3, bh - 3, null, 2);
    for (const [dx, dy] of [
      [6, 6],
      [bw - 6, 6],
      [6, bh - 6],
      [bw - 6, bh - 6],
    ])
      hole(x + dx, top + dy);
  }
  const type = device.displayType,
    sx = 10,
    sy = top + 12,
    sw = bw - 20,
    sh = bh - 24;
  rect(sx - 2, sy - 2, sw + 4, sh + 4, 'metal');
  rect(
    sx,
    sy,
    sw,
    sh,
    type === 'epaper' ? 'white' : type === 'oled' ? 'black' : 'blue',
  );
  if (type === 'character') {
    const cell = (sw - 8) / device.columns;
    for (let row = 0; row < device.rows; row++)
      for (let col = 0; col < device.columns; col++)
        rect(sx + 4 + col * cell, sy + 7 + row * 14, cell - 1, 10, 'blue', 2);
    // Original dot-matrix glyphs drawn as native rectangles, aligned to the
    // sixteen character cells instead of a bitmap or a copied font asset.
    const glyphs = {
      H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
      O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
      M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
      E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
      S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
      N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'],
      R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
      T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
      P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
      C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
      2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
      4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
      0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
      '.': ['00000', '00000', '00000', '00000', '00000', '00110', '00110'],
    };
    for (const [row, content] of ['HOME SENSOR', 'TEMP 24.0 C'].entries())
      for (const [col, char] of [...content].entries())
        for (const [y, bits] of (glyphs[char] || []).entries())
          for (const [x, on] of [...bits].entries())
            if (on === '1')
              rect(
                sx + 4 + col * cell + (x * (cell - 1)) / 5 + 0.2,
                sy + 7 + row * 14 + (y * 10) / 7 + 0.15,
                (cell - 1) / 5 - 0.3,
                10 / 7 - 0.3,
                'white',
              );
  } else if (type === 'epaper') {
    text(sx + 5, sy + 9, 'HOME', 3, 'ink');
    text(sx + 5, sy + 16, '24.0 C   52% RH', 2, 'ink');
    line(sx + 5, sy + 20, sx + sw - 5, sy + 20);
    const baseline = sy + sh - 8;
    for (let i = 0; i < 7; i++)
      rect(
        sx + 6 + (i * (sw - 16)) / 8,
        baseline - 5 - (i % 4) * 3,
        (sw - 16) / 12,
        5 + (i % 4) * 3,
        'black',
      );
    text(sx + 5, sy + sh - 1, 'E-PAPER', 1, 'ink');
  } else {
    text(sx + 5, sy + 10, type === 'oled' ? 'ROOM' : 'HOME CONTROL', 3);
    text(sx + 5, sy + 20, '24.0 C', 3);
    if (type === 'touchscreen' || type === 'hmi') {
      rect(sx + 6, sy + sh - 31, (sw - 18) / 2, 16, 'signal');
      rect(sx + 12 + (sw - 18) / 2, sy + sh - 31, (sw - 18) / 2, 16, 'red');
      text(sx + 10, sy + sh - 21, 'ON', 2, 'ink');
      text(sx + 18 + (sw - 18) / 2, sy + sh - 21, 'OFF', 2, 'ink');
      icon('touch', sx + sw / 2, sy + sh / 2);
      text(
        sx + 5,
        sy + sh - 4,
        type === 'hmi' ? 'UART TOUCH' : 'CAPACITIVE TOUCH',
        1,
      );
    } else {
      const y = sy + sh - 9;
      for (let i = 0; i < 5; i++)
        rect(sx + 7 + i * 8, y - 4 - i * 2, 4, 4 + i * 2, 'white');
    }
  }
  text(5, top + bh + 8, device.short, 2, 'ink');
  text(rear + 5, top + bh + 8, device.interface, 2, 'ink');
  // The PCB geometry is intentionally simplified, preserving the identifiable
  // connector groups and board proportions without copying the PCB artwork.
  chip(rear + bw * 0.4, top + bh * 0.44, bw * 0.21, Math.min(22, bh * 0.2));
  const ribbonX = rear + (type === 'oled' ? 8 : bw * 0.37);
  const ribbonY = top + bh * (type === 'oled' ? 0.55 : 0.25);
  rect(ribbonX, ribbonY, bw * 0.25, 6, 'cream');
  for (let i = 1; i < 8; i++)
    line(
      ribbonX + i * bw * 0.025,
      ribbonY,
      ribbonX + i * bw * 0.025,
      ribbonY + 6,
      3,
    );
  if (type === 'hmi') {
    rect(rear + bw - 22, top + bh * 0.25, 24, 23, 'metal');
    text(rear + bw - 19, top + bh * 0.25 + 15, 'SD', 1, 'ink');
    text(rear + 9, top + bh * 0.72, '5V / UART', 2);
  } else if (type === 'touchscreen') {
    rect(rear + bw * 0.36, top + 19, bw * 0.27, 6, 'cream');
    text(rear + 18, top + bh * 0.64, 'SPI LCD', 2);
    text(rear + 18, top + bh * 0.69, 'I2C TOUCH', 2);
  } else if (type === 'epaper') {
    text(rear + bw * 0.34, top + bh * 0.75, 'SPI / BUSY', 2);
  }
  const groups = new Map();
  for (const p of device.pins) {
    const id = p.number.split('-')[0];
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(p);
  }
  for (const [id, pins] of groups) {
    const xs = pins.map((p) => p.x),
      ys = pins.map((p) => p.y),
      x = Math.min(...xs),
      y = Math.min(...ys);
    rect(
      x - 3,
      y - 3,
      Math.max(...xs) - x + 6,
      Math.max(...ys) - y + 6,
      'cream',
    );
    if (new Set(xs).size === 1)
      text(x > rear + bw / 2 ? x - 16 : x + 4, y - 5, id, 1);
    else text(x, y - 5, id, 1);
  }
}
