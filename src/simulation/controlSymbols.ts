import { DocItem, DocItemTypes, dsnPin, dsnSymbol } from '../model/dsnItem';
import { dsnDrawing, dsnSheet, libSymbol } from '../model/dsnDrawing';
import { TextDisplayMethod } from '../model/tclib';
import { get_global_id } from '../util/global_id';
import { updateSymbol } from '../manipulators/updateSymbol';
import { updatePin } from '../manipulators/updatePin';
import { updateWire } from '../manipulators/updateWire';
import {
  CONTROL_ATTRIBUTE,
  SpiceControl,
  controlTemplate,
  defaultSource,
  readControl,
} from './controls';

export type ControlTool =
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
        Number(number) > 2 ||
        (config.kind === 'probe' && config.mode !== 'voltage'),
      show_number: false,
      part: 0,
      textData: null,
    }).post_construction();
  return [
    pin('1', '+', [0, 0], 1),
    ...(config.kind === 'probe' && config.mode === 'voltage'
      ? []
      : [pin('2', '−', [0, 160], 3)]),
    ...(config.kind === 'controlled'
      ? [pin('3', 'C+', [-140, 40], 0), pin('4', 'C−', [-140, 120], 0)]
      : []),
  ];
}
function controlBody(config: SpiceControl, scale = COMPACT_SCALE): DocItem[] {
  const line = (points: [number, number][]): DocItem => ({
    ...stroke,
    NodeName: DocItemTypes.Line,
    _id: get_global_id(),
    d_points: points.map((p) => [p[0] * scale, p[1] * scale]),
    polygon: false,
  });
  const controlled = config.kind === 'controlled';
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
          _id: get_global_id(),
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
    _id: get_global_id(),
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
export function controlPrefix(config: SpiceControl) {
  return config.kind === 'source'
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
    config.kind === 'probe'
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
    const variant = config.kind === 'probe' ? config.mode : config.type;
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
              (config.kind === 'controlled' ? 180 : 80) * scale,
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
  const config: SpiceControl =
    tool === 'source'
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
  const controlled = config.kind === 'controlled';
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
