import { DocItem, DocItemTypes, dsnPin, dsnLabel } from '../model/dsnItem';
import { InstrumentConfig, InstrumentType } from './instruments';
import { updatePin } from '../manipulators/updatePin';
import { updateLabel } from '../manipulators/updateLabel';

type Point = [number, number];
export const STUDENT_DEVICE_SCALE = 1.5;
export const instrumentLayouts: Record<
  InstrumentType,
  {
    size: Point;
    ports: { number: string; name: string; point: Point; color: string }[];
  }
> = {
  scope: {
    size: [140, 90],
    ports: [
      { number: '1', name: 'A+', point: [30, 80], color: '#d9a51b' },
      { number: '2', name: 'A−', point: [45, 80], color: '#526171' },
      { number: '3', name: 'B+', point: [75, 80], color: '#1398b5' },
      { number: '4', name: 'B−', point: [90, 80], color: '#526171' },
    ],
  },
  meter: {
    size: [60, 105],
    ports: [
      { number: '1', name: 'V Ω', point: [40, 90], color: '#dc4e53' },
      { number: '2', name: 'COM', point: [20, 90], color: '#344252' },
      { number: '3', name: 'A', point: [10, 90], color: '#e58336' },
    ],
  },
  generator: {
    size: [120, 70],
    ports: [
      { number: '1', name: 'OUT+', point: [90, 60], color: '#dc4e53' },
      { number: '2', name: 'OUT−', point: [105, 60], color: '#344252' },
    ],
  },
  supply: {
    size: [85, 85],
    ports: [
      { number: '1', name: '+', point: [60, 70], color: '#dc4e53' },
      { number: '2', name: '−', point: [40, 70], color: '#344252' },
    ],
  },
};
const font = {
  font_name: 'Arial',
  font_size: 6,
  font_colour: '#304654',
  font_bold: false,
  font_italic: false,
};
const style = {
  stroked: true,
  line_colour: '#61798a',
  line_width: 0.8,
  line_pattern: 0,
  filled: true,
  fill_colour: '#f1f5f6',
  hatch: 0,
  rounded_rect: false,
};

export function instrumentArtworkKey(config: InstrumentConfig): string {
  const visible = JSON.stringify([
    config.type,
    config.type === 'meter' ? config.mode : null,
    config.type === 'generator'
      ? [config.source.waveform, config.source.frequency]
      : null,
    config.type === 'supply'
      ? [config.voltage, config.currentLimit, config.enabled]
      : null,
  ]);
  let hash = 2166136261;
  for (let i = 0; i < visible.length; i++)
    hash = Math.imul(hash ^ visible.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

export function instrumentPins(
  config: InstrumentConfig,
  nextId: () => number,
): dsnPin[] {
  return instrumentLayouts[config.type].ports.map((port) =>
    new updatePin({
      ...font,
      NodeName: DocItemTypes.Pin,
      _id: nextId(),
      point: [...port.point],
      number: port.number,
      name: port.name,
      rotation: 3,
      length: 0,
      number_pos: 0,
      centre_name: false,
      which: 0,
      elec: 4,
      show_name: false,
      show_number: false,
      part: 0,
      textData: null,
    }).post_construction(),
  );
}

/** Native schematic primitives, so the artwork survives save, clipboard and print. */
export function instrumentArtwork(
  config: InstrumentConfig,
  nextId: () => number,
  glyph: Point[],
  textScale = 1,
): DocItem[] {
  const items: DocItem[] = [];
  const rect = (
    x: number,
    y: number,
    w: number,
    h: number,
    fill: string,
    stroke = '#61798a',
    rounded = false,
  ) =>
    items.push({
      ...style,
      NodeName: DocItemTypes.Rectangle,
      _id: nextId(),
      point: [x, y],
      point_b: [x + w, y + h],
      fill_colour: fill,
      line_colour: stroke,
      rounded_rect: rounded,
    });
  const circle = (
    x: number,
    y: number,
    r: number,
    fill: string,
    stroke = '#61798a',
  ) =>
    items.push({
      ...style,
      NodeName: DocItemTypes.Ellipse,
      _id: nextId(),
      point: [x - r, y - r],
      point_b: [x + r, y + r],
      fill_colour: fill,
      line_colour: stroke,
    });
  const line = (points: Point[], color: string, width = 0.7) =>
    items.push({
      ...style,
      NodeName: DocItemTypes.Line,
      _id: nextId(),
      d_points: points,
      line_colour: color,
      line_width: width,
      filled: false,
      polygon: false,
    });
  const text = (
    x: number,
    y: number,
    value: string,
    color = '#304654',
    size = 5,
    bold = false,
  ) =>
    items.push(
      new updateLabel({
        ...font,
        NodeName: DocItemTypes.Label,
        _id: nextId(),
        point: [x, y],
        rotation: 0,
        which: 0,
        text: value,
        textData: null,
        font_colour: color,
        font_size: size * textScale,
        font_bold: bold,
      }).post_construction(),
    );
  const dial = (
    x: number,
    y: number,
    r: number,
    color = '#c9d4db',
    direction: Point = [0.5, -0.6],
  ) => {
    circle(x, y, r, color, '#607587');
    circle(x - 1, y - 1, r * 0.7, '#eef3f5', '#b3c4ce');
    line(
      [
        [x, y],
        [x + r * direction[0], y + r * direction[1]],
      ],
      '#425c70',
      1.1,
    );
  };
  const feet = (w: number, h: number) => {
    rect(8, h - 3, 12, 3, '#718696');
    rect(w - 20, h - 3, 12, 3, '#718696');
  };
  const wave = (
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
    points = glyph,
  ) =>
    line(
      points.map(
        (p) => [x + ((p[0] + 24) * w) / 48, y + ((p[1] + 1) * h) / 2] as Point,
      ),
      color,
      1.1,
    );
  if (config.type === 'scope') {
    rect(0, 0, 140, 90, '#c9e2e4', '#4f7885', true);
    rect(3, 3, 134, 82, '#f4f7f6', '#bed1d5', true);
    text(9, 11, 'OSCILLOSCOPE', '#3d6676', 6, true);
    rect(7, 16, 85, 49, '#102b3a', '#526f7a', true);
    for (let i = 1; i < 10; i++)
      line(
        [
          [7 + i * 8.5, 18],
          [7 + i * 8.5, 63],
        ],
        '#2b4b5a',
        0.35,
      );
    for (let i = 1; i < 8; i++)
      line(
        [
          [9, 16 + (i * 49) / 8],
          [90, 16 + (i * 49) / 8],
        ],
        '#2b4b5a',
        0.35,
      );
    const sine = Array.from(
      { length: 65 },
      (_, i) => [-24 + i * 0.75, Math.sin((i * Math.PI) / 16)] as Point,
    );
    wave(11, 23, 77, 20, '#f4cc4f', sine);
    wave(
      11,
      37,
      77,
      15,
      '#64d6ee',
      sine.map(([x, y]) => [x, -y]),
    );
    text(101, 18, 'TIME', undefined, 4.5);
    dial(114, 29, 8);
    text(100, 43, 'A', '#9d7511', 5, true);
    text(123, 43, 'B', '#117d96', 5, true);
    dial(103, 52, 6);
    dial(126, 52, 6);
    rect(102, 65, 25, 6, '#78b79f', '#5c9683', true);
    text(107, 70, 'RUN', '#173e32', 4, true);
    feet(140, 90);
  } else if (config.type === 'meter') {
    rect(0, 0, 60, 105, '#f0c74c', '#bd9026', true);
    rect(4, 4, 52, 97, '#3a4d59', '#748080', true);
    text(8, 12, 'MULTIMETER', '#f7db81', 5.8, true);
    rect(9, 17, 42, 23, '#d6e8c8', '#8ea48d', true);
    const unit =
      config.mode === 'ohm' ? 'Ω' : config.mode.endsWith('A') ? 'A' : 'V';
    text(15, 32, '− − −', '#42624d', 9, true);
    text(37, 37, unit, '#42624d', 5, true);
    rect(10, 44, 11, 4, '#76bec5', '#76bec5', true);
    rect(25, 44, 11, 4, '#e2c46d', '#e2c46d', true);
    rect(40, 44, 9, 4, '#c1ccd3', '#c1ccd3', true);
    for (let i = 0; i < 9; i++) {
      const a = (-0.85 + i * 0.3) * Math.PI;
      line(
        [
          [30 + 17 * Math.cos(a), 65 + 17 * Math.sin(a)],
          [30 + 19 * Math.cos(a), 65 + 19 * Math.sin(a)],
        ],
        '#d0dbe1',
      );
    }
    dial(
      30,
      64,
      13,
      '#8295a0',
      config.mode === 'ohm'
        ? [0, 0.8]
        : config.mode.endsWith('A')
        ? [0.7, -0.3]
        : [-0.7, -0.3],
    );
    text(12, 65, 'V', '#d0dbe1', 5, true);
    text(43, 65, 'A', '#d0dbe1', 5, true);
    text(
      25,
      81,
      config.mode.startsWith('ac')
        ? 'AC ~'
        : config.mode === 'ohm'
        ? 'Ω'
        : 'DC',
      '#d0dbe1',
      5,
      true,
    );
  } else if (config.type === 'generator') {
    rect(0, 0, 120, 70, '#d6d1ee', '#7c77a3', true);
    rect(3, 3, 114, 62, '#f5f4fa', '#d6d1e4', true);
    text(8, 11, 'SIGNAL GENERATOR', '#685f90', 6, true);
    rect(7, 16, 65, 32, '#15353d', '#547985', true);
    wave(12, 25, 54, 14, '#6fe2c8');
    text(11, 23, config.source.frequency, '#d4f7eb', 5, true);
    text(82, 17, 'FREQUENCY', undefined, 4.5);
    dial(95, 33, 11);
    rect(10, 54, 12, 6, '#8fbebc', '#8fbebc', true);
    rect(26, 54, 12, 6, '#bac5da', '#bac5da', true);
    rect(42, 54, 12, 6, '#bac5da', '#bac5da', true);
    text(62, 61, 'OUTPUT', undefined, 4.5, true);
    feet(120, 70);
  } else {
    rect(0, 0, 85, 85, '#bed6e9', '#5a7d9b', true);
    rect(3, 3, 79, 74, '#f0f5f8', '#bed1df', true);
    text(8, 11, 'BENCH SUPPLY', '#426984', 6, true);
    rect(8, 16, 69, 27, '#143335', '#53777d', true);
    text(12, 27, `${config.voltage}  SET`, '#89e2b3', 7, true);
    text(12, 38, `${config.currentLimit}  LIMIT`, '#9ecdea', 6, true);
    dial(24, 54, 7);
    dial(59, 54, 7);
    text(10, 56, 'V', undefined, 5, true);
    text(72, 56, 'A', undefined, 5, true);
    rect(9, 65, 11, 8, config.enabled ? '#8bc8a5' : '#9faeb6', '#5e8a7d', true);
    text(11, 71, config.enabled ? 'ON' : 'OFF', undefined, 4, true);
    feet(85, 85);
  }
  // Socket centres are the electrical anchors, not decorative labels or leads.
  for (const port of instrumentLayouts[config.type].ports) {
    const [x, y] = port.point;
    circle(x, y, 4.3, port.color, port.color);
    circle(x, y, 2.6, '#e7eef2', '#b8c8d1');
    circle(x, y, 1.25, '#273847', '#273847');
    const label = port.name;
    text(
      x - (label.length > 2 ? 5 : 3),
      y + 8,
      label,
      config.type === 'meter' ? '#edf3f6' : port.color,
      4.5,
      true,
    );
  }
  return items;
}

/** Old wired drawings retain their anchors, with a fitted front panel and probe leads. */
export function legacyInstrumentArtwork(
  config: InstrumentConfig,
  scale: number,
  nextId: () => number,
  glyph: Point[],
  pins: dsnPin[],
): DocItem[] {
  const layout = instrumentLayouts[config.type];
  const target: Record<InstrumentType, [number, number, number, number]> = {
    scope: [-140, 20, 180, 120],
    meter: [-40, 16, 80, 128],
    generator: [-40, 55, 80, 48],
    supply: [-40, 40, 80, 80],
  };
  const [x, y, w, h] = target[config.type].map((n) => n * scale);
  const sx = w / layout.size[0],
    sy = h / layout.size[1];
  const point = (p: number[]) => [x + p[0] * sx, y + p[1] * sy];
  const artwork = instrumentArtwork(config, nextId, glyph).map((item) => {
    if (item.NodeName === DocItemTypes.Line)
      return {
        ...item,
        d_points: item.d_points.map(point),
        line_width: Math.max(0.25, item.line_width * Math.min(sx, sy)),
      };
    if (item.NodeName === DocItemTypes.Label)
      return new updateLabel({
        ...item,
        point: point(item.point),
        font_size: item.font_size * Math.min(sx, sy),
        textData: null,
      }).post_construction();
    if (
      item.NodeName === DocItemTypes.Rectangle ||
      item.NodeName === DocItemTypes.Ellipse
    )
      return {
        ...item,
        point: point(item.point),
        point_b: point(item.point_b),
        rounded_rect: false,
        line_width: Math.max(0.25, item.line_width * Math.min(sx, sy)),
      };
    return item;
  });
  const leads: DocItem[] = pins.map((pin) => {
    const port = layout.ports.find((p) => p.number === pin.number),
      socket = point(port.point);
    return {
      ...style,
      NodeName: DocItemTypes.Line,
      _id: nextId(),
      d_points: [
        [...pin.point],
        [pin.point[0], 150 * scale],
        [socket[0], 150 * scale],
        socket,
      ],
      polygon: false,
      filled: false,
      line_colour: port.color,
      line_width: 0.6,
    };
  });
  return [...leads, ...artwork];
}
