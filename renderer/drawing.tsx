import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server.browser';
import { ioXML } from '../src/io/ioXml';
import { XMLBuilder } from '../src/util/xmlbuilder';
import { dsnDrawing, dsnSheet } from '../src/model/dsnDrawing';
import { updateFactory } from '../src/manipulators/updateFactory';
import { updateDrawing } from '../src/manipulators/updateDrawing';
import { NetlistGenerator } from '../src/io/netlists/netlistGenerator';
import { makeNetForDrawing } from '../src/web-worker/netlist';
import { analyseLayout, optimiseLayout, sameConnectivity } from '../src/layout';
import { LayoutOptions } from '../src/layout/types';
import SvgDefs from '../src/components/svg/SvgDefs';
import DesignDetails from '../src/components/svg/DesignDetails';
import DesignGuides from '../src/components/svg/DesignGuides';
import ServerDrawing from './ServerDrawing';
import { resetServerIds } from './serverGlobalId';

function parseDrawing(xml: string): dsnDrawing {
  if (!xml || xml.length > 1024 * 1024 || /<!\s*(DOCTYPE|ENTITY)/i.test(xml))
    throw new Error('Supply drawing XML up to 1 MiB without DTDs or entities.');
  resetServerIds();
  const builder = new XMLBuilder();
  builder.fromText(xml);
  const root = builder.xmlDoc.documentElement;
  if (
    !root ||
    !['TinyCAD', 'TinyCADSheets'].includes(root.nodeName) ||
    builder.getElementsByTagName('parsererror').length
  )
    throw new Error('Expected TinyCAD or TinyCADSheets drawing XML.');
  const drawing = new ioXML().from_dsn(builder);
  if (!drawing.sheets.length || drawing.sheets.length > 16)
    throw new Error('Drawings must have 1–16 sheets.');
  for (const sheet of drawing.sheets) {
    if (sheet.items.length > 512)
      throw new Error('Maximum 512 items per sheet.');
    for (const item of sheet.items) {
      if (item.NodeName === 'symbol') {
        if (!item.text.some((t) => t.description === 'Ref' && t.value))
          throw new Error(
            `Symbol ${item._id} on '${sheet.name}' needs a non-empty Ref field.`,
          );
        if (
          !item._symbol?.outlines?.length ||
          !Number.isInteger(item.part) ||
          item.part < 0 ||
          item.part >= item._symbol.parts
        )
          throw new Error(
            `Symbol ${item._id} has an invalid definition or part index.`,
          );
      }
    }
  }
  return drawing;
}

function selectedSheet(drawing: dsnDrawing, sheet: number): dsnSheet {
  if (!Number.isInteger(sheet) || sheet < 1 || sheet > drawing.sheets.length)
    throw new Error(`sheet must be from 1 to ${drawing.sheets.length}.`);
  return drawing.sheets[sheet - 1];
}

function netlist(drawing: dsnDrawing) {
  const result = new NetlistGenerator();
  makeNetForDrawing(drawing, result);
  return result;
}

// Serialization regenerates editor item IDs. Compare electrical terminals by
// reference, part and pin, and named ports, rather than those temporary IDs.
function terminalSignature(drawing: dsnDrawing) {
  return JSON.stringify(
    Object.values(netlist(drawing).nets)
      .map((nodes) =>
        [
          ...new Set(
            nodes.flatMap((node) =>
              node.symbol
                ? [
                    `pin:${node.sheet}:${node.reference}:${node.symbol.part}:${node.pin}`,
                  ]
                : node.parent &&
                  ['label', 'power', 'noconnect'].includes(node.parent.NodeName)
                ? [`${node.parent.NodeName}:${node.sheet}:${node.label || ''}`]
                : [],
            ),
          ),
        ].sort(),
      )
      .filter((nodes) => nodes.length)
      .map((nodes) => JSON.stringify(nodes))
      .sort(),
  );
}

function compactAnalysis(analysis: ReturnType<typeof analyseLayout>) {
  return {
    ...analysis,
    diagnostics: analysis.diagnostics.slice(0, 100),
    diagnosticsTruncated: analysis.diagnostics.length > 100,
  };
}

function check(drawing: dsnDrawing) {
  const drc = new updateDrawing().designRulesCheck(
    drawing,
    drawing.drc,
    netlist(drawing),
  );
  const errors = drc.slice(0, 100).map((error) => ({
    code: 'design_rule',
    sheet: error.sheet,
    itemId: error.id,
    reference: error.symbol,
    pin: error.pin,
    position: error.a,
    message: error.text,
  }));
  return {
    valid: drc.length === 0,
    structurallyValid: true,
    errorCount: drc.length,
    errors,
    sheets: drawing.sheets.map((sheet, index) => ({
      sheet: index + 1,
      name: sheet.name,
      itemCount: sheet.items.length,
      items: sheet.items.map((item) => ({
        id: item._id,
        type: item.NodeName,
        ...('text' in item && typeof item.text !== 'string'
          ? { reference: item.text.find((t) => t.description === 'Ref')?.value }
          : {}),
      })),
      layout: compactAnalysis(analyseLayout(sheet)),
    })),
  };
}

export function validateTinyCadDrawing(xml: string) {
  return check(parseDrawing(xml));
}

export function renderTinyCadDrawingSvg(
  xml: string,
  sheet = 1,
  view = 'page',
): string {
  const drawing = parseDrawing(xml),
    source = selectedSheet(drawing, sheet);
  if (!['page', 'content'].includes(view))
    throw new Error("view must be 'page' or 'content'.");
  let x = 0,
    y = 0,
    width = source.details.page_size[0],
    height = source.details.page_size[1];
  if (view === 'content') {
    const bounds = source.items
      .map((item) => updateFactory(item)?.getBoundingRect())
      .filter(Boolean);
    x = (bounds.length ? Math.min(...bounds.map((b) => b.x1)) : 0) - 20;
    y = (bounds.length ? Math.min(...bounds.map((b) => b.y1)) : 0) - 20;
    const right =
      (bounds.length ? Math.max(...bounds.map((b) => b.x2)) : 0) + 20;
    const bottom =
      (bounds.length ? Math.max(...bounds.map((b) => b.y2)) : 0) + 20;
    width = Math.max(100, right - x);
    height = Math.max(100, bottom - y);
  }
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    width > 100000 ||
    height > 100000
  )
    throw new Error('Drawing bounds are invalid or too large.');
  return renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`${x} ${y} ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={source.options.color_background || 'white'}
      />
      <SvgDefs images={source.images} hatches={source.hatches} />
      {view === 'page' && source.details.show_details && (
        <DesignDetails
          details={source.details}
          page_size={source.details.page_size}
        />
      )}
      {view === 'page' && source.details.show_guides && (
        <DesignGuides
          details={source.details}
          page_size={source.details.page_size}
        />
      )}
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
        items={source.items}
        options={source.options}
        netlistTypes={drawing.netlistTypes}
      />
    </svg>,
  );
}

export function tidyTinyCadDrawing(
  xml: string,
  sheet = 1,
  options: LayoutOptions = {},
) {
  const drawing = parseDrawing(xml),
    source = selectedSheet(drawing, sheet);
  if (source.items.length > 256)
    throw new Error(
      'Auto-tidy supports up to 256 items on the selected sheet.',
    );
  if (
    (options.maxEvaluations ?? 250) > 500 ||
    (options.maxPasses ?? 2) > 4 ||
    (options.annealingSteps ?? 0) !== 0
  )
    throw new Error(
      'Auto-tidy is limited to 500 evaluations, 4 passes and no annealing.',
    );
  const known = new Set(source.items.map((item) => item._id));
  for (const id of [
    ...(options.selectedIds || []),
    ...(options.lockedIds || []),
  ])
    if (!known.has(id))
      throw new Error(
        `Unknown item ID ${id}; use validate_drawing to list item IDs.`,
      );
  const signature = terminalSignature(drawing);
  const result = optimiseLayout(source, {
    ...options,
    maxPasses: options.maxPasses ?? 2,
    maxEvaluations: options.maxEvaluations ?? 250,
    annealingSteps: 0,
  });
  if (
    !result.connectivityPreserved ||
    !sameConnectivity(source, result.sheet, result.wireOrigins)
  )
    throw new Error(
      'Auto-tidy rejected a change to physical or electrical connectivity.',
    );
  const output = {
    ...drawing,
    sheets: drawing.sheets.map((s, i) => (i === sheet - 1 ? result.sheet : s)),
  };
  const definition = new ioXML().to_dsn(output, true, true).tostring();
  const roundtrip = parseDrawing(definition);
  if (signature !== terminalSignature(roundtrip))
    throw new Error('Auto-tidy serialization changed electrical connectivity.');
  for (let i = 0; i < output.sheets.length; i++) {
    const before = output.sheets[i],
      after = roundtrip.sheets[i];
    // Item IDs are not saved in XML. Restore the saver order for the physical
    // partition check, including routed wire segments and newly added junctions.
    if (
      !after ||
      before.items.length !== after.items.length ||
      before.items.some(
        (item, index) => item.NodeName !== after.items[index].NodeName,
      )
    )
      throw new Error('Auto-tidy serialization changed drawing items.');
    const mapped = {
      ...after,
      items: after.items.map((item, index) => ({
        ...item,
        _id: before.items[index]._id,
      })),
    };
    if (!sameConnectivity(before, mapped))
      throw new Error(
        'Auto-tidy serialization changed physical or electrical connectivity.',
      );
  }
  return {
    definition,
    sheet,
    connectivityPreserved: true,
    serializationConnectivityPreserved: true,
    serializationPhysicalConnectivityPreserved: true,
    changes: result.changes.map((change) => ({
      id: change.id,
      type: change.after?.NodeName || change.before?.NodeName,
      action: !change.before ? 'added' : !change.after ? 'removed' : 'updated',
    })),
    before: compactAnalysis(result.before),
    after: compactAnalysis(result.after),
    evaluations: result.evaluations,
    stopped: result.stopped,
    validation: check(roundtrip),
  };
}

const runtime =
  typeof globalThis !== 'undefined'
    ? (globalThis as any)
    : Function('return this')();
runtime.TinyCADDrawingServerBundle = Object.freeze({
  validateTinyCadDrawing,
  renderTinyCadDrawingSvg,
  tidyTinyCadDrawing,
});
