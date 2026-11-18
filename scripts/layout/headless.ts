import { XMLBuilder } from '../../src/util/xmlbuilder';

export function initialiseLayoutRuntime() {
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({
        font: '10px Arial',
        measureText(text) {
          const size = parseFloat(this.font) || 10;
          return {
            width: String(text).length * size * 0.52,
            actualBoundingBoxDescent: size * 0.22,
          };
        },
      }),
    }),
  } as any;
  const create = XMLBuilder.prototype.createDoc;
  XMLBuilder.prototype.createDoc = function (name) {
    create.call(this, name);
    this.insert = this.xmlDoc.documentElement;
  };
  const serialise = XMLBuilder.prototype.tostring;
  XMLBuilder.prototype.tostring = function () {
    function strings(n) {
      if (n.attributes)
        for (let i = 0; i < n.attributes.length; i++)
          n.attributes[i].value = String(n.attributes[i].value);
      if (n.nodeType === 3 || n.nodeType === 4) n.data = String(n.data);
      for (let c = n.firstChild; c; c = c.nextSibling) strings(c);
    }
    strings(this.xmlDoc);
    return serialise.call(this);
  };
}
