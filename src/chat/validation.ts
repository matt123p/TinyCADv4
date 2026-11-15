import { XMLBuilder } from '../util/xmlbuilder';
import schemaSource from './skill/schema.json';
import drawingSchemaSource from './skill/drawing-schema.json';

type Rule = {
  kind: string;
  name?: string;
  type?: string;
  base?: string;
  use?: string;
  minOccurs?: string;
  maxOccurs?: string;
  children: Rule[];
};

export interface Issue {
  code: string;
  path: string;
  message: string;
  line: number;
  column: number;
}
export const children = (n: any): any[] =>
  Array.from(n.childNodes || []).filter((c: any) => c.nodeType === 1);
const descendants = (n: any): any[] => [n, ...children(n).flatMap(descendants)];
export function parseXml(xml: string, drawing: boolean) {
  if (
    typeof xml !== 'string' ||
    !xml.trim() ||
    new TextEncoder().encode(xml).length > (drawing ? 1048576 : 262144)
  )
    throw new Error(
      'Supply non-empty XML within the 1 MiB drawing / 256 KiB symbol limit.',
    );
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(xml))
    throw new Error('DTDs and entities are not supported.');
  // Bound depth before parsing to avoid recursive DOM construction on hostile input.
  let depth = 0,
    count = 0;
  for (const token of xml.matchAll(
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>/g,
  )) {
    const t = token[0];
    if (/^<[!?]/.test(t)) continue;
    if (t.startsWith('</')) depth--;
    else {
      count++;
      if (!t.endsWith('/>')) depth++;
    }
    if (depth > (drawing ? 24 : 16) || count > (drawing ? 16384 : 4096))
      throw new Error('XML complexity limit exceeded.');
  }
  const b = new XMLBuilder();
  b.fromText(xml);
  const root = b.xmlDoc.documentElement;
  if (
    !root ||
    b.getElementsByTagName('parsererror').length ||
    root.namespaceURI ||
    !(drawing ? ['TinyCAD', 'TinyCADSheets'] : ['TinyCAD']).includes(
      root.nodeName,
    )
  )
    throw new Error('Expected well-formed TinyCAD XML without namespaces.');
  return b;
}
export function validateXml(
  xml: string,
  drawing = false,
  librarySymbol = false,
) {
  const schema = (drawing ? drawingSchemaSource : schemaSource) as Rule;
  const types = new Map(
    schema.children
      .filter((r) => r.kind === 'complexType')
      .map((r) => [r.name, r]),
  );
  const errors: Issue[] = [];
  const path = (n: any): string =>
    n?.nodeType === 1
      ? `${path(n.parentNode)}/${n.nodeName}[${
          children(n.parentNode)
            .filter((c) => c.nodeName === n.nodeName)
            .indexOf(n) + 1
        }]`
      : '';
  const add = (code: string, n: any, message: string) => {
    if (errors.length < 100)
      errors.push({ code, path: path(n) || '/', message, line: 0, column: 0 });
  };
  let b: XMLBuilder;
  try {
    b = parseXml(xml, drawing);
  } catch (e) {
    add('invalid_xml', null, e instanceof Error ? e.message : 'Invalid XML');
    return { valid: false, errors };
  }
  const root = b.xmlDoc.documentElement;
  const scalar = (value: string, type: string) => {
    if (type === 'xs:string') return true;
    const range =
      type === 'xs:byte'
        ? [-128, 127]
        : type === 'xs:unsignedByte'
        ? [0, 255]
        : [0, 4294967295];
    return (
      /^[+-]?\d+$/.test(value) &&
      Number(value) >= range[0] &&
      Number(value) <= range[1]
    );
  };
  const checkType = (n: any, type: string) => {
    if (type?.startsWith('xs:')) {
      if (!scalar(n.textContent, type))
        add('schema', n, `Invalid ${type} value.`);
      return;
    }
    const r = types.get(type);
    if (!r) {
      add('schema', n, `Unsupported element type ${type}.`);
      return;
    }
    const extension = r.children.find((c) => c.kind === 'simpleContent')
      ?.children[0];
    const attrs = (extension || r).children.filter(
      (c) => c.kind === 'attribute',
    );
    for (const a of attrs) {
      const optional =
        drawing &&
        ((type === 'pinType' && a.name === 'centre_name') ||
          (type === 'symbolType' &&
            ['scale_x', 'scale_y', 'can_scale', 'show_power'].includes(
              a.name,
            )));
      if (!n.hasAttribute(a.name)) {
        if (a.use === 'required' && !optional)
          add('schema', n, `Missing required attribute ${a.name}.`);
      } else if (!scalar(n.getAttribute(a.name), a.type))
        add('schema', n, `Invalid ${a.type} attribute ${a.name}.`);
    }
    for (const a of Array.from(n.attributes || []) as any[]) {
      if (
        !attrs.some((r) => r.name === a.name) &&
        !(drawing && type === 'wireType' && a.name === 'net_type')
      )
        add('schema', n, `Unknown attribute ${a.name}.`);
    }
    let rules = r.children.filter((c) =>
      ['sequence', 'choice', 'all'].includes(c.kind),
    );
    const kids = children(n);
    let offset = 0;
    const matches = (rule: Rule, node: any): boolean =>
      rule.kind === 'any' ||
      (rule.kind === 'element'
        ? rule.name === node?.nodeName
        : rule.children.some((c) => matches(c, node)));
    const consume = (rule: Rule): void => {
      const optional =
        drawing &&
        ((type === 'symbolDefType' &&
          ['GUID', 'REF_POINT'].includes(rule.name)) ||
          (type === 'detailsType' && rule.name === 'GUIDES'));
      const min = optional ? 0 : Number(rule.minOccurs ?? 1);
      const max =
        rule.maxOccurs === 'unbounded' ? Infinity : Number(rule.maxOccurs ?? 1);
      if (rule.kind === 'sequence') {
        rule.children.forEach(consume);
        return;
      }
      if (rule.kind === 'all') {
        const seen = new Set<string>();
        while (offset < kids.length) {
          const next = rule.children.find((c) => matches(c, kids[offset]));
          if (!next || seen.has(next.name)) break;
          seen.add(next.name);
          checkType(kids[offset++], next.type);
        }
        for (const c of rule.children)
          if ((c.minOccurs ?? '1') !== '0' && !seen.has(c.name))
            add('schema', n, `Missing ${c.name}.`);
        return;
      }
      let used = 0;
      while (
        offset < kids.length &&
        used < max &&
        matches(rule, kids[offset])
      ) {
        if (rule.kind === 'element') checkType(kids[offset++], rule.type);
        else if (rule.kind === 'any') offset++;
        else {
          const next = rule.children.find((c) => matches(c, kids[offset]));
          if (next.kind === 'element') checkType(kids[offset++], next.type);
          else consume(next);
        }
        used++;
      }
      if (used < min)
        add(
          'schema',
          n,
          `Expected ${rule.name || rule.kind} child in schema order.`,
        );
    };
    rules.forEach(consume);
    if (offset < kids.length)
      add('schema', kids[offset], 'Unexpected element or wrong child order.');
  };
  checkType(
    root,
    root.nodeName === 'TinyCAD' ? 'tinycad' : 'tinyCadSheetsType',
  );
  const all = descendants(root);
  const scopes = new Map<any, Set<string>>();
  const coordinates: number[][] = [];
  const numeric = (v: string) =>
    v !== null && v.trim() !== '' && Number.isFinite(Number(v));
  for (const n of all) {
    const name = n.nodeName;
    if (
      ['IMAGE', 'METAFILE', 'FONTS', 'STYLES', 'FILLS'].includes(name) ||
      (!drawing && ['SYMBOL', 'SYMBOLDEF', 'TinyCADSheets'].includes(name))
    )
      add(
        'unsupported_element',
        n,
        'Use flattened vector geometry and direct FONT/STYLE/FILL resources.',
      );
    if (
      !children(n).length &&
      n.textContent.length > (name === 'PIN' ? 128 : 1024)
    )
      add('text_length', n, 'Text exceeds the input limit.');
    for (const a of Array.from(n.attributes || []) as any[]) {
      if (a.value.length > (a.name === 'number' ? 32 : 1024))
        add('text_length', n, `Attribute ${a.name} is too long.`);
      if (['pos', 'a', 'b', 'control', 'control2'].includes(a.name)) {
        const pair = a.value.split(',');
        const limit =
          drawing && name === 'FIELD' && n.getAttribute('show') === '0'
            ? 1e9
            : 10000;
        if (
          pair.length !== 2 ||
          pair.some((v: string) => !numeric(v) || Math.abs(Number(v)) > limit)
        )
          add(
            'coordinate_type',
            n,
            'Use two finite comma-separated XML coordinates within ±10000.',
          );
        else if (limit === 10000) coordinates.push(pair.map(Number));
      }
    }
    if (name === 'FONT')
      for (const child of children(n).filter(
        (c) => c.nodeName !== 'FACENAME',
      )) {
        if (
          !numeric(child.textContent) ||
          Math.abs(Number(child.textContent)) > 1000
        )
          add(
            'font_value',
            child,
            'Font numeric fields must be finite values within ±1000 internal units.',
          );
      }
    if (drawing) {
      const range = (
        attr: string,
        min: number,
        max: number,
        integer = true,
      ) => {
        if (n.hasAttribute(attr)) {
          const raw = n.getAttribute(attr),
            value = Number(raw);
          if (
            !numeric(raw) ||
            value < min ||
            value > max ||
            (integer && !Number.isInteger(value))
          )
            add(
              'invalid_type',
              n,
              `${name} ${attr} must be ${
                integer ? 'an integer' : 'a number'
              } ${min}–${max}.`,
            );
        }
      };
      if (name === 'SYMBOL') {
        range('part', 0, 63);
        range('rotate', 0, 7);
        range('show_power', 0, 1);
        range('can_scale', 0, 1);
      }
      if (name === 'FIELD') {
        range('show', 0, 1);
        range('type', 0, 7);
      }
      if (name === 'GRID') {
        range('snap', 0, 1);
        range('spacing', Number.MIN_VALUE, 10000, false);
      }
      if (name === 'Size') {
        range('width', 1, 20000, false);
        range('height', 1, 20000, false);
      }
      if (name === 'GUIDES')
        for (const attr of Array.from(n.attributes) as any[])
          range(attr.name, 1, 100);
    }
    if (name === 'PIN') {
      let scope = n.parentNode,
        ancestor = n.parentNode;
      while (ancestor?.nodeType === 1) {
        if (['TinyCAD', 'HierarchicalSymbol'].includes(ancestor.nodeName))
          scope = ancestor;
        if (ancestor.nodeName === 'SYMBOLDEF') {
          scope = ancestor;
          break;
        }
        ancestor = ancestor.parentNode;
      }
      if (!scopes.has(scope)) scopes.set(scope, new Set());
      const number = (n.getAttribute('number') || '').trim().toLowerCase();
      if (!number) add('pin_number', n, 'Every pin needs its physical number.');
      else if (scopes.get(scope).has(number))
        add('duplicate_pin_number', n, `Duplicate physical pin ${number}.`);
      scopes.get(scope).add(number);
      // Existing library artwork can intentionally leave passive pin labels blank.
      // Require names for newly generated standalone symbols only.
      if (
        !drawing &&
        !librarySymbol &&
        Number(n.getAttribute('show')) & 1 &&
        !n.textContent.trim()
      )
        add('pin_name', n, 'Displayed pin name is blank.');
      const pos = (n.getAttribute('pos') || '').split(',').map(Number);
      if (pos.some((v: number) => !Number.isInteger(v)))
        add(
          'pin_off_grid',
          n,
          'Hotspots must have integer XML coordinates (1 XML = 5 internal units).',
        );
      for (const [a, max] of Object.entries({
        which: 10,
        elec: 11,
        direction: 3,
        show: 3,
        centre_name: 1,
        part: 255,
      })) {
        if (
          n.hasAttribute(a) &&
          (!numeric(n.getAttribute(a)) ||
            !Number.isInteger(Number(n.getAttribute(a))) ||
            Number(n.getAttribute(a)) < 0 ||
            Number(n.getAttribute(a)) > max)
        )
          add('invalid_type', n, `${a} must be an integer 0–${max}.`);
      }
      for (const a of ['length', 'number_pos']) {
        const v = Number(n.getAttribute(a));
        if (
          !Number.isInteger(v) ||
          v < (a === 'length' ? 0 : -1000) ||
          v > 1000
        )
          add(
            'pin_geometry',
            n,
            `${a} must be an integer within its internal-unit bounds (±1000; length nonnegative).`,
          );
      }
    }
  }
  if (
    coordinates.length &&
    [0, 1].some(
      (axis) =>
        Math.max(...coordinates.map((p) => p[axis])) -
          Math.min(...coordinates.map((p) => p[axis])) >
        10000,
    )
  )
    add(
      'component_size',
      root,
      'Total geometry width/height must not exceed 10000 XML units.',
    );
  const sheetNames = new Set<string>();
  const sheets =
    root.nodeName === 'TinyCAD'
      ? [root]
      : children(root).filter((n) =>
          ['TinyCAD', 'HierarchicalSymbol'].includes(n.nodeName),
        );
  if (drawing && (!sheets.length || sheets.length > 16))
    add('sheet_count', root, 'Use 1–16 sheets.');
  for (const sheet of sheets) {
    if (drawing) {
      const name =
        children(sheet).find((n) => n.nodeName === 'NAME')?.textContent ??
        'Sheet';
      if (!name.trim() || sheetNames.has(name.toLowerCase()))
        add(
          'sheet_name',
          sheet,
          'Every drawing sheet needs a unique nonempty NAME.',
        );
      sheetNames.add(name.toLowerCase());
    }
    for (const kind of ['font', 'style', 'fill']) {
      const resources = children(sheet).filter(
        (n) => n.nodeName === kind.toUpperCase(),
      );
      const ids = new Set<string>();
      for (const resource of resources) {
        const id = resource.getAttribute('id');
        if (ids.has(id))
          add('duplicate_id', resource, `Duplicate ${kind} ID ${id}.`);
        ids.add(id);
      }
      for (const n of descendants(sheet))
        if (
          n.hasAttribute(kind) &&
          !ids.has(n.getAttribute(kind)) &&
          !(kind === 'fill' && n.getAttribute(kind) === '0') &&
          !(kind === 'style' && n.nodeName === 'LABEL')
        )
          add(
            'missing_reference',
            n,
            `Define ${kind.toUpperCase()} id="${n.getAttribute(
              kind,
            )}" directly on the outer sheet, in FONT → STYLE → FILL order. Read references/file-format.md for complete resource XML.`,
          );
    }
    if (drawing) {
      const defs = children(sheet).filter((n) => n.nodeName === 'SYMBOLDEF');
      const ids = new Set<string>();
      for (const def of defs) {
        const id = def.getAttribute('id');
        if (!/^(0|[1-9]\d*)$/.test(id || '') || Number(id) > 1000000)
          add(
            'symbol_id',
            def,
            'SYMBOLDEF IDs must be canonical integers 0–1000000.',
          );
        if (ids.has(id))
          add('duplicate_id', def, `Duplicate SYMBOLDEF id ${id}.`);
        ids.add(id);
        const ppp = children(def).find(
          (n) => n.nodeName === 'PPP',
        )?.textContent;
        if (!/^\d+$/.test(ppp || '') || Number(ppp) < 1 || Number(ppp) > 64)
          add('part_count', def, 'PPP must be 1–64.');
      }
      const placed = children(sheet).filter((n) =>
        [
          'SYMBOL',
          'WIRE',
          'LABEL',
          'POWER',
          'JUNCTION',
          'PIN',
          'BUS',
          'BUSNAME',
          'BUSSLASH',
          'NOCONNECT',
          'POLYGON',
          'RECTANGLE',
          'ELLIPSE',
          'TEXT',
          'NOTE_TEXT',
        ].includes(n.nodeName),
      );
      let expanded = children(sheet).length;
      for (const n of placed.filter((n) => n.nodeName === 'SYMBOL')) {
        const def = defs.find(
          (d) => d.getAttribute('id') === n.getAttribute('id'),
        );
        if (def) expanded += descendants(def).length - 1;
      }
      if (placed.length > 512 || expanded > 8192)
        add(
          'drawing_complexity',
          sheet,
          'Use at most 512 placed items and 8192 expanded XML elements per sheet.',
        );
      for (const n of descendants(sheet)) {
        if (n.nodeName === 'SYMBOL') {
          if (n.parentNode !== sheet)
            add('nested_symbol', n, 'Flatten nested symbol instances.');
          const def = defs.find(
            (d) => d.getAttribute('id') === n.getAttribute('id'),
          );
          if (!def)
            add(
              'missing_reference',
              n,
              'Embed the referenced SYMBOLDEF on this sheet.',
            );
          if (def) {
            const count = Number(
              children(def).find((c) => c.nodeName === 'PPP')?.textContent,
            );
            if (Number(n.getAttribute('part')) >= count)
              add('symbol_part', n, `Part must be 0–${count - 1}.`);
          }
          for (const attr of ['scale_x', 'scale_y'])
            if (
              n.hasAttribute(attr) &&
              (!numeric(n.getAttribute(attr)) ||
                Number(n.getAttribute(attr)) <= 0 ||
                Number(n.getAttribute(attr)) > 10)
            )
              add('symbol_scale', n, 'Scale must be >0 and ≤10.');
          if (
            !children(n).some(
              (c) =>
                c.nodeName === 'FIELD' &&
                c.getAttribute('description') === 'Ref' &&
                c.getAttribute('value')?.trim(),
            )
          )
            add('reference', n, 'Every SYMBOL needs a nonblank Ref FIELD.');
        }
      }
    }
  }
  if (
    !drawing &&
    !children(root).some((n) =>
      [
        'PIN',
        'POLYGON',
        'RECTANGLE',
        'ELLIPSE',
        'WIRE',
        'TEXT',
        'LABEL',
        'JUNCTION',
        'BUS',
        'BUSNAME',
        'BUSSLASH',
        'NOCONNECT',
        'POWER',
        'NOTE_TEXT',
      ].includes(n.nodeName),
    )
  )
    add('empty_symbol', root, 'Add at least one drawable element.');
  return { valid: errors.length === 0, errors };
}
