import { DocItem, DocItemTypes, dsnPin, dsnSymbol } from '../model/dsnItem';
import { dsnDrawing, dsnSheet, libSymbol } from '../model/dsnDrawing';
import { TextDisplayMethod } from '../model/tclib';
import { get_global_id } from '../util/global_id';
import { updateSymbol } from '../manipulators/updateSymbol';
import { updatePin } from '../manipulators/updatePin';
import { updateWire } from '../manipulators/updateWire';
import {
  defaultInstrument,
  instrumentNames,
  InstrumentConfig,
  InstrumentType,
} from './instruments';
import {
  CONTROL_ATTRIBUTE,
  SpiceControl,
  controlTemplate,
  defaultSource,
  readControl,
  SourceConfig,
} from './controls';

import {
  instrumentArtwork,
  instrumentArtworkKey,
  instrumentPins,
  instrumentLayouts,
  legacyInstrumentArtwork,
  STUDENT_DEVICE_SCALE,
} from './instrumentSymbols';

export type ControlTool =
  | InstrumentType
  | 'source'
  | 'probe'
  | 'current-probe'
  | 'differential-probe'
  | 'controlled';
const font = {
  font_name: 'Arial',
  font_size: 10,
  font_colour: '#000000',
  font_bold: false,
  font_italic: false,
};
const stroke = {
  stroked: true,
  line_colour: '#0078d4',
  line_width: 1,
  line_pattern: 0,
  filled: false,
  fill_colour: '#ffffff',
  hatch: 0,
  rounded_rect: false,
};
const COMPACT_SCALE = 0.25;
function controlPins(
  config: SpiceControl,
  scale = COMPACT_SCALE,
  nextId = get_global_id,
): dsnPin[] {
  const pin = (
    number: string,
    name: string,
    point: [number, number],
    rotation: number,
  ): dsnPin =>
    new updatePin({
      ...font,
      NodeName: DocItemTypes.Pin,
      _id: nextId(),
      point: [point[0] * scale, point[1] * scale],
      font_size: scale === 1 ? 10 : 8,
      number,
      name,
      rotation,
      length: 40 * scale,
      number_pos: 0,
      centre_name: false,
      which: 0,
      elec: 4,
      show_name:
        config.kind === 'instrument' ||
        Number(number) > 2 ||
        (config.kind === 'probe' && config.mode !== 'voltage'),
      show_number: false,
      part: 0,
      textData: null,
    }).post_construction();
  return [
    pin(
      '1',
      config.kind === 'instrument' && config.type === 'scope' ? 'A+' : '+',
      [0, 0],
      1,
    ),
    ...(config.kind === 'probe' && config.mode === 'voltage'
      ? []
      : [
          pin(
            '2',
            config.kind === 'instrument' && config.type === 'scope'
              ? 'A−'
              : '−',
            [0, 160],
            3,
          ),
        ]),
    ...(config.kind === 'instrument' && config.type === 'scope'
      ? [pin('3', 'B+', [-140, 0], 1), pin('4', 'B−', [-140, 160], 3)]
      : []),
    ...(config.kind === 'controlled'
      ? [pin('3', 'C+', [-140, 40], 0), pin('4', 'C−', [-140, 120], 0)]
      : []),
  ];
}
function waveformGlyph(
  config: SourceConfig,
  center: number,
  amplitude: number,
): [number, number][] {
  const points = (values: [number, number][]): [number, number][] =>
    values.map(([x, y]) => [x, center + y * amplitude]);
  switch (config.waveform) {
    case 'pulse':
      return points([
        [-24, 1],
        [-14, 1],
        [-14, -1],
        [9, -1],
        [9, 1],
        [24, 1],
      ]);
    case 'triangle':
      return points([
        [-24, 1],
        [-12, -1],
        [0, 1],
        [12, -1],
        [24, 1],
      ]);
    case 'pwl':
      return points([
        [-24, 1],
        [-12, 1],
        [-4, -1],
        [8, -0.3],
        [16, -0.3],
        [24, -1],
      ]);
    case 'exponential':
      return Array.from({ length: 33 }, (_, i) => {
        const t = i / 32;
        const rise =
          (1 - Math.exp(-4 * (t < 0.5 ? t * 2 : (t - 0.5) * 2))) /
          (1 - Math.exp(-4));
        return [
          -24 + t * 48,
          center + amplitude * (t < 0.5 ? 1 - 2 * rise : -1 + 2 * rise),
        ];
      });
    case 'fm':
      return Array.from({ length: 65 }, (_, i) => {
        const t = i / 64;
        return [
          -24 + t * 48,
          center - amplitude * Math.sin(2 * Math.PI * (1.5 * t + 1.5 * t * t)),
        ];
      });
    default:
      return Array.from({ length: 33 }, (_, i) => [
        -24 + i * 1.5,
        center - amplitude * Math.sin((i * Math.PI) / 16),
      ]);
  }
}

function controlBody(
  config: SpiceControl,
  scale = COMPACT_SCALE,
  nextId = get_global_id,
): DocItem[] {
  const line = (points: [number, number][]): DocItem => ({
    ...stroke,
    NodeName: DocItemTypes.Line,
    _id: nextId(),
    d_points: points.map((p) => [p[0] * scale, p[1] * scale]),
    polygon: false,
  });
  const controlled = config.kind === 'controlled';
  if (config.kind === 'instrument') {
    return [
      ...legacyInstrumentArtwork(
        config,
        scale,
        nextId,
        waveformGlyph(config.source, 0, 1),
        controlPins(config, scale, nextId),
      ),
      {
        ...stroke,
        stroked: false,
        NodeName: DocItemTypes.Rectangle,
        _id: nextId(),
        point: [(config.type === 'scope' ? -140 : -40) * scale, 0],
        point_b: [40 * scale, 160 * scale],
      },
    ];
  }
  const body: DocItem[] = controlled
    ? [
        line([
          [0, 40],
          [40, 80],
          [0, 120],
          [-40, 80],
          [0, 40],
        ]),
        line([
          [-100, 40],
          [-40, 40],
          [-40, 65],
        ]),
        line([
          [-100, 120],
          [-40, 120],
          [-40, 95],
        ]),
      ]
    : [
        {
          ...stroke,
          NodeName: DocItemTypes.Ellipse,
          _id: nextId(),
          point: [-40 * scale, 40 * scale],
          point_b: [40 * scale, 120 * scale],
        },
      ];
  // TinyCAD anchors symbol outlines at their bottom-right bounding corner.
  // Keep a stable box when a ground-referenced probe has only one terminal.
  body.push({
    ...stroke,
    stroked: false,
    NodeName: DocItemTypes.Rectangle,
    _id: nextId(),
    point: [(controlled ? -140 : -40) * scale, 0],
    point_b: [40 * scale, 160 * scale],
  });
  if (config.kind === 'probe') {
    body.push(
      ...(config.mode === 'current'
        ? [
            line([
              [-15, 98],
              [0, 62],
              [15, 98],
            ]),
            line([
              [-8, 83],
              [8, 83],
            ]),
          ]
        : [
            line([
              [-16, 64],
              [0, 98],
              [16, 64],
            ]),
          ]),
    );
  } else if (config.kind === 'source' && config.waveform !== 'dc') {
    const current = config.type === 'current';
    body.push(
      line(waveformGlyph(config, current ? 70 : 80, current ? 10 : 16)),
    );
    if (current)
      body.push(
        line([
          [0, 92],
          [0, 110],
        ]),
        line([
          [-7, 102],
          [0, 110],
          [7, 102],
        ]),
      );
  } else if (config.type === 'current') {
    body.push(
      line([
        [0, 58],
        [0, 102],
      ]),
      line([
        [-9, 90],
        [0, 102],
        [9, 90],
      ]),
    );
  } else {
    body.push(
      line([
        [-12, 65],
        [12, 65],
      ]),
      line([
        [0, 53],
        [0, 77],
      ]),
      line([
        [-12, 98],
        [12, 98],
      ]),
    );
  }
  return body;
}

// Refresh generated instrument/source artwork without moving saved electrical anchors.
function nativeInstrumentBody(
  config: InstrumentConfig,
  pins: dsnPin[],
  textScale: number,
  nextId: () => number,
): DocItem[] {
  const layout = instrumentLayouts[config.type];
  return [
    ...instrumentArtwork(
      config,
      nextId,
      waveformGlyph(config.source, 0, 1),
      textScale,
    ),
    // Saved circuits retain their electrical anchors. Coloured probe leads join
    // those anchors to the full-sized device's front-panel sockets.
    ...pins.flatMap((pin): DocItem[] => {
      const port = layout.ports.find((p) => p.number === pin.number);
      if (
        !port ||
        pin.point.every((n, i) => Math.abs(n - port.point[i]) < 1e-6)
      )
        return [];
      return [
        {
          ...stroke,
          NodeName: DocItemTypes.Line,
          _id: nextId(),
          d_points: [
            pin.point,
            [pin.point[0], layout.size[1] + 8],
            [port.point[0], layout.size[1] + 8],
            port.point,
          ],
          polygon: false,
          line_colour: port.color,
          filled: false,
        },
      ];
    }),
  ];
}

export function controlDrawingItems(symbol: dsnSymbol): DocItem[] | undefined {
  const config = readControl(symbol);
  if (
    (config?.kind !== 'source' && config?.kind !== 'instrument') ||
    !symbol._symbol.uid?.startsWith('tinycad-spice-')
  )
    return;
  const scale = symbol._symbol.uid.endsWith('-v1') ? 1 : COMPACT_SCALE;
  let id = 0;
  return [
    ...(config.kind === 'instrument' && /-v[34]$/.test(symbol._symbol.uid)
      ? nativeInstrumentBody(
          config,
          symbol._symbol.outlines[0].items.filter(
            (item): item is dsnPin => item.NodeName === DocItemTypes.Pin,
          ),
          Math.min(Math.abs(symbol.scale_x), Math.abs(symbol.scale_y)),
          () => --id,
        )
      : controlBody(config, scale, () => --id)),
    ...symbol._symbol.outlines[0].items.filter(
      (item) => item.NodeName === DocItemTypes.Pin,
    ),
  ];
}

/** Upgrade stored footprints, rather than just changing the placement default.
 * Probe ends stay on their original nets; resizing never adds electrical wires.
 */
export function resizeStudentInstrument(symbol: dsnSymbol): dsnSymbol {
  const config = readControl(symbol);
  if (
    config?.kind !== 'instrument' ||
    !symbol._symbol.uid?.startsWith('tinycad-spice-')
  )
    return symbol;
  const needsMeterInput =
    config.type === 'meter' &&
    !symbol._symbol.outlines[0].active_points.some((p) => p.pin.number === '3');
  if (
    /-v[34]$/.test(symbol._symbol.uid) &&
    symbol.scale_x === STUDENT_DEVICE_SCALE &&
    symbol.scale_y === STUDENT_DEVICE_SCALE &&
    !needsMeterInput
  )
    return symbol;
  const original = new updateSymbol(symbol).active_points();
  const extent = instrumentLayouts[config.type].size;
  const pins = symbol._symbol.outlines[0].active_points.map((active) =>
    new updatePin({
      ...active.pin,
      ...(needsMeterInput &&
      config.mode.endsWith('A') &&
      active.pin.number === '1'
        ? { number: '3', name: 'A' }
        : {}),
      point: [
        (active.pos[0] * symbol.scale_x) / STUDENT_DEVICE_SCALE + extent[0],
        (active.pos[1] * symbol.scale_y) / STUDENT_DEVICE_SCALE + extent[1],
      ],
      length: 0,
      show_name: false,
      show_number: false,
    }).post_construction(),
  );
  if (needsMeterInput) {
    if (config.mode.endsWith('A')) {
      const current = pins.find((pin) => pin.number === '3');
      const socket = instrumentLayouts.meter.ports.find(
        (port) => port.number === '3',
      );
      // Align the old current lead with the A socket before adding V/Ω. This
      // keeps the new voltage jack separate from the retained current anchor.
      const delta = socket.point.map(
        (value, axis) => value - current.point[axis],
      );
      for (let i = 0; i < pins.length; i++)
        pins[i] = new updatePin({
          ...pins[i],
          point: [pins[i].point[0] + delta[0], pins[i].point[1] + delta[1]],
        }).post_construction();
    }
    pins.push(
      ...instrumentPins(config, get_global_id).filter(
        (pin) => !pins.some((old) => old.number === pin.number),
      ),
    );
  }
  let result = new updateSymbol({
    ...symbol,
    scale_x: STUDENT_DEVICE_SCALE,
    scale_y: STUDENT_DEVICE_SCALE,
    _active_points: null,
    hints:
      needsMeterInput && config.mode.endsWith('A')
        ? symbol.hints.map((hint) =>
            hint.pin === '1' ? { ...hint, pin: '3' } : hint,
          )
        : symbol.hints,
    _symbol: {
      ...symbol._symbol,
      uid: `tinycad-spice-instrument-${config.type}-${instrumentArtworkKey(
        config,
      )}-${pins.map((p) => p.point.join(',')).join(';')}-v4`,
      outlines: [
        {
          ref_point: extent,
          size: extent,
          items: [
            ...nativeInstrumentBody(
              config,
              pins,
              STUDENT_DEVICE_SCALE,
              get_global_id,
            ),
            ...pins,
          ],
          active_points: pins.map((pin) => ({
            pos: [pin.point[0] - extent[0], pin.point[1] - extent[1]],
            pin,
            part: 0,
            power: false,
          })),
        },
      ],
    },
    text: symbol.text.map((field) =>
      field.description === 'Name' ? { ...field, show: false } : field,
    ),
  }).post_construction();
  if (needsMeterInput) {
    let template: string;
    try {
      template = controlTemplate(config);
    } catch {
      template = '* Invalid instrument settings';
    }
    result = new updateSymbol(result).setSpiceProperty('$$SPICE', template);
  }
  const moved = new updateSymbol(result).active_points();
  if (original.length && moved.length)
    result = new updateSymbol({
      ...result,
      _active_points: null,
      point: [
        result.point[0] + original[0][0] - moved[0][0],
        result.point[1] + original[0][1] - moved[0][1],
      ],
    }).post_construction();
  const bounds = new updateSymbol(result).getBoundingRect();
  return new updateSymbol({
    ...result,
    text: result.text.map((field) =>
      field.description === 'Ref'
        ? {
            ...field,
            position: [
              bounds.x1 - result.point[0] + 5,
              bounds.y1 - result.point[1] - 12,
            ],
          }
        : field,
    ),
  }).post_construction();
}

export function resizeStudentInstruments(drawing: dsnDrawing): dsnDrawing {
  return {
    ...drawing,
    sheets: drawing.sheets.map((sheet) => {
      let nextId = Math.max(0, ...Object.keys(sheet.symbols).map(Number)) + 1;
      const symbols = { ...sheet.symbols };
      const items = sheet.items.map((item) => {
        if (item.NodeName !== DocItemTypes.Symbol) return item;
        const resized = resizeStudentInstrument(item);
        if (resized === item) return item;
        const definition = { ...resized._symbol, id: nextId++ };
        symbols[definition.id] = definition;
        return { ...resized, _symbol: definition };
      });
      return { ...sheet, items, symbols };
    }),
  };
}
export function controlPrefix(config: SpiceControl) {
  return config.kind === 'instrument'
    ? { scope: 'OSC', meter: 'DMM', generator: 'GEN', supply: 'PSU' }[
        config.type
      ]
    : config.kind === 'source'
    ? config.type === 'voltage'
      ? 'V'
      : 'I'
    : config.kind === 'controlled'
    ? config.type === 'voltage'
      ? 'E'
      : 'G'
    : config.mode === 'current'
    ? 'VP'
    : 'PR';
}
export function nextControlReference(
  drawing: dsnDrawing,
  prefix: string,
  ignore?: dsnSymbol,
) {
  const refs = new Set(
    drawing.sheets.flatMap((s) =>
      s.items
        .filter((i) => i.NodeName === DocItemTypes.Symbol && i !== ignore)
        .flatMap((i) =>
          (i as dsnSymbol).text
            .filter((f) => f.description === 'Ref')
            .map((f) => f.value.toLowerCase()),
        ),
    ),
  );
  let i = 1;
  while (refs.has(`${prefix}${i}`.toLowerCase())) i++;
  return `${prefix}${i}`;
}
export function updateControl(
  symbol: dsnSymbol,
  config: SpiceControl,
  drawing: dsnDrawing,
  forceCompact = false,
) {
  symbol = resizeStudentInstrument(symbol);
  let template: string;
  try {
    template = controlTemplate(config);
  } catch {
    template = '* Invalid source settings';
  }
  let result = new updateSymbol(symbol).setSpiceProperty(
    CONTROL_ATTRIBUTE,
    JSON.stringify(config),
  );
  result = new updateSymbol(result).setSpiceProperty('$$SPICE', template);
  const prefix = controlPrefix(config),
    ref = result.text.find((f) => f.description === 'Ref');
  const previous = readControl(symbol);
  if (ref && previous && controlPrefix(previous) !== prefix) {
    result = new updateSymbol(result).showValue(
      result.text.indexOf(ref),
      nextControlReference(drawing, prefix, symbol),
    );
  }
  const name =
    config.kind === 'instrument'
      ? instrumentNames[config.type]
      : config.kind === 'probe'
      ? config.mode === 'current'
        ? 'I'
        : config.mode === 'differential'
        ? 'ΔV'
        : 'V'
      : config.kind === 'controlled'
      ? config.type === 'voltage'
        ? 'VCVS'
        : 'VCCS'
      : config.waveform === 'dc'
      ? config.dc.trim().endsWith(config.type === 'voltage' ? 'V' : 'A')
        ? config.dc
        : config.dc + (config.type === 'voltage' ? 'V' : 'A')
      : {
          sine: 'SIN',
          pulse: 'PULSE',
          triangle: 'TRI',
          pwl: 'PWL',
          exponential: 'EXP',
          fm: 'FM',
        }[config.waveform] || 'Source';
  const nameIndex = result.text.findIndex((f) => f.description === 'Name');
  if (nameIndex >= 0)
    result = new updateSymbol(result).showValue(nameIndex, name);
  if (result._symbol.uid.startsWith('tinycad-spice-')) {
    const outline = result._symbol.outlines[0];
    const scale =
      !forceCompact && result._symbol.uid.endsWith('-v1') ? 1 : COMPACT_SCALE;
    const migrated =
      config.kind === 'instrument' && result._symbol.uid.endsWith('-v4');
    const native =
      config.kind === 'instrument' && /-v[34]$/.test(result._symbol.uid);
    const pins = migrated
      ? outline.items.filter(
          (item): item is dsnPin => item.NodeName === DocItemTypes.Pin,
        )
      : native
      ? instrumentPins(config, get_global_id)
      : controlPins(config, scale);
    const extent = native ? instrumentLayouts[config.type].size : undefined;
    const variant =
      config.kind === 'probe'
        ? config.mode
        : config.kind === 'instrument'
        ? `${config.type}-${
            config.type === 'generator'
              ? config.source.waveform
              : config.type === 'meter'
              ? config.mode
              : 'default'
          }`
        : config.kind === 'source'
        ? `${config.type}-${config.waveform}`
        : config.type;
    result = new updateSymbol({
      ...result,
      _active_points: null,
      _symbol: {
        ...result._symbol,
        uid: `tinycad-spice-${config.kind}-${variant}-${
          native
            ? `${instrumentArtworkKey(config)}-${result.scale_x}x${
                result.scale_y
              }-${
                migrated
                  ? pins.map((p) => p.point.join(',')).join(';') + '-v4'
                  : 'v3'
              }`
            : scale === 1
            ? 'v1'
            : 'v2'
        }`,
        outlines: [
          {
            ...outline,
            ref_point: extent || [40 * scale, 160 * scale],
            size: extent || [
              (config.kind === 'controlled' ||
              (config.kind === 'instrument' && config.type === 'scope')
                ? 180
                : 80) * scale,
              160 * scale,
            ],
            items: [
              ...(native
                ? nativeInstrumentBody(
                    config,
                    pins,
                    Math.min(
                      Math.abs(result.scale_x),
                      Math.abs(result.scale_y),
                    ),
                    get_global_id,
                  )
                : controlBody(config, scale)),
              ...pins,
            ],
            active_points: pins.map((pin) => ({
              pos: [
                pin.point[0] - (extent?.[0] ?? 40 * scale),
                pin.point[1] - (extent?.[1] ?? 160 * scale),
              ],
              power: false,
              part: 0,
              pin,
            })),
          },
        ],
      },
    }).post_construction();
  }
  return config.kind === 'instrument'
    ? resizeStudentInstrument(result)
    : result;
}
export function createControl(
  tool: ControlTool,
  sheet: dsnSheet,
  drawing: dsnDrawing,
) {
  const config: SpiceControl = [
    'scope',
    'meter',
    'generator',
    'supply',
  ].includes(tool)
    ? defaultInstrument(tool as InstrumentType)
    : tool === 'source'
    ? defaultSource()
    : tool === 'controlled'
    ? { kind: 'controlled', type: 'voltage', gain: '1' }
    : {
        kind: 'probe',
        mode:
          tool === 'current-probe'
            ? 'current'
            : tool === 'differential-probe'
            ? 'differential'
            : 'voltage',
        invert: false,
      };
  const controlled =
    config.kind === 'controlled' ||
    (config.kind === 'instrument' && config.type === 'scope');
  const scale = COMPACT_SCALE;
  const native = config.kind === 'instrument';
  const extent: [number, number] = native
    ? instrumentLayouts[config.type].size
    : [40 * scale, 160 * scale];
  const pins = native
    ? instrumentPins(config, get_global_id)
    : controlPins(config);
  const body = native
    ? instrumentArtwork(
        config,
        get_global_id,
        waveformGlyph(config.source, 0, 1),
        STUDENT_DEVICE_SCALE,
      )
    : controlBody(config);
  const id = Math.max(0, ...Object.keys(sheet.symbols).map(Number)) + 1;
  const definition: libSymbol = {
    id,
    uid: native
      ? `tinycad-spice-instrument-${config.type}-v3`
      : `tinycad-spice-${controlled ? 'controlled' : config.kind}-v2`,
    name: { value: 'SPICE control', type: 0 },
    ref: { value: controlPrefix(config) + '?', type: 0 },
    description: 'Embedded SPICE control',
    parts: 1,
    heterogeneous: false,
    outlines: [
      {
        items: [...body, ...pins],
        ref_point: extent,
        size: native ? extent : [(controlled ? 180 : 80) * scale, 160 * scale],
        active_points: pins.map((pin) => ({
          pos: [pin.point[0] - extent[0], pin.point[1] - extent[1]],
          power: false,
          part: 0,
          pin,
        })),
      },
    ],
  };
  const field = (
    description: string,
    value: string,
    position: [number, number],
  ) => ({
    description,
    value,
    position,
    show: true,
    display: TextDisplayMethod.ShowValue,
  });
  let symbol: dsnSymbol = {
    ...font,
    NodeName: DocItemTypes.Symbol,
    _id: get_global_id(),
    point: [0, 0],
    show_power: false,
    allow_resize: false,
    scale_x: native ? STUDENT_DEVICE_SCALE : 1,
    scale_y: native ? STUDENT_DEVICE_SCALE : 1,
    rotation: 0,
    part: 0,
    _symbol: definition,
    _active_points: null,
    textData: [],
    hints: [],
    text: [
      field(
        'Ref',
        nextControlReference(drawing, controlPrefix(config)),
        native ? [-extent[0] + 4, -extent[1] - 12] : [4, -24],
      ),
      { ...field('Name', '', [4, -12]), show: !native },
    ],
  };
  symbol = updateControl(symbol, config, drawing);
  return {
    symbol,
    sheet: { ...sheet, symbols: { ...sheet.symbols, [id]: symbol._symbol } },
  };
}

/** Resize an older control while retaining its existing electrical connections. */
export function compactControl(
  symbol: dsnSymbol,
  sheet: dsnSheet,
  drawing: dsnDrawing,
) {
  const config = readControl(symbol);
  if (!config) return { symbol, bridges: [] as DocItem[] };
  const oldPins = new updateSymbol(symbol).active_points();
  let compact = updateControl(symbol, config, drawing, true);
  const before = oldPins.find((p) => p[2].number === '1');
  const after = new updateSymbol(compact)
    .active_points()
    .find((p) => p[2].number === '1');
  compact = new updateSymbol({
    ...compact,
    _active_points: null,
    point: [
      compact.point[0] + before[0] - after[0],
      compact.point[1] + before[1] - after[1],
    ],
  }).post_construction();
  const bounds = new updateSymbol(compact).getBoundingRect();
  compact = new updateSymbol({
    ...compact,
    text: compact.text.map((field) => ({
      ...field,
      position:
        field.description === 'Ref' || field.description === 'Name'
          ? [
              bounds.x2 + 5 - compact.point[0],
              (bounds.y1 + bounds.y2) / 2 +
                (field.description === 'Ref' ? -6 : 6) -
                compact.point[1],
            ]
          : field.position,
    })),
  }).post_construction();
  const newPins = new updateSymbol(compact).active_points();
  const bridges: DocItem[] = [];
  for (const old of oldPins) {
    const next = newPins.find((p) => p[2].number === old[2].number);
    if (
      !next ||
      (Math.abs(next[0] - old[0]) < 1e-6 && Math.abs(next[1] - old[1]) < 1e-6)
    )
      continue;
    const connected = sheet.items.some((item) => {
      if (item === symbol) return false;
      if (item.NodeName === DocItemTypes.Wire)
        return (
          new updateWire(item).distanceFromPoint(
            [old[0], old[1]],
            [old[0], old[1]],
          ).distance < 1
        );
      if (item.NodeName === DocItemTypes.Symbol)
        return new updateSymbol(item)
          .active_points()
          .some(
            (p) =>
              Math.abs(p[0] - old[0]) < 1e-6 && Math.abs(p[1] - old[1]) < 1e-6,
          );
      return (
        (item.NodeName === DocItemTypes.Power ||
          item.NodeName === DocItemTypes.Label) &&
        Math.abs(item.point[0] - old[0]) < 1e-6 &&
        Math.abs(item.point[1] - old[1]) < 1e-6
      );
    });
    if (connected)
      bridges.push({
        NodeName: DocItemTypes.Wire,
        _id: get_global_id(),
        _magnetic: null,
        d_points: [
          [next[0], next[1]],
          [old[0], old[1]],
        ],
      });
  }
  return { symbol: compact, bridges };
}
