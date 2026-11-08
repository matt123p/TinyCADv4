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
function controlPins(config: SpiceControl, scale = COMPACT_SCALE): dsnPin[] {
  const pin = (
    number: string,
    name: string,
    point: [number, number],
    rotation: number,
  ): dsnPin =>
    new updatePin({
      ...font,
      NodeName: DocItemTypes.Pin,
      _id: get_global_id(),
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
    const scope = config.type === 'scope',
      left = scope ? -140 : -40;
    const body = [
      line([
        [left, 40],
        [40, 40],
        [40, 120],
        [left, 120],
        [left, 40],
      ]),
      line([
        [left + 8, 50],
        [30, 50],
        [30, 100],
        [left + 8, 100],
        [left + 8, 50],
      ]),
    ];
    if (config.type === 'scope' || config.type === 'generator')
      body.push(
        line(
          waveformGlyph(
            config.type === 'generator'
              ? config.source
              : { ...defaultSource(), waveform: 'sine' },
            75,
            15,
          ).map(([x, y]) => [scope ? x - 45 : x, y]),
        ),
      );
    else if (config.type === 'supply')
      body.push(
        line([
          [-20, 66],
          [20, 66],
        ]),
        line([
          [-10, 79],
          [10, 79],
        ]),
        line([
          [0, 55],
          [0, 75],
        ]),
      );
    else
      body.push(
        line(
          config.mode.endsWith('A')
            ? [
                [-18, 90],
                [0, 60],
                [18, 90],
                [10, 77],
                [-10, 77],
              ]
            : config.mode === 'ohm'
            ? [
                [-22, 90],
                [-12, 90],
                [-12, 80],
                [-18, 72],
                [-12, 60],
                [12, 60],
                [18, 72],
                [12, 80],
                [12, 90],
                [22, 90],
              ]
            : [
                [-18, 60],
                [0, 90],
                [18, 60],
              ],
        ),
      );
    body.push({
      ...stroke,
      stroked: false,
      NodeName: DocItemTypes.Rectangle,
      _id: nextId(),
      point: [left * scale, 0],
      point_b: [40 * scale, 160 * scale],
    });
    return body;
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

// Refresh older saved source artwork for display without editing the drawing.
export function sourceDrawingItems(symbol: dsnSymbol): DocItem[] | undefined {
  const config = readControl(symbol);
  if (
    config?.kind !== 'source' ||
    !symbol._symbol.uid?.startsWith('tinycad-spice-')
  )
    return;
  const scale = symbol._symbol.uid.endsWith('-v1') ? 1 : COMPACT_SCALE;
  let id = 0;
  return [
    ...controlBody(config, scale, () => --id),
    ...symbol._symbol.outlines[0].items.filter(
      (item) => item.NodeName === DocItemTypes.Pin,
    ),
  ];
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
    const pins = controlPins(config, scale);
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
          scale === 1 ? 'v1' : 'v2'
        }`,
        outlines: [
          {
            ...outline,
            ref_point: [40 * scale, 160 * scale],
            size: [
              (config.kind === 'controlled' ||
              (config.kind === 'instrument' && config.type === 'scope')
                ? 180
                : 80) * scale,
              160 * scale,
            ],
            items: [...controlBody(config, scale), ...pins],
            active_points: pins.map((pin) => ({
              pos: [pin.point[0] - 40 * scale, pin.point[1] - 160 * scale],
              power: false,
              part: 0,
              pin,
            })),
          },
        ],
      },
    }).post_construction();
  }
  return result;
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
  const pins = controlPins(config);
  const body = controlBody(config);
  const id = Math.max(0, ...Object.keys(sheet.symbols).map(Number)) + 1;
  const definition: libSymbol = {
    id,
    uid: `tinycad-spice-${controlled ? 'controlled' : config.kind}-v2`,
    name: { value: 'SPICE control', type: 0 },
    ref: { value: controlPrefix(config) + '?', type: 0 },
    description: 'Embedded SPICE control',
    parts: 1,
    heterogeneous: false,
    outlines: [
      {
        items: [...body, ...pins],
        ref_point: [40 * scale, 160 * scale],
        size: [(controlled ? 180 : 80) * scale, 160 * scale],
        active_points: pins.map((pin) => ({
          pos: [pin.point[0] - 40, pin.point[1] - 160],
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
    scale_x: 1,
    scale_y: 1,
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
        [4, -24],
      ),
      field('Name', '', [4, -12]),
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
