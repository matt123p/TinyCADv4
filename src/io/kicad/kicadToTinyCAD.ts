import { updateText } from '../../manipulators/updateText';
import { updatePin } from '../../manipulators/updatePin';
import { DocItem, DocItemTypes, dsnEllipse, dsnLine, dsnPin, dsnRectangle, dsnText } from '../../model/dsnItem';
import { TextDisplayMethod, tclibLibraryEntry } from '../../model/tclib';
import { get_global_id } from '../../util/global_id';
import { ImportedSymbol } from './importer';
import { arcToDPoints } from './arcApprox';
import {
  KiArc,
  KiBezier,
  KiCadLibrary,
  KiCircle,
  KiGraphicItem,
  KiPin,
  KiPoint,
  KiPolyline,
  KiRectangle,
  KiSymbol,
  KiText,
} from './kicadTypes';

const KICAD_TO_TINYCAD = 10;
const KICAD_TO_FONT = 10;

function kicadToTinyCad(value: number): number {
  return (value/2.54) * KICAD_TO_TINYCAD;
}

function kicadToFont(value: number): number {
  return Math.max(8, (value/2.54) * KICAD_TO_FONT);
}

function colourOrDefault(input?: string, fallback = '#000000') {
  if (!input || !/^#[0-9a-fA-F]{6}$/.test(input)) {
    return fallback;
  }
  return input;
}

function linePattern(style: string): number {
  switch ((style || '').toLowerCase()) {
    case 'dash':
      return 1;
    case 'dot':
      return 2;
    case 'dash_dot':
      return 3;
    case 'dash_dot_dot':
      return 4;
    default:
      return 0;
  }
}

function makeRect(item: KiRectangle): dsnRectangle {
  return {
    NodeName: DocItemTypes.Rectangle,
    _id: get_global_id(),
    point: [kicadToTinyCad(item.start.x), kicadToTinyCad(item.start.y)],
    point_b: [kicadToTinyCad(item.end.x), kicadToTinyCad(item.end.y)],
    line_colour: colourOrDefault(item.stroke.color),
    line_width: Math.max(1, kicadToTinyCad(item.stroke.width)),
    line_pattern: linePattern(item.stroke.type),
    stroked: true,
    filled: item.fill.type !== 'none',
    fill_colour: colourOrDefault(item.fill.color, '#ffffff'),
    hatch: 0,
    rounded_rect: false,
  };
}

function makeCircle(item: KiCircle): dsnEllipse {
  const r = kicadToTinyCad(item.radius);
  return {
    NodeName: DocItemTypes.Ellipse,
    _id: get_global_id(),
    point: [kicadToTinyCad(item.center.x) - r, kicadToTinyCad(item.center.y) - r],
    point_b: [kicadToTinyCad(item.center.x) + r, kicadToTinyCad(item.center.y) + r],
    line_colour: colourOrDefault(item.stroke.color),
    line_width: Math.max(1, kicadToTinyCad(item.stroke.width)),
    line_pattern: linePattern(item.stroke.type),
    stroked: true,
    filled: item.fill.type !== 'none',
    fill_colour: colourOrDefault(item.fill.color, '#ffffff'),
    hatch: 0,
    rounded_rect: false,
  };
}

function toDPoints(points: KiPoint[]): any[] {
  return points.map((p) => [kicadToTinyCad(p.x), kicadToTinyCad(p.y)]);
}

function makePolyline(item: KiPolyline): dsnLine {
  return {
    NodeName: DocItemTypes.Line,
    _id: get_global_id(),
    polygon: item.fill.type !== 'none',
    d_points: toDPoints(item.points),
    line_colour: colourOrDefault(item.stroke.color),
    line_width: Math.max(1, kicadToTinyCad(item.stroke.width)),
    line_pattern: linePattern(item.stroke.type),
    stroked: true,
    filled: item.fill.type !== 'none',
    fill_colour: colourOrDefault(item.fill.color, '#ffffff'),
    hatch: 0,
  };
}

function makeArc(item: KiArc): dsnLine {
  const d = arcToDPoints(
    { x: kicadToTinyCad(item.start.x), y: kicadToTinyCad(item.start.y) },
    { x: kicadToTinyCad(item.mid.x), y: kicadToTinyCad(item.mid.y) },
    { x: kicadToTinyCad(item.end.x), y: kicadToTinyCad(item.end.y) },
  );
  return {
    NodeName: DocItemTypes.Line,
    _id: get_global_id(),
    polygon: false,
    d_points: d,
    line_colour: colourOrDefault(item.stroke.color),
    line_width: Math.max(1, kicadToTinyCad(item.stroke.width)),
    line_pattern: linePattern(item.stroke.type),
    stroked: true,
    filled: false,
    fill_colour: '#ffffff',
    hatch: 0,
  };
}

function makeBezier(item: KiBezier): dsnLine {
  const d: any[] = [];
  const pts = item.points.map((p) => [kicadToTinyCad(p.x), kicadToTinyCad(p.y)]);
  if (pts.length > 0) {
    d.push(pts[0]);
  }
  for (let i = 1; i < pts.length; i += 3) {
    if (i + 2 < pts.length) {
      d.push([pts[i][0], pts[i][1], 1]);
      d.push([pts[i + 1][0], pts[i + 1][1], 1]);
      d.push(pts[i + 2]);
    }
  }
  return {
    NodeName: DocItemTypes.Line,
    _id: get_global_id(),
    polygon: false,
    d_points: d,
    line_colour: colourOrDefault(item.stroke.color),
    line_width: Math.max(1, kicadToTinyCad(item.stroke.width)),
    line_pattern: linePattern(item.stroke.type),
    stroked: true,
    filled: false,
    fill_colour: '#ffffff',
    hatch: 0,
  };
}

function angleToRotation(angle: number): number {
  const normalized = ((((angle % 360) + 360) % 360) + 45) % 360;
  if (normalized < 90) {
    return 0;
  }
  if (normalized < 180) {
    return 1;
  }
  if (normalized < 270) {
    return 2;
  }
  return 3;
}

function textRotation(angle: number): number {
  const a = (((angle % 360) + 360) % 360 + 45) % 360;
  return a >= 90 && a < 270 ? 1 : 0;
}

function makeText(item: KiText): dsnText {
  const fontSize = kicadToFont(Math.max(item.effects.sizeX, item.effects.sizeY));
  const x = kicadToTinyCad(item.position.x);
  const y = kicadToTinyCad(item.position.y);
  const width = Math.max(20, item.text.length * (fontSize * 0.6));

  const txt: dsnText = {
    NodeName: DocItemTypes.Text,
    _id: get_global_id(),
    point: [x, y - fontSize],
    point_b: [x + width, y + fontSize],
    line_colour: '#000000',
    line_width: 1,
    line_pattern: 0,
    stroked: false,
    filled: false,
    fill_colour: '#ffffff',
    hatch: 0,
    rounded_rect: false,
    text: item.text,
    rotation: textRotation(item.position.angle),
    font_name: 'Arial',
    font_size: fontSize,
    font_bold: item.effects.bold,
    font_italic: item.effects.italic,
    font_colour: colourOrDefault(item.effects.color),
    textData: null as any,
  };

  return new updateText(txt).post_construction() as dsnText;
}

function mapElec(input: string): number {
  switch ((input || '').toLowerCase()) {
    case 'input':
      return 0;
    case 'output':
      return 1;
    case 'tri_state':
      return 2;
    case 'open_collector':
      return 3;
    case 'passive':
      return 4;
    case 'bidirectional':
      return 5;
    case 'not_connected':
      return 6;
    case 'free':
      return 7;
    case 'unspecified':
      return 8;
    case 'power_in':
      return 9;
    case 'power_out':
      return 10;
    case 'open_emitter':
      return 11;
    default:
      return 4;
  }
}

function mapShape(input: string): number {
  switch ((input || '').toLowerCase()) {
    case 'line':
      return 0;
    case 'inverted':
      return 1;
    case 'clock':
      return 2;
    case 'inverted_clock':
      return 3;
    case 'non_logic':
      return 6;
    case 'input_low':
      return 7;
    case 'clock_low':
      return 8;
    case 'output_low':
      return 9;
    case 'edge_clock_high':
      return 10;
    default:
      return 0;
  }
}

function isPowerElec(elec: number): boolean {
  return elec === 9 || elec === 10;
}

function makePin(pin: KiPin, showNames: boolean, showNumbers: boolean): dsnPin {
  const point = [kicadToTinyCad(pin.position.x), kicadToTinyCad(pin.position.y)];
  const elec = mapElec(pin.electricalType);
  const which = pin.hide
    ? (isPowerElec(elec) ? 4 : 5)
    : mapShape(pin.graphicStyle);
  const p: dsnPin = {
    NodeName: DocItemTypes.Pin,
    _id: get_global_id(),
    point,
    rotation: angleToRotation(pin.position.angle),
    name: pin.name,
    number: pin.number,
    length: Math.max(10, kicadToTinyCad(pin.length)),
    number_pos: 0,
    centre_name: false,
    which,
    elec,
    show_name: showNames && !pin.hide && !pin.nameEffects.hidden,
    show_number: showNumbers && !pin.hide && !pin.numberEffects.hidden,
    part: 0,
    font_name: 'Arial',
    font_size: Math.max(8, kicadToFont(Math.max(pin.nameEffects.sizeX, pin.nameEffects.sizeY))),
    font_bold: pin.nameEffects.bold,
    font_italic: pin.nameEffects.italic,
    font_colour: '#000000',
    textData: null as any,
  };

  return new updatePin(p).post_construction() as dsnPin;
}

function convertGraphic(g: KiGraphicItem): DocItem | null {
  switch (g.type) {
    case 'rectangle':
      return makeRect(g);
    case 'circle':
      return makeCircle(g);
    case 'polyline':
      return makePolyline(g);
    case 'arc':
      return makeArc(g);
    case 'bezier':
      return makeBezier(g);
    case 'text':
      return makeText(g);
    default:
      return null;
  }
}

function property(symbol: KiSymbol, key: string, fallback = '') {
  const p = symbol.properties.find((x) => x.key.toLowerCase() === key.toLowerCase());
  return p?.value || fallback;
}

function withRefSuffix(reference: string): string {
  const trimmed = (reference || '').trim();
  const base = trimmed.length > 0 ? trimmed : 'U';
  return base.endsWith('?') ? base : `${base}?`;
}

function isHidden(symbol: KiSymbol, key: string) {
  const p = symbol.properties.find((x) => x.key.toLowerCase() === key.toLowerCase());
  return !!p?.effects.hidden;
}

function collectUnits(symbol: KiSymbol, includeDeMorgan: boolean) {
  const byUnit: { [unit: number]: { graphics: KiGraphicItem[]; pins: KiPin[] } } = {};

  const shared = symbol.subsymbols.filter((s) => s.unit === 0 && (includeDeMorgan || s.style !== 2));
  const mainUnits = symbol.subsymbols.filter((s) => s.unit > 0 && (includeDeMorgan || s.style !== 2));

  const units = new Set<number>(mainUnits.map((s) => s.unit));
  if (units.size === 0) {
    units.add(1);
  }

  for (const unit of units) {
    const target = { graphics: [] as KiGraphicItem[], pins: [] as KiPin[] };
    for (const sh of shared) {
      target.graphics.push(...sh.graphics);
    }
    for (const u of mainUnits.filter((s) => s.unit === unit)) {
      target.graphics.push(...u.graphics);
      target.pins.push(...u.pins);
    }
    byUnit[unit] = target;
  }

  return byUnit;
}

function toImported(symbol: KiSymbol, includeDeMorgan: boolean): ImportedSymbol {
  const value = property(symbol, 'Value', symbol.name);
  const reference = withRefSuffix(property(symbol, 'Reference', 'U?'));
  const description = property(symbol, 'Description', value);

  const attrs = symbol.properties
    .filter((p) => {
      const key = p.key.toLowerCase();
      return key !== 'value' && key !== 'reference' && key !== 'description';
    })
    .map((p) => ({
      AttName: p.key,
      AttValue: p.value,
      ShowAtt: p.effects.hidden ? TextDisplayMethod.HideValue : TextDisplayMethod.ShowValue,
    }));

  const units = collectUnits(symbol, includeDeMorgan);
  const unitKeys = Object.keys(units).map((x) => Number(x)).sort((a, b) => a - b);
  const symbolData = unitKeys.map((unitId) => {
    const unit = units[unitId];
    const items: DocItem[] = [];
    for (const g of unit.graphics) {
      const item = convertGraphic(g);
      if (item) {
        items.push(item);
      }
    }
    for (const p of unit.pins) {
      items.push(makePin(p, symbol.showPinNames, symbol.showPinNumbers));
    }
    return items;
  });

  const name: tclibLibraryEntry = {
    NameID: 0,
    SymbolID: 0,
    Name: value,
    Reference: reference,
    Description: description,
    ppp: Math.max(1, symbolData.length),
    ShowName: isHidden(symbol, 'Value') ? TextDisplayMethod.HideValue : TextDisplayMethod.ShowValue,
    ShowRef: isHidden(symbol, 'Reference') ? TextDisplayMethod.HideValue : TextDisplayMethod.ShowValue,
    Attributes: attrs,
  };

  return { name, symbolData };
}

export function convertKicadLibrary(lib: KiCadLibrary): ImportedSymbol[] {
  const imported: ImportedSymbol[] = [];

  for (const symbol of lib.symbols) {
    const hasDeMorgan = symbol.subsymbols.some((s) => s.style === 2);
    if (hasDeMorgan) {
      imported.push(toImported(symbol, false));
      const dm = toImported(symbol, true);
      dm.name = {
        ...dm.name,
        Name: `${dm.name.Name} (De Morgan)`,
      };
      imported.push(dm);
    } else {
      imported.push(toImported(symbol, false));
    }
  }

  const dedupMap: { [name: string]: number } = {};
  for (const item of imported) {
    const base = item.name.Name || 'Imported Symbol';
    if (!dedupMap[base]) {
      dedupMap[base] = 1;
      continue;
    }
    const n = ++dedupMap[base];
    item.name.Name = `${base} ${n}`;
  }

  return imported;
}
