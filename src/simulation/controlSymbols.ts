import { DocItem, DocItemTypes, dsnPin, dsnSymbol } from '../model/dsnItem';
import { dsnDrawing, dsnSheet, libSymbol } from '../model/dsnDrawing';
import { TextDisplayMethod } from '../model/tclib';
import { get_global_id } from '../util/global_id';
import { updateSymbol } from '../manipulators/updateSymbol';
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
function controlPins(config: SpiceControl): dsnPin[] {
  const pin = (
    number: string,
    name: string,
    point: [number, number],
    rotation: number,
  ): dsnPin => ({
    ...font,
    NodeName: DocItemTypes.Pin,
    _id: get_global_id(),
    point,
    number,
    name,
    rotation,
    length: 40,
    number_pos: 0,
    centre_name: false,
    which: 0,
    elec: 4,
    show_name: true,
    show_number: false,
    part: 0,
    textData: null,
  });
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
function controlBody(config: SpiceControl): DocItem[] {
  const line = (points: [number, number][]): DocItem => ({
    ...stroke,
    NodeName: DocItemTypes.Line,
    _id: get_global_id(),
    d_points: points,
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
          point: [-40, 40],
          point_b: [40, 120],
        },
      ];
  // TinyCAD anchors symbol outlines at their bottom-right bounding corner.
  // Keep a stable box when a ground-referenced probe has only one terminal.
  body.push({
    ...stroke,
    stroked: false,
    NodeName: DocItemTypes.Rectangle,
    _id: get_global_id(),
    point: [controlled ? -140 : -40, 0],
    point_b: [40, 160],
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
        ? 'Current probe'
        : config.mode === 'differential'
        ? 'Differential probe'
        : 'Voltage probe'
      : config.kind === 'controlled'
      ? config.type === 'voltage'
        ? 'VCVS'
        : 'VCCS'
      : `${config.type === 'voltage' ? 'Voltage' : 'Current'} / ${
          config.waveform
        }`;
  const nameIndex = result.text.findIndex((f) => f.description === 'Name');
  if (nameIndex >= 0)
    result = new updateSymbol(result).showValue(nameIndex, name);
  if (result._symbol.uid.startsWith('tinycad-spice-')) {
    const outline = result._symbol.outlines[0];
    const pins = controlPins(config);
    const variant = config.kind === 'probe' ? config.mode : config.type;
    result = new updateSymbol({
      ...result,
      _active_points: null,
      _symbol: {
        ...result._symbol,
        uid: `tinycad-spice-${config.kind}-${variant}-v1`,
        outlines: [
          {
            ...outline,
            items: [...controlBody(config), ...pins],
            active_points: pins.map((pin) => ({
              pos: [pin.point[0] - 40, pin.point[1] - 160],
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
  const pins = controlPins(config);
  const body = controlBody(config);
  const id = Math.max(0, ...Object.keys(sheet.symbols).map(Number)) + 1;
  const definition: libSymbol = {
    id,
    uid: `tinycad-spice-${controlled ? 'controlled' : config.kind}-v1`,
    name: { value: 'SPICE control', type: 0 },
    ref: { value: controlPrefix(config) + '?', type: 0 },
    description: 'Embedded SPICE control',
    parts: 1,
    heterogeneous: false,
    outlines: [
      {
        items: [...body, ...pins],
        ref_point: [40, 160],
        size: [controlled ? 180 : 80, 160],
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
        [15, -95],
      ),
      field('Name', '', [15, -80]),
    ],
  };
  symbol = updateControl(symbol, config, drawing);
  return {
    symbol,
    sheet: { ...sheet, symbols: { ...sheet.symbols, [id]: symbol._symbol } },
  };
}
