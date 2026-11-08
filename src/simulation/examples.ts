import { blank } from '../io/ioXml';
import {
  DocItem,
  DocItemTypes,
  dsnPin,
  dsnSymbol,
  SymbolTextItem,
} from '../model/dsnItem';
import { libSymbol } from '../model/dsnDrawing';
import { TextDisplayMethod } from '../model/tclib';
import { get_global_id } from '../util/global_id';
import { createSimulationSheet } from './document';
import { createControl, ControlTool, updateControl } from './controlSymbols';
import { defaultSource, SourceConfig } from './controls';
import { updateSymbol } from '../manipulators/updateSymbol';
import { ioXML } from '../io/ioXml';
import { Snap } from '../manipulators/snap';

export type TeachingExample = 'voltage-divider' | 'rc-charging' | 'rc-low-pass';
export const teachingExamples: TeachingExample[] = [
  'voltage-divider',
  'rc-charging',
  'rc-low-pass',
];
const font = {
  font_name: 'Arial',
  font_size: 12,
  font_colour: '#000000',
  font_bold: false,
  font_italic: false,
};
const stroke = {
  stroked: true,
  line_colour: '#000000',
  line_width: 1,
  line_pattern: 0,
  filled: false,
  fill_colour: '#ffffff',
  hatch: 0,
  rounded_rect: false,
};

export function createTeachingDrawing(kind: TeachingExample) {
  const drawing = blank();
  const index = teachingExamples.indexOf(kind);
  if (index < 0) throw new Error('Unknown teaching example.');
  drawing.documentId = `594ae71f-836e-4aaf-8b30-00000000000${index + 1}`;
  const sheet = drawing.sheets[0];
  sheet.id = `c34ae71f-836e-4aaf-8b30-00000000000${index + 1}`;
  sheet.name = 'Circuit';
  sheet.details.title = kind.replace(/-/g, ' ');
  sheet.details.author = 'TinyCAD';
  sheet.details.date = '';
  const pin = (
    number: string,
    point: [number, number],
    rotation: number,
    length = 50,
  ): dsnPin => ({
    ...font,
    NodeName: DocItemTypes.Pin,
    _id: get_global_id(),
    point,
    number,
    name: number,
    rotation,
    length,
    number_pos: 0,
    centre_name: false,
    which: 0,
    elec: 4,
    show_name: false,
    show_number: false,
    part: 0,
    textData: null,
  });
  const shape = (
    type: DocItemTypes.Rectangle | DocItemTypes.Ellipse,
    a: [number, number],
    b: [number, number],
  ): DocItem => ({
    ...stroke,
    NodeName: type,
    _id: get_global_id(),
    point: a,
    point_b: b,
  });
  const line = (points: [number, number][]): DocItem => ({
    ...stroke,
    NodeName: DocItemTypes.Line,
    _id: get_global_id(),
    d_points: points,
    polygon: false,
  });
  const definition = (
    name: string,
    vertical: boolean,
    body: DocItem[],
    length = 50,
  ): libSymbol => {
    const pins = [
      pin('1', [0, 0], vertical ? 1 : 0, length),
      pin('2', vertical ? [0, 200] : [200, 0], vertical ? 3 : 2, length),
    ];
    const id = get_global_id();
    return {
      id,
      name: { value: name, type: 1 },
      ref: { value: name[0] + '?', type: 0 },
      description: `Ideal ${name.toLowerCase()} for a teaching example`,
      parts: 1,
      uid: `tinycad-teaching-${name}`,
      heterogeneous: false,
      outlines: [
        new ioXML().normalize_symbol(
          [...body, ...pins],
          new Snap(10, true),
          null,
          false,
          false,
        ),
      ],
    };
  };
  const resistor = definition('Resistor', false, [
    shape(DocItemTypes.Rectangle, [50, -20], [150, 20]),
  ]);
  const lower =
    kind === 'voltage-divider'
      ? definition('Resistor vertical', true, [
          shape(DocItemTypes.Rectangle, [-20, 50], [20, 150]),
        ])
      : definition(
          'Capacitor',
          true,
          [
            line([
              [-45, 80],
              [45, 80],
            ]),
            line([
              [-45, 120],
              [45, 120],
            ]),
          ],
          80,
        );
  const instance = (
    definition: libSymbol,
    ref: string,
    value: string,
    point: [number, number],
    vertical: boolean,
  ) => {
    const field = (
      description: string,
      value: string,
      position: [number, number],
      show = true,
    ): SymbolTextItem => ({
      description,
      value,
      position,
      show,
      display: show ? TextDisplayMethod.ShowValue : TextDisplayMethod.NeverShow,
    });
    const symbol: dsnSymbol = {
      ...font,
      NodeName: DocItemTypes.Symbol,
      _id: get_global_id(),
      point,
      show_power: false,
      allow_resize: false,
      scale_x: 1,
      scale_y: 1,
      part: 0,
      rotation: 0,
      _symbol: definition,
      _active_points: null,
      textData: [],
      hints: [],
      text: [
        field('Ref', ref, vertical ? [65, 75] : [65, -70]),
        field('Value', value, vertical ? [65, 100] : [65, -45]),
        field('$$SPICE', '$(ref) %(1) %(2) $(Value)', [0, 0], false),
      ],
    };
    const first = new updateSymbol(symbol)
      .active_points()
      .find((p) => p[2].number === '1');
    const shift = [point[0] - first[0], point[1] - first[1]];
    const placed = new updateSymbol({
      ...symbol,
      point: [point[0] + shift[0], point[1] + shift[1]],
      _active_points: null,
      text: symbol.text.map((field) => ({
        ...field,
        position: [field.position[0] - shift[0], field.position[1] - shift[1]],
      })),
    }).post_construction();
    sheet.symbols[definition.id] = definition;
    sheet.items.push(placed);
  };
  const control = (
    tool: ControlTool,
    tip: [number, number],
    config?: SourceConfig,
    rotation = 0,
  ) => {
    const created = createControl(tool, sheet, drawing);
    sheet.symbols = created.sheet.symbols;
    let symbol = config
      ? updateControl(created.symbol, config, drawing)
      : created.symbol;
    if (rotation)
      symbol = new updateSymbol(symbol).rotate(rotation) as dsnSymbol;
    const first = new updateSymbol(symbol)
      .active_points()
      .find((p) => p[2].number === '1');
    symbol = new updateSymbol({
      ...symbol,
      point: [
        symbol.point[0] + tip[0] - first[0],
        symbol.point[1] + tip[1] - first[1],
      ],
      _active_points: null,
    }).post_construction();
    if (tool === 'current-probe') {
      symbol = new updateSymbol({
        ...symbol,
        text: symbol.text.map((field) => ({
          ...field,
          position:
            field.description === 'Ref'
              ? [545 - symbol.point[0], 330 - symbol.point[1]]
              : field.description === 'Name'
              ? [545 - symbol.point[0], 350 - symbol.point[1]]
              : field.position,
        })),
      }).post_construction();
    }
    sheet.symbols[symbol._symbol.id] = symbol._symbol;
    sheet.items.push(symbol);
  };
  control('source', [400, 400], {
    ...defaultSource(),
    dc: kind === 'voltage-divider' ? '5' : '0',
    acMagnitude: kind === 'rc-low-pass' ? '1' : '0',
    waveform: kind === 'rc-charging' ? 'pulse' : 'dc',
    low: '0',
    high: '1',
    delay: '0',
    rise: '1us',
    fall: '1us',
    width: '10ms',
    period: '20ms',
  });
  instance(resistor, 'R1', '1k', [760, 400], false);
  instance(
    lower,
    kind === 'voltage-divider' ? 'R2' : 'C1',
    kind === 'voltage-divider' ? '1k' : '1u',
    [1060, 400],
    true,
  );
  control('current-probe', [500, 400], undefined, 3);
  control('probe', [100, 400]);
  control('probe', [1240, 400]);
  const wire = (a: [number, number], b: [number, number]) =>
    sheet.items.push({
      NodeName: DocItemTypes.Wire,
      _id: get_global_id(),
      d_points: [a, b],
      _magnetic: null,
    });
  wire([100, 400], [400, 400]);
  wire([400, 400], [500, 400]);
  wire([660, 400], [760, 400]);
  wire([960, 400], [1060, 400]);
  wire([1060, 400], [1240, 400]);
  wire([400, 560], [400, 680]);
  wire([400, 680], [600, 680]);
  wire([600, 680], [1060, 680]);
  wire([1060, 600], [1060, 680]);
  for (const [text, point] of [
    ['IN', [400, 400]],
    ['OUT', [1060, 400]],
  ] as [string, [number, number]][])
    sheet.items.push({
      ...font,
      NodeName: DocItemTypes.Label,
      _id: get_global_id(),
      point,
      text,
      which: 0,
      rotation: 0,
      textData: null,
      hints: [],
    });
  sheet.items.push({
    ...font,
    NodeName: DocItemTypes.Power,
    _id: get_global_id(),
    point: [600, 680],
    text: '0',
    which: 4,
    rotation: 0,
    textData: null,
    hints: [],
    _magnetic: null,
    _no_show: false,
  });
  const simulation = createSimulationSheet(
    sheet,
    kind === 'voltage-divider'
      ? 'DC checks'
      : kind === 'rc-charging'
      ? 'Charging response'
      : 'Frequency response',
  );
  simulation.id = `934ae71f-836e-4aaf-8b30-00000000000${index + 1}`;
  const setup = simulation.simulation;
  setup.analysis.kind =
    kind === 'voltage-divider' ? 'op' : kind === 'rc-charging' ? 'tran' : 'ac';
  setup.signals =
    kind === 'voltage-divider'
      ? ['out', 'vp1#branch']
      : ['in', 'out', 'vp1#branch'];
  setup.instructions =
    kind === 'voltage-divider'
      ? 'Run Operating Point. OUT should be 2.50 V relative to node 0; VP1 should read +2.50 mA from IN towards R1; V1 branch current is -2.50 mA. Change R2 Value to 2k and run again: OUT should become approximately 3.33 V. Select V1 to edit its DC level in the source panel; select PR1 (IN), PR2 (OUT) or VP1 to see their readings.'
      : kind === 'rc-charging'
      ? 'Run Transient for 5 ms. R1 = 1k and C1 = 1u give a 1 ms time constant. OUT should reach about 0.632 V at 1 ms and approach the 1 V input. Select V1 to edit its pulse and preview it. Select PR1 (IN), PR2 (OUT) or VP1 for probe charts. Change R1 or C1 Value to explore the time constant.'
      : 'Run AC. The ideal source has AC amplitude 1 V; gain OUT/IN has a -3.01 dB corner near 159.15 Hz and phase near -45 degrees. Change R1 or C1 Value to move the corner. Select V1 to change AC amplitude/phase in the source panel. Select PR1 (IN), PR2 (OUT) or VP1 for probe charts; AC amplitude is independent of transient waveform settings.';
  if (kind === 'rc-low-pass')
    setup.traces = [
      { name: 'Gain OUT/IN', operation: 'divide', left: 'out', right: 'in' },
    ];
  drawing.sheets.push(simulation);
  return drawing;
}
