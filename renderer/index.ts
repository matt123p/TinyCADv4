import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server.browser';
import Clientsymbol from './Clientsymbol';
import {
  parseClientsymbolDocument,
  StandaloneClientsymbolSvg,
} from './Clientsymbol';

const runtimeGlobal =
  typeof globalThis !== 'undefined' ? (globalThis as any) : Function('return this')();

export function renderTinyCadSymbolSvg(doc: string): string {
  const parsed = parseClientsymbolDocument(doc);

  if (!parsed) {
    return '';
  }

  return renderToStaticMarkup(
    React.createElement(StandaloneClientsymbolSvg, { parsed }),
  );
}

runtimeGlobal.Clientsymbol = Clientsymbol;
runtimeGlobal.renderTinyCadSymbolSvg = renderTinyCadSymbolSvg;
runtimeGlobal.TinyCADServerBundle = Object.freeze({
  Clientsymbol,
  renderTinyCadSymbolSvg,
});

export default Clientsymbol;
