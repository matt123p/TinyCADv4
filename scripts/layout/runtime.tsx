import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ServerDrawing from '../../renderer/ServerDrawing';
import SvgDefs from '../../src/components/svg/SvgDefs';
import { DeviceFootprintPreview } from '../../src/components/projects/DeviceMappingPreview';
import type { EmbeddedFootprint } from '../../src/pcb/boardAssets';
import { dsnSheet } from '../../src/model/dsnDrawing';
import {
  bodyRect,
  rect,
  texts,
  union,
  refresh,
} from '../../src/layout/geometry';
export * from '../../src/layout';
export { analyseRouteMetrics } from '../../src/layout/analyse';
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
export { decodeDrawing, encodeDrawing } from '../../src/io/dsnCodec';
export { createControl } from '../../src/simulation/controlSymbols';
export { createSimulationSheet } from '../../src/simulation/document';
export { defaultAnalysis } from '../../src/simulation/contracts';
export { initialiseLayoutRuntime } from './headless';
export { buildHierarchicalNetlist, HierarchyConnectivityError } from '../../src/pcb/hierarchicalNetlist';
export { boardPadSources, buildHierarchicalCircuitSnapshot } from '../../src/pcb/hierarchicalSnapshot';
export { childPath, childInterface, hierarchyDefinition, refreshPlacement, affectedPorts } from '../../src/io/hierarchyDrawing';
export { ioXML } from '../../src/io/ioXml';
export { XMLBuilder } from '../../src/util/xmlbuilder';
export { updateDrawing } from '../../src/manipulators/updateDrawing';
export { updateSymbol } from '../../src/manipulators/updateSymbol';
export { updateView } from '../../src/manipulators/updateView';
export { NetlistGenerator } from '../../src/io/netlists/netlistGenerator';
export { makeNetForDrawing } from '../../src/web-worker/netlist';
export { NetlistWorkerState } from '../../src/web-worker/netlistState';
export { auditPcbSchematic } from '../../src/pcb/schematicAudit';
export { reviewCircuitNets } from '../../src/pcb/circuitNets';
export { decodeProjectSettings, encodeProjectSettings } from '../../src/pcb/projectSettings';
export { circuitConnectivityDigest } from '../../src/pcb/circuitSnapshot';
export { deviceDigest, readLibraryDevice, readLibraryDeviceCatalogue, searchLibraryDevices, writeLibraryDevice } from '../../src/pcb/deviceLibrary';
export { applyDeviceReview, previewDeviceReview } from '../../src/pcb/deviceReview';
export { previewCircuitEco, applyCircuitEco } from '../../src/pcb/circuitEco';
export { readBoardCircuitSource } from '../../src/io/boardCircuitSource';
export { loadPolygonKernel } from '../../src/pcb/polygonKernel';
export { routeBoard } from '../../src/pcb/routing';
export { isCentrelineClear, manualRouteLeg } from '../../src/pcb/routing';
export { prepareManualTrackClearance } from '../../src/pcb/manualBoardRouting';
export { boardCopperGeometry } from '../../src/pcb/boardCopperGeometry';
export { boardZoneGeometry } from '../../src/pcb/boardZoneGeometry';
export { circleContour, repairProfileJunction, straightContour } from '../../src/pcb/boardProfiles';
export { flattenContour, profileRegion } from '../../src/pcb/contours';
export { analyseCopper } from '../../src/pcb/copper';
export { createBoard } from '../../src/pcb/board';
export { exportKicadBoard } from '../../src/pcb/kicadBoardExport';
export { encodeBoard, decodeBoard, createBoardModelAsset, readBoardModelAsset } from '../../src/pcb/boardCodec';
export { driveProjectFiles } from '../../src/io/projectStorage';
export { compareProjectRevisions } from '../../src/pcb/projectRevisions';
export { withNativeJunctions } from '../../src/layout/connectivity';

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

export { editBoardReferences, previewBackAnnotation, applyBackAnnotation } from '../../src/pcb/referenceEco';
export { referencesForInstance } from '../../src/io/projectHierarchy';

export { importFootprintLibrary, encodeFootprintLibrary, decodeFootprintLibrary, footprintDefinition, makeFootprintPad, publishFootprintDevice, inspectFootprintDimensions, translateFootprintOrigin } from '../../src/pcb/footprintLibrary';

export { kicadImporter } from '../../src/io/kicad/kicadImporter';

export { placeUnplacedComponent } from '../../src/pcb/boardPlacement';

export function renderFootprintAtActualSize(footprint: EmbeddedFootprint) {
  return renderToStaticMarkup(
    <DeviceFootprintPreview footprint={footprint} selected="" ruler actualSize />,
  );
}

export { readStarterFootprints, readStarterFootprint, readStarterDevices } from '../../src/pcb/starterCatalogue';
export { prepareCamPreview } from '../../src/pcb/boardCam';
export { boardAssembly } from '../../src/pcb/boardAssembly';
export { boardArtwork } from '../../src/pcb/boardArtwork';
export const loadModelPlacementMatrix = () => import('../../src/pcb/modelPlacementMatrix');
export { mountingKeepouts } from '../../src/pcb/boardMechanical';
export { placeFootprintPoint } from '../../src/pcb/footprint';
export { commitManualRoute } from '../../src/pcb/manualBoardRouting';
export { buildDeck } from '../../src/simulation/deck';
export { checkSpiceComponents } from '../../src/simulation/diagnostics';
export { deviceSignal, resolvedSignals } from '../../src/simulation/signals';
export { vectorUnit } from '../../src/simulation/resultStore';
