import React, { FunctionComponent } from 'react';

import { ioXML } from '../src/io/ioXml';
import { XMLBuilder } from '../src/util/xmlbuilder';
import { Snap } from '../src/manipulators/snap';
import { dsnSheet } from '../src/model/dsnDrawing';
import { DocItem } from '../src/model/dsnItem';
import { updateFactory } from '../src/manipulators/updateFactory';
import TSvgDefs from '../src/components/svg/SvgDefs';
import ServerDrawing from './ServerDrawing';

const STANDALONE_SVG_WIDTH = 128;
const STANDALONE_SVG_HEIGHT = 128;

export interface ClientsymbolProps {
  doc: string;
}

export interface ParsedClientsymbolDocument {
  sheet: dsnSheet;
  outline: ReturnType<ioXML['normalize_symbol']>;
}

export function parseClientsymbolDocument(
  xmlText: string,
): ParsedClientsymbolDocument | null {
  if (!xmlText) {
    return null;
  }

  try {
    const xml = new XMLBuilder();
    xml.fromText(xmlText);

    const io = new ioXML();
    const drawing = io.from_dsn(xml);
    const sheet = drawing?.sheets?.[0];
    if (!sheet || sheet.items.length === 0) {
      return null;
    }

    const snap = new Snap(sheet.details.grid, sheet.details.grid_snap);
    const outline = io.normalize_symbol(sheet.items, snap, [0, 0], false, false);

    return {
      sheet,
      outline,
    };
  } catch {
    return null;
  }
}

interface StandaloneClientsymbolSvgProps {
  parsed: ParsedClientsymbolDocument;
  width?: number;
  height?: number;
}

interface SymbolBounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function getSymbolBounds(items: DocItem[]): SymbolBounds | null {
  let bounds: SymbolBounds | null = null;

  for (const item of items) {
    const updater = updateFactory(item);
    if (!updater) {
      continue;
    }

    const rect = updater.getBoundingRect();
    if (!bounds) {
      bounds = {
        x1: rect.x1,
        y1: rect.y1,
        x2: rect.x2,
        y2: rect.y2,
      };
      continue;
    }

    bounds.x1 = Math.min(bounds.x1, rect.x1);
    bounds.y1 = Math.min(bounds.y1, rect.y1);
    bounds.x2 = Math.max(bounds.x2, rect.x2);
    bounds.y2 = Math.max(bounds.y2, rect.y2);
  }

  return bounds;
}

export const StandaloneClientsymbolSvg: FunctionComponent<
  StandaloneClientsymbolSvgProps
> = ({
  parsed,
  width = STANDALONE_SVG_WIDTH,
  height = STANDALONE_SVG_HEIGHT,
}: StandaloneClientsymbolSvgProps) => {
  const { sheet } = parsed;
  const bounds = getSymbolBounds(sheet.items);

  const contentWidth = Math.max((bounds?.x2 ?? 0) - (bounds?.x1 ?? 0), 1);
  const contentHeight = Math.max((bounds?.y2 ?? 0) - (bounds?.y1 ?? 0), 1);
  const scale = Math.min(1, width / contentWidth, height / contentHeight);
  const viewBoxWidth = width / scale;
  const viewBoxHeight = height / scale;
  const centerX = bounds ? (bounds.x1 + bounds.x2) / 2 : 0;
  const centerY = bounds ? (bounds.y1 + bounds.y2) / 2 : 0;
  const viewBoxX = centerX - viewBoxWidth / 2;
  const viewBoxY = centerY - viewBoxHeight / 2;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      width={width}
      height={height}
      viewBox={`${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <TSvgDefs images={sheet.images} hatches={sheet.hatches} />
      <g transform="translate(0.5,0.5)">
        <ServerDrawing
          dx={0}
          dy={0}
          dr={0}
          part={0}
          show_power={false}
          scale_x={1}
          scale_y={1}
          parent={null}
          heterogeneous={false}
          items={sheet.items}
          options={sheet.options}
        />
      </g>
    </svg>
  );
};

const Clientsymbol: FunctionComponent<ClientsymbolProps> = (
  props: ClientsymbolProps,
) => {
  const parsed = parseClientsymbolDocument(props.doc);

  if (!parsed) {
    return <div className="circuit-drawing" />;
  }

  return (
    <div className="circuit-drawing">
      <StandaloneClientsymbolSvg parsed={parsed} />
    </div>
  );
};

export default Clientsymbol;
