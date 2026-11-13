import { createHash } from 'node:crypto';

export const rackSize = { width: 264, height: 24 };
const xml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[
        c
      ]),
  );
const bgr = (rgb) => rgb.slice(4, 6) + rgb.slice(2, 4) + rgb.slice(0, 2);
const colours = {
  ink: '293542',
  metal: 'cdd4db',
  edge: '97a4b1',
  socket: '28313b',
  gold: 'dbb75a',
  green: '58b77c',
  blue: '3087c8',
  white: 'f4f6f8',
  dark: '46515e',
  amber: 'eab65a',
};
const fills = Object.keys(colours);
const fill = (name) => fills.indexOf(name) + 1;

function resources() {
  const fonts = [6, 8, 10].map(
    (height, i) =>
      `<FONT id="${i + 1}"><HEIGHT>${height}</HEIGHT><WIDTH>0</WIDTH><WEIGHT>${
        i === 2 ? 700 : 400
      }</WEIGHT><ITALIC>0</ITALIC><UNDERLINE>0</UNDERLINE><STRIKEOUT>0</STRIKEOUT><CHARSET>0</CHARSET><FACENAME>Arial</FACENAME></FONT>`,
  );
  return [
    ...fonts,
    `<STYLE id="1"><STYLE>0</STYLE><COLOR>${bgr(
      colours.ink,
    )}</COLOR><THICKNESS>1</THICKNESS></STYLE>`,
    `<STYLE id="2"><STYLE>0</STYLE><COLOR>${bgr(
      colours.edge,
    )}</COLOR><THICKNESS>1</THICKNESS></STYLE>`,
    `<STYLE id="3"><STYLE>0</STYLE><COLOR>${bgr(
      colours.gold,
    )}</COLOR><THICKNESS>1</THICKNESS></STYLE>`,
    ...fills.map(
      (name) =>
        `<FILL id="${fill(name)}"><INDEX>0</INDEX><COLOR>${bgr(
          colours[name],
        )}</COLOR></FILL>`,
    ),
  ];
}

export function networkSymbol(device) {
  const art = [],
    ports = [];
  const rect = (x, y, w, h, colour = 'metal', style = 1) =>
    art.push(
      `<RECTANGLE a="${x},${y}" b="${x + w},${y + h}" style="${style}" fill="${
        colour ? fill(colour) : 0
      }"/>`,
    );
  const ellipse = (x, y, w, h, colour = 'white', style = 1) =>
    art.push(
      `<ELLIPSE a="${x},${y}" b="${x + w},${y + h}" style="${style}" fill="${
        colour ? fill(colour) : 0
      }"/>`,
    );
  const line = (x1, y1, x2, y2, style = 2) =>
    art.push(
      `<POLYGON pos="${x1},${y1}" style="${style}" fill="0"><POINT pos="0,0" arc="0"/><POINT pos="${
        x2 - x1
      },${y2 - y1}" arc="0"/></POLYGON>`,
    );
  const text = (x, y, value, font = 1, colour = 'ink') => {
    // Explicit text bounds include the native Markdown renderer's padding.
    // Legacy TEXT computes a box too small for its first baseline at these
    // small faceplate font sizes, clipping labels in the current editor.
    const size = [6, 8, 10][font - 1];
    const left = x - 0.6,
      top = y - (size + 3) / 5;
    const width =
      (String(value).length * size * (font === 3 ? 1.5 : 1.3) + 6) / 5;
    const height = (size * 1.4 + 6) / 5;
    art.push(
      `<NOTE_TEXT a="${left},${top}" b="${left + width},${
        top + height
      }" direction="3" font="${font}" color="${bgr(
        colours[colour],
      )}" style="1" fill="0" border_style="2">${xml(value)}</NOTE_TEXT>`,
    );
  };
  const led = (x, y, colour = 'green') =>
    ellipse(x - 0.5, y - 0.5, 1, 1, colour, 2);
  function socket(x, y, name, kind = 'rj45', label = name) {
    // Each physical socket is one cable endpoint. No external pin stems or
    // automatic named-power connections: wires terminate inside the opening.
    const number = String(ports.length + 1);
    ports.push({ number, name, kind, x, y });
    if (kind === 'rj45') {
      rect(
        x - 3.4,
        y - 2.6,
        6.8,
        5.2,
        name.startsWith('WAN')
          ? 'blue'
          : name.includes('/PoE+')
          ? 'amber'
          : 'edge',
        2,
      );
      rect(x - 2.8, y - 2, 5.6, 3.5, 'socket');
      rect(x - 1.3, y + 1.1, 2.6, 1.1, 'socket');
      for (let c = 0; c < 8; c++)
        line(x - 2.1 + c * 0.6, y - 1.9, x - 2.1 + c * 0.6, y - 1.1, 3);
      led(x - 2.6, y + 2, 'green');
      led(x + 2.6, y + 2, 'amber');
    } else {
      rect(x - 3.5, y - 2.5, 7, 5, 'edge', 2);
      rect(x - 2.9, y - 1.9, 5.8, 3.8, kind === 'fibre' ? 'green' : 'socket');
      line(x, y - 1.6, x, y + 1.6);
      rect(x - 2, y + 1.4, 4, 0.4, kind === 'fibre' ? 'white' : 'blue', 2);
    }
    text(x - String(label).length * 0.34, y - 3.5, label);
    art.push(
      `<PIN pos="${x},${y}" which="0" elec="4" direction="0" part="0" number="${number}" show="0" length="0" number_pos="0" centre_name="0">${xml(
        name,
      )}</PIN>`,
    );
  }
  function copperName(i) {
    if (device.kind === 'injector') return i === 0 ? 'LAN IN' : 'PoE OUT';
    if (device.kind === 'ap-wall') return i === 0 ? 'PoE IN' : `LAN${i}`;
    if (device.wan)
      return i < device.wan ? `WAN${i + 1}` : `LAN${i - device.wan + 1}`;
    if (
      device.kind.startsWith('ap-') ||
      device.kind === 'mesh' ||
      device.kind === 'ont'
    )
      return i === 0 && device.poe ? 'LAN1/PoE' : `LAN${i + 1}`;
    return String(i + 1) + (i < (device.poePorts || 0) ? '/PoE+' : '');
  }
  const title = {
    'wifi-router': 'WI-FI ROUTER',
    router: 'ROUTER',
    firewall: 'FIREWALL',
    switch: device.poePorts ? 'PoE+ SWITCH' : 'SWITCH',
    aggregation: 'AGG SWITCH',
    controller: 'WI-FI CTRL',
    patch: 'PATCH PANEL',
    blank: 'BLANK PANEL',
    'ap-ceiling': 'ACCESS POINT',
    'ap-wall': 'WALL AP',
    'ap-desktop': 'ACCESS POINT',
    mesh: 'MESH',
    ont: 'FIBRE ONT',
    injector: 'PoE INJECTOR',
  }[device.kind];
  let width, height;
  if (device.rack) {
    ({ width, height } = rackSize);
    rect(0, 0, width, height, 'edge');
    rect(6, 0, width - 12, height, 'metal');
    for (const x of [3, width - 3]) {
      ellipse(x - 0.9, 4, 1.8, 3, 'socket');
      ellipse(x - 0.9, 17, 1.8, 3, 'socket');
    }
    text(11, 7, title, 2);
    text(
      11,
      11,
      device.kind === 'blank'
        ? '19in / 1U'
        : device.kind === 'aggregation'
        ? `${device.sfp} SFP+`
        : `${device.copper} RJ45${device.sfp ? ` + ${device.sfp} SFP+` : ''}`,
    );
    if (device.poePorts) text(11, 14.5, `${device.poePorts} PoE+`);
    if (!['patch', 'blank'].includes(device.kind)) {
      led(12, 18);
      text(14, 18.6, 'PWR');
      for (let i = 0; i < 5; i++) line(29 + i, 16, 29 + i, 20);
    }
    const rows = device.copper > (device.kind === 'patch' ? 24 : 16) ? 2 : 1;
    const columns = Math.ceil(device.copper / rows);
    const pitch = columns > 16 ? 8 : 10;
    const start = columns > 16 ? 40 : 48;
    for (let i = 0; i < device.copper; i++) {
      const column = Math.floor(i / rows),
        row = i % rows;
      socket(
        start + column * pitch,
        rows === 1 ? 14 : 8 + row * 10,
        copperName(i),
        'rj45',
        device.wan ? copperName(i) : i + 1,
      );
    }
    for (let i = 0; i < (device.sfp || 0); i++) {
      const x =
        device.kind === 'aggregation'
          ? 48 + i * 10
          : 238 + (device.sfp > 2 ? Math.floor(i / 2) : i) * 12;
      socket(
        x,
        device.kind === 'aggregation'
          ? 14
          : device.sfp > 2
          ? 8 + (i % 2) * 10
          : 14,
        `SFP+${i + 1}`,
        'sfp',
        `S${i + 1}`,
      );
    }
  } else if (device.kind === 'ap-ceiling') {
    width = height = 60;
    ellipse(0, 0, 60, 60, 'white');
    ellipse(3, 3, 54, 54, null, 2);
    ellipse(12, 9, 36, 36, null, 2);
    text(21, 24, 'Wi-Fi', 3);
    text(19, 28, 'ACCESS POINT');
    rect(15, 37, 30, 16, 'metal', 2);
    for (let i = 0; i < device.copper; i++)
      socket(
        device.copper === 1 ? 30 : 24 + i * 12,
        46,
        copperName(i),
        'rj45',
        i === 0 ? 'PoE' : 'LAN2',
      );
    led(30, 6, 'blue');
    text(23, 56, 'UNDERSIDE');
  } else if (['ap-wall', 'ap-desktop', 'mesh'].includes(device.kind)) {
    width = device.kind === 'ap-wall' ? 64 : 40;
    height = 60;
    rect(0, 0, width, height, 'white');
    rect(2, 2, width - 4, height - 4, null, 2);
    text(8, 19, title, 2);
    text(9, 25, 'Wi-Fi', 3);
    led(width / 2, 8, 'blue');
    if (device.kind === 'ap-wall') {
      socket(32, 38, 'PoE IN', 'rj45', 'UPLINK');
      for (let i = 1; i < 5; i++)
        socket(14 + (i - 1) * 12, 52, copperName(i), 'rj45', i);
    } else {
      rect(6, 39, 28, 16, 'metal', 2);
      for (let i = 0; i < 2; i++)
        socket(
          14 + i * 12,
          48,
          copperName(i),
          'rj45',
          i === 0 && device.poe ? 'PoE' : `LAN${i + 1}`,
        );
    }
  } else {
    const rows = device.copper > 16 ? 2 : 1;
    width = Math.max(
      72,
      24 + Math.ceil(device.copper / rows) * 10 + (device.sfp || 0) * 12,
    );
    height = device.kind === 'wifi-router' ? 44 : rows === 2 ? 36 : 26;
    const panelY = height - 10;
    rect(0, 0, width, height, 'white');
    rect(0, panelY - 4 - (rows - 1) * 10, width, 14 + (rows - 1) * 10, 'metal');
    text(5, 6, title, 3);
    for (let i = 0; i < 8; i++)
      line(width - 23 + i * 2, 3, width - 23 + i * 2, 7);
    led(5, 11);
    text(7, 11.7, 'PWR');
    if (device.kind === 'wifi-router') {
      for (const x of [6, width - 8]) {
        rect(x, -14, 2, 19, 'dark');
        ellipse(x, -15, 2, 2, 'dark');
      }
      text(5, 20, 'REAR PANEL', 1);
    }
    for (let i = 0; i < device.copper; i++)
      socket(
        14 + Math.floor(i / rows) * 10,
        panelY + 2 - (rows - 1) * 10 + (i % rows) * 10,
        copperName(i),
        'rj45',
        device.kind === 'switch' ? i + 1 : copperName(i),
      );
    for (let i = 0; i < (device.sfp || 0); i++)
      socket(
        20 + device.copper * 10 + i * 12,
        panelY + 2,
        `SFP+${i + 1}`,
        'sfp',
        `S${i + 1}`,
      );
    if (device.fibre) socket(48, panelY + 2, 'FIBRE', 'fibre', 'FIBRE');
  }
  return {
    device,
    width,
    height,
    ports,
    xml: '<TinyCAD>\n' + [...resources(), ...art].join('\n') + '\n</TinyCAD>\n',
  };
}

export function networkArtwork(recipe) {
  const records = recipe.devices.map(networkSymbol);
  const description = (record) =>
    `${record.device.name}. ${
      record.device.rack
        ? 'Matching 19-inch 1U face; stack at 24 XML units (120 drawing units). '
        : record.device.kind.startsWith('ap-')
        ? 'Socket panel shown for cable planning. '
        : ''
    }One cable connection per socket, centred on the opening. Generic layout symbol; no SPICE model.`;
  const provenance = {
    version: 1,
    id: recipe.id,
    name: recipe.name,
    artwork: 'Original generic physical network device artwork',
    convention: recipe.notes,
    references: recipe.references,
    sourceReview: recipe.sourceReview,
    survey: recipe.survey,
    rack: { ...rackSize, anchor: 'native bottom-right', internalScale: 5 },
    entries: records.map((record) => ({
      id: record.device.id,
      name: record.device.name,
      xmlSha256: createHash('sha256').update(record.xml).digest('hex'),
      rack: !!record.device.rack,
      ports: record.ports,
    })),
  };
  const library = {
    name: recipe.name,
    names: records.map((record, i) => ({
      NameID: i + 1,
      SymbolID: i + 1,
      Type: 0,
      Name: record.device.name,
      Reference:
        ({
          switch: 'SW',
          aggregation: 'SW',
          patch: 'PP',
          router: 'RTR',
          'wifi-router': 'RTR',
          firewall: 'FW',
          blank: 'RK',
          controller: 'WC',
          ont: 'ONT',
          injector: 'POE',
        }[record.device.kind] || 'AP') + '?',
      ppp: 1,
      ShowName: 1,
      ShowRef: 1,
      DefRotate: 0,
      Description: description(record),
      Attributes: [
        {
          AttName: 'Layout',
          AttValue: record.device.rack
            ? '19-inch rack / 1U'
            : 'Consumer / desktop / wall',
          ShowAtt: 1,
        },
        {
          AttName: 'Ports',
          AttValue: record.ports.map((p) => p.name).join(', '),
          ShowAtt: 1,
        },
      ],
    })),
    symbols: records.map((record, i) => ({
      SymbolId: i + 1,
      Data: record.xml,
    })),
  };
  return { recipe, records, provenance, library };
}
