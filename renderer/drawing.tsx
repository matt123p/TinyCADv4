import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server.browser';
import { ioXML } from '../src/io/ioXml';
import { XMLBuilder } from '../src/util/xmlbuilder';
import { dsnDrawing, dsnSheet } from '../src/model/dsnDrawing';
import { updateFactory } from '../src/manipulators/updateFactory';
import { updateDrawing } from '../src/manipulators/updateDrawing';
import { NetlistGenerator } from '../src/io/netlists/netlistGenerator';
import { makeNetForDrawing } from '../src/web-worker/netlist';
import { optimiseLayout, sameConnectivity } from '../src/layout';
import { analysePrepared } from '../src/layout/analyse';
import { settings, bodyRect, texts, pins, symbolArtwork } from '../src/layout/geometry';
import { LayoutAnalysis } from '../src/layout/types';
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

// Both electrical and physical partitions are checked by the optimizer and again
// after serialization with restored IDs. Preserve names, pin mappings and hints
// separately so an isolated renamed net/terminal cannot escape that partition check.
// This avoids building two additional full native netlists just for identity checks.
function electricalIdentity(sheet: dsnSheet) {
  return JSON.stringify(sheet.items.flatMap<unknown[]>(item => {
    if (item.NodeName === 'symbol') return [[
      item._id, item.NodeName, item.part,
      item.text.map(field => [field.description, field.value]),
      item.hints,
      item._symbol.outlines.map(outline => outline.active_points.map(point => [
        point.pin.number, point.pin.name, point.pin.elec, point.pin.which,
      ])),
    ]];
    if (item.NodeName === 'label' || item.NodeName === 'power')
      return [[item._id, item.NodeName, item.text]];
    return [];
  }));
}

// Reuse layout analysis only when every geometric input survives the native saver.
// Identity and both connectivity partitions are checked separately below.
function layoutGeometry(sheet: dsnSheet) {
  return JSON.stringify(sheet.items.map(item => ({
    id: item._id, type: item.NodeName,
    point: 'point' in item ? item.point : null,
    end: 'point_b' in item ? item.point_b : null,
    points: 'd_points' in item ? item.d_points : null,
    rotation: 'rotation' in item ? item.rotation : null,
    which: 'which' in item ? item.which : null,
    body: bodyRect(item), text: texts(item),
    pins: item.NodeName === 'symbol' ? pins(item) : null,
    artwork: item.NodeName === 'symbol' ? symbolArtwork(item) : null,
  })));
}

function compactAnalysis(analysis: ReturnType<typeof analysePrepared>) {
  return {
    ...analysis,
    diagnostics: analysis.diagnostics.slice(0, 100),
    diagnosticsTruncated: analysis.diagnostics.length > 100,
  };
}

function check(drawing: dsnDrawing, knownLayouts = new Map<dsnSheet, LayoutAnalysis>()) {
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
      layout: compactAnalysis(knownLayouts.get(sheet) ?? analysePrepared(sheet, settings(sheet, {}))),
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
    (options.maxEvaluations ?? 2500) > 10000 ||
    (options.maxPasses ?? 4) > 8 ||
    (options.annealingSteps ?? 0) !== 0
  )
    throw new Error(
      'Auto-tidy is limited to 10000 evaluations, 8 passes and no annealing.',
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
  const identity = electricalIdentity(source);
  const result = optimiseLayout(source, {
    ...options,
    balancePhases: false,
    prepared: true,
    remainingBudget: typeof (globalThis as any).__tinycadLayoutBudget === 'function'
      ? () => (globalThis as any).__tinycadLayoutBudget()
      : undefined,
    maxPasses: options.maxPasses ?? 4,
    maxEvaluations: options.maxEvaluations ?? 2500,
    annealingSteps: 0,
  });
  // The optimizer compares both final partitions with the original signatures.
  // Serialization is checked independently below; do not recompute this same pair here.
  if (!result.connectivityPreserved)
    throw new Error(
      'Auto-tidy rejected a change to physical or electrical connectivity.',
    );
  if (identity !== electricalIdentity(result.sheet))
    throw new Error('Auto-tidy changed pin mappings, fields or named nets.');
  const output = {
    ...drawing,
    sheets: drawing.sheets.map((s, i) => (i === sheet - 1 ? result.sheet : s)),
  };
  const definition = new ioXML().to_dsn(output, true, true).tostring();
  const roundtrip = parseDrawing(definition);
  const knownLayouts = new Map<dsnSheet, LayoutAnalysis>();
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
    if (electricalIdentity(before) !== electricalIdentity(mapped))
      throw new Error('Auto-tidy serialization changed pin mappings, fields or named nets.');
    if (!sameConnectivity(before, mapped))
      throw new Error(
        'Auto-tidy serialization changed physical or electrical connectivity.',
      );
    if (i === sheet - 1 && (!options.disturbance || options.disturbance === 'medium') &&
        layoutGeometry(before) === layoutGeometry(mapped)) {
      const ids = new Map(before.items.map((item, index) => [item._id, after.items[index]._id]));
      knownLayouts.set(after, {
        metrics: result.after.metrics,
        diagnostics: result.after.diagnostics.map(diagnostic => ({ ...diagnostic,
          itemIds: diagnostic.itemIds.map(id => ids.get(id) ?? id),
        })),
      });
    }
  }
  const remainingByCode: Record<string, number> = {};
  for (const diagnostic of result.after.diagnostics)
    remainingByCode[diagnostic.code] = (remainingByCode[diagnostic.code] || 0) + 1;
  const recommended = new Set<string>();
  for (const code of Object.keys(remainingByCode)) {
    if (code.startsWith('text-')) recommended.add('symbol-text');
    if (code.startsWith('label-') || code === 'net-label-position') recommended.add('net-labels');
    if (['wire-body', 'crossing', 'wire-overlap', 'diagonal', 'pin-exit', 'bundle-disorder'].includes(code)) recommended.add('routing');
    if (['body-overlap', 'annotation-crowding', 'component-disorder'].includes(code)) recommended.add('placement');
    if (code.startsWith('junction-')) recommended.add('junctions');
  }
  const converged = result.stopped === 'converged';
  const complete = converged && result.after.diagnostics.length === 0;
  const readabilityKeys = ['bodyCollisions', 'wireBodyCollisions', 'crossings', 'overlaps',
    'diagonalSegments', 'pinExitViolations', 'textCollisions', 'annotationCrowding',
    'componentDisorder', 'labelOverhangs', 'junctionIssues', 'bundleDisorder'] as const;
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
    phaseProgress: result.phaseProgress,
    layoutQuality: {
      status: complete ? 'complete' : 'incomplete',
      converged,
      readabilityImproved: readabilityKeys.some(key => result.after.metrics[key] < result.before.metrics[key]),
      remainingDiagnosticCount: result.after.diagnostics.length,
      remainingByCode,
      recommendedPhases: [...recommended],
      message: complete
        ? 'Search converged with no detected layout issues. Inspect the final preview.'
        : 'Layout cleanup is incomplete. Electrical validation and preserved connectivity do not establish drawing readability. Continue with the recommended phases on the returned definition, repair persistent overlaps manually, and inspect the final preview before presenting it as cleaned up.',
    },
    stopped: result.stopped,
    budgetReason: result.stopped === 'budget'
      ? (result.evaluations >= (options.maxEvaluations ?? 2500) ? 'evaluations' : 'runtime')
      : result.stopped === 'pass-limit' ? 'passes' : null,
    validation: check(roundtrip, knownLayouts),
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
