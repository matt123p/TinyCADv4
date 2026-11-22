import { XMLBuilder } from '../util/xmlbuilder';

type Values = Record<string, unknown>;
interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: (XmlElement | string)[];
  formatChildren?: boolean;
}

interface XmlExtensions {
  attributes: Record<string, string>;
  elements: XmlElement[];
}

type Scalar = 'string' | 'integer' | 'number' | 'boolean';
type Attributes = Record<string, Scalar | readonly [Scalar, string]>;
interface Field {
  name: string;
  codec?: RecordCodec;
  itemName?: string;
}
type Fields = Record<string, Field>;

const extensionKey = 'dpnXmlExtensions';
const propertiesTag = 'PROPERTY';
const xmlName = /^[\p{L}_:][\p{L}\p{N}\p{M}_.:-]*$/u;
const invalidXmlCharacter =
  /[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/u;

function escapeXml(value: string, attribute = false): string {
  if (invalidXmlCharacter.test(value))
    throw new Error('PCB XML contains an invalid XML character.');
  const escaped = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;');
  return attribute
    ? escaped
        .replace(/"/g, '&quot;')
        .replace(/\t/g, '&#9;')
        .replace(/\n/g, '&#10;')
    : escaped;
}

function* writeElement(element: XmlElement, depth = 0): Generator<string> {
  if (depth > 48 || !xmlName.test(element.name))
    throw new Error('Invalid or overly nested PCB XML element.');
  yield '<' + element.name;
  for (const [name, value] of Object.entries(element.attributes)) {
    if (!xmlName.test(name) || typeof value !== 'string')
      throw new Error('Invalid PCB XML attribute.');
    yield ` ${name}="${escapeXml(value, true)}"`;
  }
  if (!element.children.length) {
    yield '/>';
    return;
  }
  yield '>';
  for (const child of element.children) {
    if (typeof child === 'string') yield escapeXml(child);
    else {
      if (element.formatChildren) yield '\n' + '  '.repeat(depth + 1);
      yield* writeElement(child, depth + 1);
    }
  }
  if (element.formatChildren) yield '\n' + '  '.repeat(depth);
  yield '</' + element.name + '>';
}

export function writeBoardXml(root: XmlElement): string {
  const header = '<?xml version="1.0" encoding="UTF-8"?>\n';
  return header + [...writeElement(root)].join('') + '\n';
}

function elementFromDom(node: Element, depth = 0): XmlElement {
  checkDepth(depth);
  const children: XmlElement['children'] = [];
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 1)
      children.push(elementFromDom(child as Element, depth + 1));
    else if (child.nodeType === 3 || child.nodeType === 4)
      children.push(child.nodeValue);
    else if (child.nodeType !== 8) throw new Error('Unsupported PCB XML node.');
  }
  return {
    name: node.nodeName,
    attributes: Object.fromEntries(
      Array.from(node.attributes, ({ name, value }) => [name, value]),
    ),
    children,
  };
}

export function readBoardXml(text: string): Element {
  if (invalidXmlCharacter.test(text) || /<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error('Invalid PCB XML.');
  const xml = new XMLBuilder();
  xml.fromText(text);
  const document: Document = xml.xmlDoc;
  if (
    document.documentElement?.nodeName !== 'TinyCADPCB' ||
    document.getElementsByTagName('parsererror').length ||
    Array.from(document.childNodes).some(
      (node) =>
        node.nodeType !== 8 &&
        node !== document.documentElement &&
        !(node.nodeType === 3 && !node.nodeValue.trim()) &&
        !(
          node.nodeType === 7 &&
          (node as ProcessingInstruction).target === 'xml'
        ),
    )
  )
    throw new Error('Expected a TinyCADPCB XML document.');
  return document.documentElement;
}

function attributeNames(fields: Attributes) {
  return Object.entries(fields).map(([key, field]) => {
    const [type, name] =
      typeof field === 'string'
        ? [field, key.replace(/[A-Z]/g, (letter) => '_' + letter.toLowerCase())]
        : field;
    return { key, type, name };
  });
}

function parseAttribute(text: string, type: Scalar) {
  if (type === 'string') return text;
  if (type === 'boolean') {
    if (text === 'true' || text === 'false') return text === 'true';
  } else {
    const pattern =
      type === 'integer' ? /^-?\d+$/ : /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;
    const value = Number(text);
    if (
      pattern.test(text) &&
      (type === 'integer'
        ? Number.isSafeInteger(value)
        : Number.isFinite(value))
    )
      return value;
  }
  throw new Error(`Invalid PCB XML ${type} value: ${text.slice(0, 80)}`);
}

function checkDepth(depth: number) {
  if (depth > 48) throw new Error('PCB XML is nested too deeply.');
}

function* objectNodes(element: Element, depth: number): Generator<Element> {
  checkDepth(depth);
  for (let node = element.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1) yield node as Element;
    else if (node.nodeType === 3 || node.nodeType === 4) {
      if (node.nodeValue.trim())
        throw new Error(`Unexpected text in PCB XML ${element.nodeName}.`);
    } else if (node.nodeType !== 8) throw new Error('Unsupported PCB XML node.');
  }
}

function textOf(element: Element, depth: number): string {
  checkDepth(depth);
  let text = '';
  for (let node = element.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 3 || node.nodeType === 4) text += node.nodeValue;
    else if (node.nodeType === 1)
      throw new Error(`Unexpected element in PCB XML ${element.nodeName}.`);
    else if (node.nodeType !== 8) throw new Error('Unsupported PCB XML node.');
  }
  return text;
}

function readField(element: Element, codec: RecordCodec | undefined, depth: number) {
  if (codec) return codec.read(element, depth);
  if (element.attributes.length)
    throw new Error(`Unexpected PCB XML attributes on ${element.nodeName}.`);
  return textOf(element, depth);
}

function textElement(name: string, value: string): XmlElement {
  if (typeof value !== 'string')
    throw new Error(`PCB XML ${name} requires text.`);
  return { name, attributes: {}, children: [value] };
}

export interface RecordCodec {
  write(name: string, data: object): XmlElement;
  read(element: Element, depth?: number): Values;
}

export function child(name: string, codec?: RecordCodec): Field {
  return { name, codec };
}

export function list(
  name: string,
  itemName: string,
  codec?: RecordCodec,
): Field {
  return { name, itemName, codec };
}

export function record(
  attributes: Attributes = {},
  fields: Fields = {},
): RecordCodec {
  const attributesByKey = attributeNames(attributes);
  const knownAttributes = new Set(attributesByKey.map(({ name }) => name));
  const fieldsByName = new Map(
    Object.entries(fields).map(([key, field]) => [
      field.name,
      { key, ...field },
    ]),
  );
  return {
    write(name, data) {
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new Error(`Expected a PCB XML ${name} record.`);
      const remaining: Values = { ...data };
      const element: XmlElement = {
        name,
        attributes: {},
        children: [],
        formatChildren: true,
      };
      for (const { key, name, type } of attributesByKey) {
        const value = remaining[key];
        delete remaining[key];
        if (value === undefined) continue;
        if (
          (type === 'string' && typeof value !== 'string') ||
          (type === 'boolean' && typeof value !== 'boolean') ||
          (type === 'integer' && !Number.isSafeInteger(value)) ||
          (type === 'number' && !Number.isFinite(value))
        )
          throw new Error(`Invalid PCB XML ${name} attribute.`);
        element.attributes[name] = String(value);
      }
      for (const [key, field] of Object.entries(fields)) {
        const value = remaining[key];
        delete remaining[key];
        if (value === undefined) continue;
        const write = (name: string, item: string | object) =>
          field.codec
            ? field.codec.write(name, item as object)
            : textElement(name, item as string);
        if (field.itemName) {
          if (!Array.isArray(value))
            throw new Error(`Invalid PCB XML ${field.name} list.`);
          element.children.push({
            name: field.name,
            attributes: {},
            children: value.map((item) => write(field.itemName, item)),
            formatChildren: true,
          });
        } else
          element.children.push(write(field.name, value as string | object));
      }
      const extensions = remaining[extensionKey] as XmlExtensions | undefined;
      delete remaining[extensionKey];
      for (const key of Object.keys(remaining).sort()) {
        const property = textElement(
          propertiesTag,
          JSON.stringify(remaining[key]),
        );
        property.attributes.name = key;
        element.children.push(property);
      }
      if (extensions) {
        for (const [key, value] of Object.entries(extensions.attributes).sort(
          ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
        )) {
          if (knownAttributes.has(key))
            throw new Error(`Conflicting PCB XML attribute: ${key}`);
          Object.defineProperty(element.attributes, key, {
            value,
            enumerable: true,
          });
        }
        for (const child of extensions.elements) {
          if (fieldsByName.has(child.name) || child.name === propertiesTag)
            throw new Error(`Conflicting PCB XML element: ${child.name}`);
          element.children.push(child);
        }
      }
      return element;
    },
    read(element, depth = 0) {
      const data: Values = Object.create(null);
      for (const { key, name, type } of attributesByKey) {
        if (element.hasAttribute(name))
          data[key] = parseAttribute(element.getAttribute(name), type);
      }
      let extensions: XmlExtensions | undefined;
      function unknownFields() {
        return extensions ??= { attributes: {}, elements: [] };
      }
      for (let i = 0; i < element.attributes.length; i++) {
        const { name, value } = element.attributes.item(i);
        if (!knownAttributes.has(name))
          Object.defineProperty(unknownFields().attributes, name, { value, enumerable: true });
      }
      for (const node of objectNodes(element, depth)) {
        const { nodeName } = node;
        const field = fieldsByName.get(nodeName);
        if (!field) {
          if (nodeName === propertiesTag) {
            const key = node.getAttribute('name');
            if (
              !node.hasAttribute('name') ||
              node.attributes.length !== 1 ||
              key === extensionKey ||
              Object.hasOwn(fields, key) ||
              Object.hasOwn(attributes, key) ||
              Object.hasOwn(data, key)
            )
              throw new Error('Invalid or duplicate PCB XML property.');
            data[key] = JSON.parse(textOf(node, depth + 1));
          } else {
            if (
              nodeName === 'REQUIREDFEATURE' ||
              node.getAttribute('required') === 'true'
            )
              throw new Error(
                `Unsupported required PCB XML element: ${nodeName}`,
              );
            unknownFields().elements.push(elementFromDom(node, depth + 1));
          }
          continue;
        }
        const { key, itemName, codec } = field;
        if (Object.hasOwn(data, key))
          throw new Error(`Duplicate PCB XML element: ${nodeName}`);
        if (itemName) {
          if (node.attributes.length)
            throw new Error(`Unexpected PCB XML attributes on ${nodeName}.`);
          const items: (string | Values)[] = [];
          for (const item of objectNodes(node, depth + 1)) {
            if (item.nodeName !== itemName)
              throw new Error(
                `Unexpected PCB XML element in ${nodeName}: ${item.nodeName}`,
              );
            items.push(readField(item, codec, depth + 2));
          }
          data[key] = items;
        } else data[key] = readField(node, codec, depth + 1);
      }
      if (extensions) data[extensionKey] = extensions;
      return data;
    },
  };
}
