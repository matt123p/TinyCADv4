import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ServerDrawing from '../../renderer/ServerDrawing';
import SvgDefs from '../../src/components/svg/SvgDefs';
import { dsnSheet } from '../../src/model/dsnDrawing';
import {
  bodyRect,
  rect,
  texts,
  union,
  refresh,
} from '../../src/layout/geometry';
export * from '../../src/layout';
export {
  pins,
  bodyRect,
  texts,
  symbolArtwork,
  refresh,
  settings,
  movable,
} from '../../src/layout/geometry';
export { wireBundles, wirePaths, wireSpans } from '../../src/layout/bundles';
export { labelGroups } from '../../src/layout/labelGroups';
export { blank } from '../../src/io/ioXml';
export {
  decodeDrawing,
  encodeDrawing,
  initialiseGenerator,
  renderTeachingSheet,
} from '../teaching/LessonBuilder';
export { updateSymbol } from '../../src/manipulators/updateSymbol';

export function circuitBounds(sheet: dsnSheet) {
  return union(
    sheet.items
      .filter((i) =>
        ['symbol', 'wire', 'label', 'power', 'junction', 'noconnect'].includes(
          i.NodeName,
        ),
      )
      .flatMap((i) =>
        [
          bodyRect(i),
          ...texts(i),
          ...('d_points' in i ? i.d_points.map((p) => rect(p, p)) : []),
        ].filter(Boolean),
      ),
  );
}
export function renderCircuit(sheet: dsnSheet, bounds = circuitBounds(sheet)) {
  const items = sheet.items
    .filter((i) =>
      ['symbol', 'wire', 'label', 'power', 'junction', 'noconnect'].includes(
        i.NodeName,
      ),
    )
    .map(refresh);
  const width = Math.max(100, bounds.x2 - bounds.x1 + 40),
    height = Math.max(100, bounds.y2 - bounds.y1 + 40);
  return renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`${bounds.x1 - 20} ${bounds.y1 - 20} ${width} ${height}`}
    >
      <rect
        x={bounds.x1 - 20}
        y={bounds.y1 - 20}
        width={width}
        height={height}
        fill="white"
      />
      <SvgDefs images={sheet.images} hatches={sheet.hatches} />
      <ServerDrawing
        dx={0}
        dy={0}
        dr={0}
        scale_x={1}
        scale_y={1}
        part={0}
        show_power={false}
        heterogeneous={false}
        parent={null}
        items={items}
        options={sheet.options}
      />
    </svg>,
  );
}
