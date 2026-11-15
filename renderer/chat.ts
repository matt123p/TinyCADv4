import { insertSymbol } from '../src/chat/insert-symbol';
// Shared native engine, bundled with the same DOM/font/editor shims as MCP rendering.
import {
  validateTinyCadDrawing,
  renderTinyCadDrawingSvg,
  tidyTinyCadDrawing,
} from './drawing';
import { renderTinyCadSymbolSvg } from './index';
import { validateXml, parseXml, children } from '../src/chat/validation';
import { createIc } from '../src/chat/ic';
import { ioXML } from '../src/io/ioXml';
import { NetlistGenerator } from '../src/io/netlists/netlistGenerator';
import { makeNetForDrawing } from '../src/web-worker/netlist';
import { resetServerIds } from './serverGlobalId';

function validated(definition: string, drawing: boolean) {
  const result = validateXml(definition, drawing);
  if (!result.valid) throw new Error(JSON.stringify(result));
  return parseXml(definition, drawing);
}
export function nativeTool(name: string, args: any): any {
  const { definition } = args;
  if (name === 'insert_symbol') return insertSymbol(args);
  if (name === 'validate_component') return validateXml(definition);
  if (name === 'validate_drawing') {
    const structural = validateXml(definition, true);
    return structural.valid
      ? validateTinyCadDrawing(definition)
      : { ...structural, structurallyValid: false };
  }
  if (name === 'render_component') {
    validated(definition, false);
    const svg = renderTinyCadSymbolSvg(definition);
    if (!svg) throw new Error('Could not render the component.');
    return { svg };
  }
  if (name === 'render_drawing') {
    validated(definition, true);
    return {
      svg: renderTinyCadDrawingSvg(
        definition,
        args.sheet ?? 1,
        args.view ?? 'page',
      ),
    };
  }
  if (name === 'create_ic_symbol') {
    const result = createIc(args.name, args.pins);
    validated(result.definition, false);
    return { ...result, svg: renderTinyCadSymbolSvg(result.definition) };
  }
  if (name === 'auto_tidy_drawing') {
    validated(definition, true);
    const { sheet, definition: ignored, ...options } = args;
    const result = tidyTinyCadDrawing(definition, sheet ?? 1, options);
    validated(result.definition, true);
    return result;
  }
  if (name === 'read_netlist') {
    const xml = validated(definition, true);
    const drawing = new ioXML().from_dsn(xml);
    const nets = new NetlistGenerator();
    makeNetForDrawing(drawing, nets);
    return {
      nets: Object.entries(nets.nets).map(([id, nodes]) => ({
        id,
        names: Object.entries(nets.labels)
          .filter(([, net]) => net === id)
          .map(([label]) => label),
        nodes: nodes.map((n) => ({
          sheet: n.sheet,
          reference: n.reference,
          pin: n.pin,
          label: n.label,
          position: n.a,
          electricalType: n.eprop,
        })),
      })),
    };
  }
  if (name === 'inspect_drawing') {
    // Existing user drawings can contain legacy geometry. Reading is never blocked
    // by generation-only validation rules; writes still require structural checks.
    resetServerIds();
    const drawing = new ioXML().from_dsn(parseXml(definition, true));
    return {
      metadata: drawing.sheets.map((s, i) => ({
        sheet: i + 1,
        name: s.name,
        details: s.details,
        items: s.items.map((item) => ({
          id: item._id,
          type: item.NodeName,
          ...('point' in item
            ? { position: item.point.map((v) => v / 5) }
            : {}),
          ...('text' in item ? { text: item.text } : {}),
        })),
      })),
      settings: drawing.settings,
      netlistTypes: drawing.netlistTypes,
    };
  }
  if (name === 'edit_drawing') {
    let result = definition;
    for (const edit of args.edits) {
      if (!edit.find || result.split(edit.find).length !== 2)
        throw new Error(
          'Each edit.find must match exactly once. Read the current XML again.',
        );
      result = result.replace(edit.find, () => edit.replace);
    }
    validated(result, !args.component);
    return { definition: result };
  }
  if (name === 'add_to_drawing') {
    const xml = validated(definition, !args.component);
    const fragment = parseXml(`<TinyCAD>${args.fragment}</TinyCAD>`, true);
    const root = xml.xmlDoc.documentElement;
    const sheet =
      root.nodeName === 'TinyCAD'
        ? root
        : children(root).filter((n) => n.nodeName === 'TinyCAD')[
            args.sheet - 1
          ];
    if (!sheet) throw new Error('Unknown sheet.');
    for (const n of children(fragment.xmlDoc.documentElement))
      sheet.appendChild(xml.xmlDoc.importNode(n, true));
    const rank = (n: any) =>
      [
        'NAME',
        'DETAILS',
        'FONT',
        'STYLE',
        'FILL',
        'SYMBOLDEF',
        'OPTIONS',
      ].indexOf(n.nodeName);
    children(sheet)
      .sort(
        (a, b) => (rank(a) < 0 ? 99 : rank(a)) - (rank(b) < 0 ? 99 : rank(b)),
      )
      .forEach((n) => sheet.appendChild(n));
    const output = xml.tostring();
    validated(output, !args.component);
    return { definition: output };
  }
  throw new Error(`Unknown native tool ${name}.`);
}
(globalThis as any).TinyCADChatNative = { nativeTool };
