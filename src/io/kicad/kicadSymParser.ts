import {
  KiArc,
  KiBezier,
  KiCadLibrary,
  KiCircle,
  KiFill,
  KiGraphicItem,
  KiPin,
  KiPoint,
  KiPolyline,
  KiPosition,
  KiProperty,
  KiRectangle,
  KiStroke,
  KiSubSymbol,
  KiSymbol,
  KiText,
  KiTextEffects,
} from './kicadTypes';
import { SExprAtom, SExprList, parseSexpr } from './kicadSexprParser';

function asNumber(atom: SExprAtom | undefined, fallback = 0): number {
  if (typeof atom === 'number') {
    return atom;
  }
  if (typeof atom === 'string') {
    const n = Number(atom);
    if (!Number.isNaN(n)) {
      return n;
    }
  }
  return fallback;
}

function asString(atom: SExprAtom | undefined, fallback = ''): string {
  if (typeof atom === 'string') {
    return atom;
  }
  if (typeof atom === 'number') {
    return String(atom);
  }
  return fallback;
}

function nodeChildren(node?: SExprList): SExprList[] {
  if (!node || !Array.isArray((node as any).children)) {
    return [];
  }
  return node.children;
}

function child(node: SExprList | undefined, tag: string): SExprList | undefined {
  return nodeChildren(node).find((c) => c.tag === tag);
}

function children(node: SExprList | undefined, tag: string): SExprList[] {
  return nodeChildren(node).filter((c) => c.tag === tag);
}

function parsePoint(node?: SExprList): KiPoint {
  if (!node) {
    return { x: 0, y: 0 };
  }
  return {
    x: asNumber(node.values[0]),
    y: asNumber(node.values[1]),
  };
}

function parsePosition(node?: SExprList): KiPosition {
  if (!node) {
    return { x: 0, y: 0, angle: 0 };
  }
  return {
    x: asNumber(node.values[0]),
    y: asNumber(node.values[1]),
    angle: asNumber(node.values[2]),
  };
}

function parseStroke(node?: SExprList): KiStroke {
  const width = asNumber(child(node as any, 'width')?.values[0], 0.254);
  const type = asString(child(node as any, 'type')?.values[0], 'solid');
  const colorNode = child(node as any, 'color');
  let color: string | undefined;
  if (colorNode) {
    const r = asNumber(colorNode.values[0], 0);
    const g = asNumber(colorNode.values[1], 0);
    const b = asNumber(colorNode.values[2], 0);
    color = `#${Math.max(0, Math.min(255, Math.round(r))).toString(16).padStart(2, '0')}${Math.max(0, Math.min(255, Math.round(g))).toString(16).padStart(2, '0')}${Math.max(0, Math.min(255, Math.round(b))).toString(16).padStart(2, '0')}`;
  }
  return { width, type, color };
}

function parseFill(node?: SExprList): KiFill {
  const t = asString(child(node as any, 'type')?.values[0], 'none');
  const colorNode = child(node as any, 'color');
  let color: string | undefined;
  if (colorNode) {
    const r = asNumber(colorNode.values[0], 0);
    const g = asNumber(colorNode.values[1], 0);
    const b = asNumber(colorNode.values[2], 0);
    color = `#${Math.max(0, Math.min(255, Math.round(r))).toString(16).padStart(2, '0')}${Math.max(0, Math.min(255, Math.round(g))).toString(16).padStart(2, '0')}${Math.max(0, Math.min(255, Math.round(b))).toString(16).padStart(2, '0')}`;
  }
  return { type: t, color };
}

function parseTextEffects(node?: SExprList): KiTextEffects {
  const font = child(node as any, 'font');
  const size = child(font as any, 'size');
  const colorNode = child(font as any, 'color');
  let color: string | undefined;

  if (colorNode) {
    const r = asNumber(colorNode.values[0], 0);
    const g = asNumber(colorNode.values[1], 0);
    const b = asNumber(colorNode.values[2], 0);
    color = `#${Math.max(0, Math.min(255, Math.round(r))).toString(16).padStart(2, '0')}${Math.max(0, Math.min(255, Math.round(g))).toString(16).padStart(2, '0')}${Math.max(0, Math.min(255, Math.round(b))).toString(16).padStart(2, '0')}`;
  }

  return {
    sizeX: asNumber(size?.values[0], 1.27),
    sizeY: asNumber(size?.values[1], asNumber(size?.values[0], 1.27)),
    bold: !!child(font as any, 'bold') || asString(child(font as any, 'bold')?.values[0]) === 'yes',
    italic: !!child(font as any, 'italic') || asString(child(font as any, 'italic')?.values[0]) === 'yes',
    hidden: !!child(node as any, 'hide'),
    color,
    justify: (child(node as any, 'justify')?.values || []).map((v) => asString(v)),
  };
}

function parsePts(node?: SExprList): KiPoint[] {
  if (!node) {
    return [];
  }
  const xyNodes = children(node, 'xy');
  return xyNodes.map((xy) => ({
    x: asNumber(xy.values[0]),
    y: asNumber(xy.values[1]),
  }));
}

function parseGraphic(node: SExprList): KiGraphicItem | null {
  switch (node.tag) {
    case 'rectangle': {
      const item: KiRectangle = {
        type: 'rectangle',
        start: parsePoint(child(node, 'start')),
        end: parsePoint(child(node, 'end')),
        stroke: parseStroke(child(node, 'stroke')),
        fill: parseFill(child(node, 'fill')),
      };
      return item;
    }
    case 'circle': {
      const item: KiCircle = {
        type: 'circle',
        center: parsePoint(child(node, 'center')),
        radius: asNumber(child(node, 'radius')?.values[0]),
        stroke: parseStroke(child(node, 'stroke')),
        fill: parseFill(child(node, 'fill')),
      };
      return item;
    }
    case 'polyline': {
      const item: KiPolyline = {
        type: 'polyline',
        points: parsePts(child(node, 'pts')),
        stroke: parseStroke(child(node, 'stroke')),
        fill: parseFill(child(node, 'fill')),
      };
      return item;
    }
    case 'arc': {
      const item: KiArc = {
        type: 'arc',
        start: parsePoint(child(node, 'start')),
        mid: parsePoint(child(node, 'mid')),
        end: parsePoint(child(node, 'end')),
        stroke: parseStroke(child(node, 'stroke')),
        fill: parseFill(child(node, 'fill')),
      };
      return item;
    }
    case 'bezier': {
      const item: KiBezier = {
        type: 'bezier',
        points: parsePts(child(node, 'pts')),
        stroke: parseStroke(child(node, 'stroke')),
        fill: parseFill(child(node, 'fill')),
      };
      return item;
    }
    case 'text': {
      const item: KiText = {
        type: 'text',
        text: asString(node.values[0]),
        position: parsePosition(child(node, 'at')),
        effects: parseTextEffects(child(node, 'effects')),
      };
      return item;
    }
    default:
      return null;
  }
}

function parsePin(node: SExprList): KiPin {
  const nameNode = child(node, 'name');
  const numberNode = child(node, 'number');

  return {
    electricalType: asString(node.values[0], 'passive'),
    graphicStyle: asString(node.values[1], 'line'),
    position: parsePosition(child(node, 'at')),
    length: asNumber(child(node, 'length')?.values[0], 2.54),
    name: asString(nameNode?.values[0], ''),
    nameEffects: parseTextEffects(child(nameNode as any, 'effects')),
    number: asString(numberNode?.values[0], ''),
    numberEffects: parseTextEffects(child(numberNode as any, 'effects')),
    hide: node.values.some((v) => asString(v) === 'hide') || !!child(node, 'hide'),
  };
}

function parseSubSymbol(node: SExprList, parentName: string): KiSubSymbol {
  const name = asString(node.values[0], '');
  const suffix = name.startsWith(parentName + '_')
    ? name.substring(parentName.length + 1)
    : '';
  const parts = suffix.split('_').filter((p) => p.length > 0);
  const unit = parts.length > 0 ? Math.max(0, Number(parts[0])) : 0;
  const style = parts.length > 1 ? Math.max(0, Number(parts[1])) : 0;

  const graphics: KiGraphicItem[] = [];
  const pins: KiPin[] = [];

  for (const c of nodeChildren(node)) {
    if (c.tag === 'pin') {
      pins.push(parsePin(c));
      continue;
    }
    const g = parseGraphic(c);
    if (g) {
      graphics.push(g);
    }
  }

  return { unit, style, graphics, pins };
}

function parseProperty(node: SExprList): KiProperty {
  return {
    key: asString(node.values[0]),
    value: asString(node.values[1]),
    effects: parseTextEffects(child(node, 'effects')),
  };
}

function parseTopSymbol(node: SExprList): KiSymbol {
  const name = asString(node.values[0]);
  const properties = children(node, 'property').map(parseProperty);
  const pinNamesNode = child(node, 'pin_names');
  const pinNumbersNode = child(node, 'pin_numbers');
  const offsetNode = child(pinNamesNode as any, 'offset');

  const subsymbols = children(node, 'symbol').map((s) => parseSubSymbol(s, name));

  return {
    name,
    properties,
    pinNamesOffset: asNumber(offsetNode?.values[0], 0.508),
    showPinNames: !(
      (pinNamesNode?.values || []).includes('hide' as any) ||
      !!child(pinNamesNode as any, 'hide')
    ),
    showPinNumbers: !(
      (pinNumbersNode?.values || []).includes('hide' as any) ||
      !!child(pinNumbersNode as any, 'hide')
    ),
    power: !!child(node, 'power'),
    extendsName: asString(child(node, 'extends')?.values[0], ''),
    subsymbols,
  };
}

function mergeInherited(symbols: KiSymbol[]) {
  const byName: { [name: string]: KiSymbol } = {};
  for (const symbol of symbols) {
    byName[symbol.name] = symbol;
  }

  for (const symbol of symbols) {
    if (!symbol.extendsName) {
      continue;
    }
    const parent = byName[symbol.extendsName];
    if (!parent) {
      continue;
    }

    const existingUnits = new Set(symbol.subsymbols.map((s) => `${s.unit}:${s.style}`));
    const inherited = parent.subsymbols
      .filter((s) => !existingUnits.has(`${s.unit}:${s.style}`))
      .map((s) => ({ ...s, graphics: [...s.graphics], pins: [...s.pins] }));

    symbol.subsymbols = [...inherited, ...symbol.subsymbols];

    const existingProps = new Set(symbol.properties.map((p) => p.key.toLowerCase()));
    for (const p of parent.properties) {
      if (!existingProps.has(p.key.toLowerCase())) {
        symbol.properties.push({ ...p });
      }
    }
  }
}

export function parseKicadSym(input: string): KiCadLibrary {
  const root = parseSexpr(input);
  if (root.tag !== 'kicad_symbol_lib') {
    throw new Error('Not a KiCad symbol library');
  }

  const symbols = children(root, 'symbol').map(parseTopSymbol);
  mergeInherited(symbols);
  return { symbols };
}
