import { createTeachingDrawing } from './examples';
import { createControl, updateControl } from './controlSymbols';
import { defaultInstrument } from './instruments';
import { DocItemTypes, dsnSymbol } from '../model/dsnItem';
import { updateSymbol } from '../manipulators/updateSymbol';
import { get_global_id } from '../util/global_id';
import { symbolReference } from './bindings';
import { deviceSignal } from './signals';
import { TestCase } from './studies';

export function createLaboratoryDrawing() {
  const drawing = createTeachingDrawing('rc-charging');
  drawing.documentId = 'e09ad205-5f90-4e12-9ce9-000000000001';
  let sheet = drawing.sheets[0];
  const find = (ref: string) =>
    sheet.items.find(
      (i): i is dsnSymbol =>
        i.NodeName === DocItemTypes.Symbol && symbolReference(i) === ref,
    );
  const source = find('V1');
  const sourcePins = new updateSymbol(source).active_points();
  const addedGenerator = createControl('generator', sheet, drawing);
  let generator = updateControl(
    addedGenerator.symbol,
    {
      ...defaultInstrument('generator'),
      source: {
        ...defaultInstrument('generator').source,
        frequency: '1kHz',
        amplitude: '1V',
        offset: '0V',
      },
    },
    drawing,
  );
  const generatorPin = new updateSymbol(generator).active_points()[0];
  generator = new updateSymbol({
    ...generator,
    point: [
      generator.point[0] + 330 - generatorPin[0],
      generator.point[1] + 360 - generatorPin[1],
    ],
    _active_points: null,
  }).post_construction();
  sheet = {
    ...sheet,
    items: sheet.items
      .filter(
        (i) =>
          i.NodeName !== DocItemTypes.Symbol ||
          !['PR1', 'PR2'].includes(symbolReference(i)),
      )
      .map((i) => (i === source ? generator : i)),
    symbols: { ...sheet.symbols, [generator._symbol.id]: generator._symbol },
  };
  drawing.sheets[0] = sheet;
  const place = (
    type: 'scope' | 'meter' | 'supply',
    point: [number, number],
  ) => {
    const added = createControl(type, sheet, drawing);
    let symbol = added.symbol;
    if (type === 'scope')
      symbol = updateControl(
        symbol,
        {
          ...defaultInstrument('scope'),
          timebase: '.5ms',
          scaleB: '.1V',
          level: '.5V',
        },
        drawing,
      );
    const pin = new updateSymbol(symbol)
      .active_points()
      .find((p) => p[2].number === '1');
    symbol = new updateSymbol({
      ...symbol,
      point: [
        symbol.point[0] + point[0] - pin[0],
        symbol.point[1] + point[1] - pin[1],
      ],
      _active_points: null,
    }).post_construction();
    sheet = {
      ...added.sheet,
      items: [...sheet.items, symbol],
      symbols: { ...added.sheet.symbols, [symbol._symbol.id]: symbol._symbol },
    };
    drawing.sheets[0] = sheet;
    return symbol;
  };
  const scope = place('scope', [540, 520]),
    meter = place('meter', [260, 1300]),
    supply = place('supply', [1010, 1160]);
  const resistor = find('R1'),
    pin = new updateSymbol(resistor)
      .active_points()
      .find((p) => p[2].number === '1');
  const load = new updateSymbol({
    ...resistor,
    _id: get_global_id(),
    point: [
      resistor.point[0] + 1400 - pin[0],
      resistor.point[1] + 100 - pin[1],
    ],
    _active_points: null,
    textData: [],
    text: resistor.text.map((f) => ({
      ...f,
      position: [...f.position],
      value: f.description === 'Ref' ? 'R3' : f.value,
    })),
  }).post_construction();
  sheet.items.push(load);
  const wire = (a: [number, number], b: [number, number]) =>
    sheet.items.push({
      NodeName: DocItemTypes.Wire,
      _id: get_global_id(),
      d_points: [a, b],
      _magnetic: null,
    });
  const path = (points: [number, number][]) =>
    points.slice(1).forEach((p, i) => wire(points[i], p));
  const terminal = (symbol: dsnSymbol, number: string): [number, number] => {
    const point = new updateSymbol(symbol)
      .active_points()
      .find((p) => p[2].number === number);
    return [point[0], point[1]];
  };
  const originalTerminal = (number: string): [number, number] => {
    const pin = sourcePins.find((p) => p[2].number === number);
    return [pin[0], pin[1]];
  };
  path([
    terminal(generator, '1'),
    [330, 380],
    [10, 380],
    [10, originalTerminal('1')[1]],
    originalTerminal('1'),
  ]);
  path([
    terminal(generator, '2'),
    [terminal(generator, '2')[0], 410],
    [40, 410],
    [40, originalTerminal('2')[1]],
    originalTerminal('2'),
  ]);
  // Differential channels A=IN and B=OUT; crossings have no junction dots.
  path([
    terminal(scope, '1'),
    [540, 620],
    [440, 620],
    [440, 20],
    [100, 20],
    [100, 100],
  ]);
  path([
    terminal(scope, '3'),
    [terminal(scope, '3')[0], 650],
    [430, 650],
    [430, 60],
    [310, 60],
    [310, 100],
  ]);
  path([
    terminal(scope, '2'),
    [terminal(scope, '2')[0], 680],
    [50, 680],
    [50, 170],
    [150, 170],
  ]);
  path([
    terminal(scope, '4'),
    [terminal(scope, '4')[0], 700],
    [50, 700],
    [50, 170],
    [150, 170],
  ]);
  path([
    terminal(meter, '1'),
    [400, 1300],
    [400, 740],
    [10, 740],
    [10, 100],
    [25, 100],
  ]);
  path([
    terminal(meter, '2'),
    [terminal(meter, '2')[0], 1430],
    [430, 1430],
    [430, 710],
    [50, 710],
    [50, 170],
    [150, 170],
  ]);
  const loadEnd = new updateSymbol(load)
    .active_points()
    .find((p) => p[2].number === '2');
  path([terminal(supply, '1'), [1460, 1160], [1460, 100], [1400, 100]]);
  path([
    terminal(supply, '2'),
    [terminal(supply, '2')[0], 1320],
    [loadEnd[0], 1320],
    [loadEnd[0], loadEnd[1]],
  ]);
  const ground = sheet.items.find((i) => i.NodeName === DocItemTypes.Power);
  if (ground?.NodeName === DocItemTypes.Power)
    sheet.items.push({
      ...ground,
      _id: get_global_id(),
      point: [terminal(supply, '2')[0], 1320],
      textData: null,
    });
  const label = sheet.items.find((i) => i.NodeName === DocItemTypes.Label);
  if (label?.NodeName === DocItemTypes.Label)
    sheet.items.push({
      ...label,
      _id: get_global_id(),
      point: [1110, 1160],
      text: 'BENCH',
      textData: null,
    });
  sheet = { ...sheet, details: { ...sheet.details, page_size: [1600, 1500] } };
  drawing.sheets[0] = sheet;
  const simulation = drawing.sheets[1],
    setup = simulation.simulation;
  simulation.name = 'Laboratory checks';
  setup.analysis = {
    ...setup.analysis,
    kind: 'tran',
    duration: '5ms',
    maxStep: '5us',
  };
  setup.measurements = [
    {
      id: 'out-rms',
      name: 'OUT AC RMS (settled)',
      kind: 'rippleRms',
      source: 'out',
      from: '2ms',
      to: '5ms',
    },
    {
      id: 'frequency',
      name: 'Generator frequency',
      kind: 'frequency',
      source: 'in',
      threshold: '0V',
      from: '2ms',
      to: '5ms',
    },
    {
      id: 'bench-power',
      name: 'Bench load mean power',
      kind: 'mean',
      source: deviceSignal(sheet.id, 'R3', 'power'),
      from: '2ms',
      to: '5ms',
    },
  ];
  setup.requirements = [
    {
      id: 'frequency-range',
      name: '1 kHz generator',
      measurement: 'frequency',
      comparison: 'between',
      lower: '999Hz',
      upper: '1001Hz',
      unit: 'Hz',
    },
  ];
  setup.bindings = [
    ...(setup.bindings || []),
    {
      id: 'capacitance',
      name: 'C1 capacitance',
      sheet: sheet.id,
      reference: 'C1',
      property: 'Value',
      unit: 'F',
      minimum: '.1uF',
      maximum: '10uF',
      logarithmic: true,
      series: 'continuous',
    },
    {
      id: 'bench-voltage',
      name: 'Bench set voltage',
      sheet: sheet.id,
      reference: symbolReference(supply),
      property: 'instrument:voltage',
      unit: 'V',
      minimum: '1V',
      maximum: '12V',
      logarithmic: false,
      series: 'continuous',
    },
  ];
  setup.studies = [
    {
      id: 'rc-tolerance',
      name: 'RC tolerances (seed 42)',
      kind: 'monteCarlo',
      seed: 42,
      count: 10,
      variations: [
        {
          binding: 'resistance',
          percent: '5',
          distribution: 'uniform',
          group: '',
        },
        {
          binding: 'capacitance',
          percent: '10',
          distribution: 'uniform',
          group: '',
        },
      ],
    },
  ];
  setup.testCases = [5, 9].map<TestCase>((v) => ({
    id: `bench-${v}`,
    name: `Bench ${v} V`,
    analysis: { ...setup.analysis },
    parameters: {},
    overrides: { 'bench-voltage': String(v) },
    bindings: structuredClone(setup.bindings),
    measurements: structuredClone(setup.measurements),
    requirements: structuredClone(setup.requirements),
    traces: [],
  }));
  setup.instructions = `GEN1 drives the RC network at 1 kHz through 50 Ohm. Select ${symbolReference(
    scope,
  )} for IN/OUT channels; ${symbolReference(
    meter,
  )} reads IN relative to ground (choose AC V and Measure for true RMS). ${symbolReference(
    supply,
  )} supplies the separate 1k R3 load. Reduce its current limit below 5mA to see CC operation. Analysis lab contains a seeded tolerance study and captured 5V/9V bench conditions. Controls and electrical loading are saved with this drawing.`;
  setup.signals = ['in', 'out'];
  setup.sweep = undefined;
  return drawing;
}
