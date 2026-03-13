import * as XMLFeatures from 'common-xml-features';
import { Coordinate } from '../model/dsnItem';

//
// The xml service
//
export class XMLBuilder {
  public xmlDoc: any;
  public insert: any;

  static componentToHex(c: number): string {
    let hex = c.toString(16).toUpperCase();
    return hex.length === 1 ? '0' + hex : hex;
  }

  constructor() {}

  createDoc(node_name: string) {
    let parser = new XMLFeatures.DOMParser();
    // ?? parser.preserveWhiteSpace = true;
    this.xmlDoc = parser.parseFromString(
      '<?xml version="1.0" encoding="utf-8"?><' +
        node_name +
        '></' +
        node_name +
        '>',
      'text/xml',
    );
    this.insert = this.xmlDoc.childNodes[0];
  }

  fromXML(xml: Document) {
    this.xmlDoc = xml;
  }

  fromText(text: string) {
    let parser = new XMLFeatures.DOMParser();
    this.xmlDoc = parser.parseFromString(text, 'text/xml');
  }

  tostring(): string {
    let serializer = new XMLFeatures.XMLSerializer();
    return serializer.serializeToString(this.xmlDoc);
  }

  //
  // Read in from a XML document
  //
  getElementsByTagName(node_name: string): any {
    return this.xmlDoc.getElementsByTagName(node_name);
  }

  //
  // Create a child tag to append some data into
  //
  appendChild(node_name: string, s?: string, attributes?: any) {
    let node = this.xmlDoc.createElement(node_name);

    if (attributes) {
      for (let a in attributes) {
        if (attributes.hasOwnProperty(a)) {
          const typ = this.xmlDoc.createAttribute(a);
          typ.value = attributes[a];
          node.attributes.setNamedItem(typ);
        }
      }
    }

    if (s) {
      node.appendChild(this.xmlDoc.createTextNode(s));
    }

    this.insert.appendChild(node);

    let r = new XMLBuilder();
    r.insert = node;
    r.xmlDoc = this.xmlDoc;
    return r;
  }

  appendChildren(child_nodes: any) {
    for (let k in child_nodes) {
      if (child_nodes.hasOwnProperty(k)) {
        this.appendChild(k, child_nodes[k]);
      }
    }
  }

  createElement(node_name: string): XMLBuilder {
    let r = new XMLBuilder();
    r.insert = this.xmlDoc.createElement(node_name);
    r.xmlDoc = this.xmlDoc;
    return r;
  }

  makeCoords(c: Coordinate): string {
    return c[0] / 5 + ',' + c[1] / 5;
  }

  makeRotation1(r: number): number {
    switch (r) {
      case 2: // Up
        return 0;
      case 0: // Down
        return 1;
      case 3: // Left
        return 2;
      case 1: // Right
        return 3;
    }
    return 0;
  }

  makeRotation2(r: number): number {
    switch (r) {
      case 3: // Up
        return 0;
      case 1: // Down
        return 1;
      case 2: // Left
        return 2;
      case 0: // Right
        return 3;
    }

    return 0;
  }

  makeColor(c: string) {
    if (!c || c.length < 1) {
      return null;
    }
    let i = parseInt(c.substr(1), 16);
    // tslint:disable-next-line: no-bitwise
    let b = i & 255;
    // tslint:disable-next-line: no-bitwise
    let g = (i >> 8) & 255;
    // tslint:disable-next-line: no-bitwise
    let r = (i >> 16) & 255;
    return (
      XMLBuilder.componentToHex(b) +
      XMLBuilder.componentToHex(g) +
      XMLBuilder.componentToHex(r)
    );
  }
}
