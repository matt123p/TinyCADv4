import React, { useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { BoardAirwire } from '../../pcb/boardAirwires';
import type { CopperFeature } from '../../pcb/copper';
import type { EmbeddedFootprint } from '../../pcb/boardAssets';
import type { BoardDocument, CopperLayer } from '../../pcb/board';
import type {
  boardPlacementView,
  placementPadTemplates,
} from '../../pcb/boardPlacement';
import { placeFootprintPoint } from '../../pcb/footprint';
import type { FootprintPlacement } from '../../pcb/footprint';
import { isBoardPoint, samePoint } from '../../pcb/geometry';
import BoardPlacementPreview from './BoardPlacementPreview';
import type { BoardPoint } from '../../pcb/geometry';
import type { ManualRoute } from '../../pcb/manualBoardRouting';
import { ScaledSvgText } from '../svg/ScaledSvgText';
import { svgCircle, svgLength, svgLengthTransform, svgTranslation } from '../svg/nanometreSvg';
import { SvgViewport, svgDrawingMatrix } from '../svg/SvgViewport';
import type { SvgViewportHandle } from '../svg/SvgViewport';
import TrackEditOverlay from './TrackEditOverlay';
import RouteDeletionOverlay from './RouteDeletionOverlay';
import type { BoardTrack, BoardVia } from '../../pcb/boardRouting';
import type { TrackEditPreview } from './TrackEditOverlay';
import { dimensionGeometry, dimensionText, snapMeasurementPoint } from '../../pcb/boardAnnotations';
import { routingSnapTargets, snapRoutePoint } from '../../pcb/routingSnap';
import type { RouteSnap } from '../../pcb/routingSnap';
import { FootprintPreviewDrawing } from '../projects/DeviceFootprintPreview';
import { FootprintArtwork, PadShapeDrawing } from '../projects/FootprintArtwork';
import { resolveFootprintText } from '../../pcb/footprintText';
import { padShapePoints } from '../../pcb/padstack';
import { SelectionMarquee } from '../svg/SelectionMarquee';

const point = ({ x, y }: BoardPoint) => `${x},${-y}`;
const ring = (points: readonly BoardPoint[]) =>
  'M' + points.map(point).join(' L') + ' Z';
const netHighlight = '#1765db';

export interface PlacementPreview {
  pads: ReturnType<typeof placementPadTemplates>;
  footprint: EmbeddedFootprint;
  placement: FootprintPlacement;
  original?: FootprintPlacement;
  showDraft: boolean;
  estimates: boolean;
  snap(x: number, y: number): BoardPoint;
}

export interface BoardCanvasHandle {
  zoom: SvgViewportHandle['zoom'];
  focus(): void;
  fit(points?: readonly BoardPoint[]): void;
}

export const boardPlacementDragType = 'application/x-tinycad-pcb-component';

export const boardPickKinds = {
  pad: 'Pad', track: 'Track', via: 'Via', zone: 'Zone boundary', silk: 'Silkscreen',
} as const;

export interface BoardPickTarget {
  kind: keyof typeof boardPickKinds;
  id: string;
  label: string;
  layer: CopperLayer['id'] | 'both';
  componentId?: string;
  locked?: boolean;
}

export interface BoardPick {
  point: BoardPoint;
  targets: BoardPickTarget[];
}

function placementTransform(position: BoardPoint, rotationMicrodegree: number, side: 'top' | 'bottom') {
  const mirror = side === 'bottom' ? ' scale(-1 1)' : '';
  return `${svgTranslation(position.x, -position.y)} rotate(${-rotationMicrodegree / 1e6})${mirror}`;
}

function boundsOf(points: readonly BoardPoint[], area?: { left: number; top: number; right: number; bottom: number }) {
  const bounds = area ? { ...area } : { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const { x, y } of points) {
    bounds.left = Math.min(bounds.left, x);
    bounds.right = Math.max(bounds.right, x);
    bounds.top = Math.min(bounds.top, -y);
    bounds.bottom = Math.max(bounds.bottom, -y);
  }
  return bounds;
}

type CanvasBounds = ReturnType<typeof boundsOf>;
type SelectionTarget = { componentId?: string; padId?: string; routeId?: string };
type SelectionGesture = {
  pointer: number;
  clientX: number;
  clientY: number;
  start: BoardPoint;
  componentId?: string;
  append: boolean;
};

function selectionTarget(element: Element): SelectionTarget {
  const hit = element.closest('[data-component], [data-track], [data-via]');
  return {
    componentId: hit?.getAttribute('data-component') ?? undefined,
    padId: element.closest('[data-board-pad]')?.getAttribute('data-board-pad') ?? undefined,
    routeId: hit?.getAttribute('data-track') ?? hit?.getAttribute('data-via') ?? undefined,
  };
}

function SelectionOutline({ bounds, preview }: { bounds: CanvasBounds; preview: boolean }) {
  const { left, top, right, bottom } = bounds;
  const x = svgLength(left);
  const y = svgLength(top);
  const width = svgLength(right - left);
  const height = svgLength(bottom - top);
  return <g transform={svgLengthTransform} pointerEvents="none"
    data-selection-outline={preview ? 'hover' : 'selected'}>
    <rect x={x} y={y} width={width} height={height}
      fill="none" stroke="white" strokeWidth={4} vectorEffect="non-scaling-stroke" />
    <rect x={x} y={y} width={width} height={height}
      fill="none" stroke={preview ? '#18578d' : '#17365d'} strokeWidth={2}
      strokeDasharray={preview ? '4 3' : undefined} vectorEffect="non-scaling-stroke" />
  </g>;
}

const RoutedCopper = React.memo(function RoutedCopper({
  tracks, vias, nets, visibleCopper, selectedNet, picking,
}: {
  tracks: BoardDocument['tracks'];
  vias: BoardDocument['vias'];
  nets: BoardDocument['nets'];
  visibleCopper: CopperLayer['id'] | 'all';
  selectedNet: string;
  picking: boolean;
}) {
  const netNames = useMemo(() => new Map(nets?.map(({ id, name }) => [id, name])), [nets]);
  const pickingAttributes = useMemo(() => picking ? (target: BoardPickTarget) => ({
    'data-board-pick': JSON.stringify(target),
  }) : undefined, [picking]);
  const shapesByTrack = useMemo(() => new WeakMap<BoardTrack, {
    netId: BoardTrack['netId']; shape: React.ReactElement;
  }>(),
    [pickingAttributes, netNames]);
  const trackShapes = useMemo(() => (tracks ?? [])
    .filter(({ layerId }) => visibleCopper === 'all' || layerId === visibleCopper)
    .map((track) => {
      const previous = shapesByTrack.get(track);
      if (previous) return previous;
      const { id, start, end, widthNm, layerId, reviewRequired, netId, locked } = track;
      const entry = {
        netId,
        shape: <line
          key={id}
          data-track={id}
          {...pickingAttributes?.({
            kind: 'track', id, layer: layerId, locked,
            label: netNames.get(netId) ?? 'Unassigned',
          })}
          data-route-locked={locked || undefined}
          x1={svgLength(start.x)}
          y1={svgLength(-start.y)}
          x2={svgLength(end.x)}
          y2={svgLength(-end.y)}
          strokeLinecap="round"
          stroke={reviewRequired ? '#a52c24' : layerId === 'top' ? '#b17a2d' : '#397188'}
          strokeWidth={svgLength(widthNm)}
        />,
      };
      shapesByTrack.set(track, entry);
      return entry;
    }), [tracks, visibleCopper, pickingAttributes, netNames, shapesByTrack]);
  return (
    <g transform={svgLengthTransform}>
      {trackShapes.map(({ netId, shape }) => netId && netId === selectedNet
        ? React.cloneElement(shape, { stroke: netHighlight, 'data-net-highlighted': true })
        : shape)}
      {(vias ?? []).map(
        ({ id, positionNm, diameterNm, drillNm, reviewRequired, netId, locked }) => (
          <g
            key={id}
            data-via={id}
            {...pickingAttributes?.({
              kind: 'via', id, layer: 'both', locked,
              label: netNames.get(netId) ?? 'Unassigned',
            })}
            data-route-locked={locked || undefined}
          >
            <circle
              cx={svgLength(positionNm.x)}
              cy={svgLength(-positionNm.y)}
              r={svgLength(diameterNm / 2)}
              fill={
                netId && netId === selectedNet
                  ? netHighlight
                  : reviewRequired
                  ? '#a52c24'
                  : '#79644e'
              }
              data-net-highlighted={
                (!!netId && netId === selectedNet) || undefined
              }
            />
            <circle
              data-board-opening=""
              cx={svgLength(positionNm.x)}
              cy={svgLength(-positionNm.y)}
              r={svgLength(drillNm / 2)}
              fill="#fff"
            />
          </g>
        ),
      )}
    </g>
  );
});

const ZoneCopper = React.memo(function ZoneCopper({
  fills, visibleCopper, selectedNet,
}: {
  fills: readonly CopperFeature[] | undefined;
  visibleCopper: CopperLayer['id'] | 'all';
  selectedNet: string;
}) {
  const paths = useMemo(() => fills?.map(({ id, region, netId, layerId }) => ({
    id, netId, layerId, outline: [region.outer, ...region.holes].map(ring).join(' '),
  })), [fills]);
  return paths?.filter(({ layerId }) => visibleCopper === 'all' || visibleCopper === layerId)
    .map(({ id, outline, netId, layerId }) => (
      <path
        key={id}
        data-zone-fill={id}
        data-net-highlighted={netId === selectedNet || undefined}
        d={outline}
        fillRule="evenodd"
        fill={netId === selectedNet ? netHighlight : layerId === 'top' ? '#bf562f' : '#477cae'}
        opacity={0.32}
        pointerEvents="none"
      />
    ));
});

const PlacedFootprint = React.memo(function PlacedFootprint({
  feature, margin, selected, inGroup, selectedPad, selectedNet, visibleCopper, picking,
}: {
  feature: ReturnType<typeof boardPlacementView>['features'][number];
  margin: number;
  selected: boolean;
  inGroup: boolean;
  selectedPad?: string;
  selectedNet: string;
  visibleCopper: CopperLayer['id'] | 'all';
  picking: boolean;
}) {
  const { id, label, placement, pads, copper } = feature;
  const position = placement.positionNm;
  const fill = selected || inGroup ? '#b34b27' : '#226a59';
  const visible = (layerId: CopperLayer['id']) => visibleCopper === 'all' || layerId === visibleCopper;
  const pickingAttributes = (padId: string, layer: CopperLayer['id'], padLabel: string) =>
    picking ? {
      'data-board-pick': JSON.stringify({
        kind: 'pad', id: padId, layer, componentId: id, label: label + ' · ' + padLabel,
        locked: placement.locked || placement.positionLocked || placement.rotationLocked,
      } satisfies BoardPickTarget),
    } : undefined;
  const padFill = (padId: string, highlighted: boolean) => highlighted
    ? netHighlight : selected && padId === selectedPad ? '#af242e' : fill;

  return (
    <g data-component={id} data-component-selected={selected || undefined}
      data-placement-group={inGroup || undefined}>
      {copper.filter(({ layerId }) => visible(layerId)).map(({ layerId, netId, padId, label, shape }) => {
        const highlighted = !!netId && netId === selectedNet;
        return (
          <PadShapeDrawing
            key={padId + ':' + layerId}
            shape={shape}
            colour={padFill(padId, highlighted)}
            attributes={{
              'data-board-pad': padId,
              ...pickingAttributes(padId, layerId, label),
              'data-net-highlighted': highlighted || undefined,
            }}
          />
        );
      })}
      {!copper.length && visible(placement.side) && pads.map(({ id: padId, position, netId, label }) => {
        const highlighted = !!netId && netId === selectedNet;
        return (
          <circle
            key={padId}
            data-board-pad={padId}
            {...pickingAttributes(padId, placement.side, label)}
            {...svgCircle(position.x, -position.y, margin * 0.085)}
            fill={padFill(padId, highlighted)}
            data-net-highlighted={highlighted || undefined}
          />
        );
      })}
      <ScaledSvgText x={position.x} y={-position.y - margin * 0.14} fill="#192b22"
        fontSize={margin * 0.29}>
        {label}
      </ScaledSvgText>
    </g>
  );
});

export default function BoardCanvas({
  board,
  geometry,
  canvasRef,
  onPick,
  selectedSilk,
  selected,
  group,
  selectedPad,
  selectedNet,
  selectedRoutes,
  route,
  airwires,
  zoneFills,
  checkMarker,
  visibleCopper,
  measurement,
  trackEdit,
  deletion,
  placementActive,
  placementPreview,
  showRulers,
  onDropComponent,
  onContextCommand,
  trackWidthNm,
  onLocation,
  onMeasure,
  routingSnap,
  onRouteObject,
  onComponent,
  onGroupComponent,
  onPad,
  selectionEnabled,
  onSelectArea,
  onMoveComponent,
}: {
  board: BoardDocument;
  geometry: ReturnType<typeof boardPlacementView>;
  canvasRef?: React.Ref<BoardCanvasHandle>;
  onPick?(pick: BoardPick): void;
  selectedSilk?: string;
  selected: string;
  group: ReadonlySet<string>;
  selectedPad?: string;
  selectedNet: string;
  selectedRoutes: ReadonlySet<string>;
  route: ManualRoute['path'];
  airwires?: readonly BoardAirwire[];
  zoneFills?: readonly CopperFeature[];
  checkMarker?: BoardPoint;
  visibleCopper: CopperLayer['id'] | 'all';
  measurement: readonly BoardPoint[];
  trackEdit?: Omit<TrackEditPreview, 'radius'>;
  deletion?: {
    tracks?: readonly BoardTrack[];
    vias?: readonly BoardVia[];
    corners?: readonly [BoardPoint, BoardPoint];
    pickingRegion: boolean;
  };
  placementActive: boolean;
  placementPreview?: PlacementPreview;
  showRulers: boolean;
  onDropComponent?(id: string, x: number, y: number): void;
  onContextCommand(point: { x: number; y: number }, object?: { componentId?: string; routeId?: string }): void;
  trackWidthNm: number;
  onLocation(x: number, y: number): void;
  onMeasure?(point: BoardPoint): void;
  routingSnap?: {
    layer: CopperLayer['id'];
    activeNet?: string;
    connect(snap: RouteSnap): void;
    preview(x: number, y: number, target?: BoardPoint): { points: readonly BoardPoint[]; blocked: boolean } | undefined;
  };
  onRouteObject(id: string, netId?: string, picked?: BoardPoint): void;
  onComponent(componentId: string): void;
  onGroupComponent?(componentId: string): void;
  selectionEnabled: boolean;
  onSelectArea(componentIds: string[], routeIds: string[], append: boolean): void;
  onMoveComponent?(componentId: string, delta: BoardPoint, commit: boolean): BoardPoint | undefined;
  onPad(
    componentId: string,
    padId: string,
    position: BoardPoint,
  ): void;
}) {
  const drawing = useRef<HTMLDivElement>(null);
  const viewport = useRef<SvgViewportHandle>(null);
  const gesture = useRef<SelectionGesture>();
  const suppressClick = useRef(false);
  const [dragPreview, setDragPreview] = useState<{ point: BoardPoint; offset?: BoardPoint }>();
  const [hover, setHover] = useState<SelectionTarget>();
  const profileBounds = boundsOf(geometry.profile.outer);
  const margin = Math.max(profileBounds.right - profileBounds.left, profileBounds.bottom - profileBounds.top) * 0.06;
  const datum = board.annotations?.datum;
  const dimensions = (board.annotations?.dimensions ?? []).map((dimension) => ({
    dimension,
    line: dimensionGeometry(dimension),
  }));
  const area = boundsOf([
    ...dimensions.flatMap(({ dimension, line }) => [dimension.start, dimension.end, line.start, line.end]),
    ...(datum ? [datum] : []),
  ], profileBounds);
  useImperativeHandle(canvasRef, () => ({
    fit(points) {
      if (!points?.length) {
        viewport.current?.fit();
        return;
      }
      const { left, right, top, bottom } = boundsOf(points);
      const extent = Math.max(right - left, bottom - top);
      const padding = Math.max(extent * 0.12, margin * 0.75, 1_000_000);
      viewport.current?.fit([left - padding, top - padding, right - left + 2 * padding, bottom - top + 2 * padding]);
    },
    focus() {
      drawing.current?.focus({ preventScroll: true });
    },
    zoom(direction, point) {
      viewport.current?.zoom(direction, point);
    },
  }), [margin]);
  const visible = (layer: CopperLayer['id']) =>
    visibleCopper === 'all' || visibleCopper === layer;
  const selectionBounds = useMemo(() => {
    const padding = margin * 0.12;
    const components = new Map<string, CanvasBounds>();
    const pads = new Map<string, CanvasBounds>();
    const routes = new Map<string, CanvasBounds>();
    const around = ({ x, y }: BoardPoint, radius: number) =>
      [{ x: x - radius, y: y - radius }, { x: x + radius, y: y + radius }];
    for (const feature of geometry.features) {
      const lands = feature.copper.filter(({ layerId }) => visibleCopper === 'all' || layerId === visibleCopper);
      const points = lands.flatMap(({ shape }) => padShapePoints(shape));
      if (!feature.copper.length && (visibleCopper === 'all' || feature.placement.side === visibleCopper)) {
        points.push(...feature.pads.flatMap(({ position }) => around(position, margin * 0.085)));
      }
      const origin = feature.placement.positionNm;
      points.push(...around(origin, margin * 0.16), { x: origin.x + feature.label.length * margin * 0.16, y: origin.y + margin * 0.43 });
      components.set(feature.id, boundsOf(points));
      for (const pad of feature.pads) {
        const shapes = lands.filter(({ padId }) => padId === pad.id);
        if (shapes.length || !feature.copper.length)
          pads.set(feature.id + ':' + pad.id, boundsOf(shapes.length
            ? shapes.flatMap(({ shape }) => padShapePoints(shape)) : around(pad.position, padding)));
      }
    }
    for (const track of board.tracks ?? []) {
      if (visibleCopper === 'all' || track.layerId === visibleCopper)
        routes.set(track.id, boundsOf([...around(track.start, track.widthNm / 2), ...around(track.end, track.widthNm / 2)]));
    }
    for (const via of board.vias ?? [])
      routes.set(via.id, boundsOf(around(via.positionNm, via.diameterNm / 2)));
    return { components, pads, routes };
  }, [geometry, board.tracks, board.vias, visibleCopper, margin]);
  const picking = !!onPick;
  const pickingAttributes = picking ? (target: BoardPickTarget) => ({
    'data-board-pick': JSON.stringify(target),
  }) : undefined;
  function pickAt(event: React.MouseEvent<HTMLDivElement>) {
    const svg = event.currentTarget.querySelector('svg');
    const inverse = svgDrawingMatrix(svg)?.inverse();
    if (!onPick || event.button !== 0 || !inverse || !svg.contains(event.target as Node)) return;
    event.stopPropagation();
    const { clientX, clientY } = event;
    const location = new DOMPoint(clientX, clientY).matrixTransform(inverse);
    const hits = new Set<string>();
    for (const element of svg.ownerDocument.elementsFromPoint(clientX, clientY)) {
      const hit = element.closest('[data-board-pick]');
      if (hit && svg.contains(hit)) hits.add(hit.getAttribute('data-board-pick'));
    }
    onPick({
      point: { x: Math.round(location.x), y: Math.round(-location.y) },
      targets: [...hits].map((hit) => JSON.parse(hit) as BoardPickTarget),
    });
  }
  const silk = useMemo(() => {
    const devices = new Map(board.deviceDefinitions?.map((device) => [device.id, device]));
    const definitions = new Map(board.footprintDefinitions?.map((definition) => [definition.id, definition]));
    const parts = new Map(board.components?.map((part) => [part.id, part]));
    return geometry.features.flatMap(({ id, label, placement }) => {
      const graphics = definitions.get(devices.get(placement.deviceId)?.footprintId)?.graphics ?? [];
      return graphics.flatMap((graphic, index) => {
        const idForGraphic = placement.id + ':' + index;
        if (!graphic.layer.endsWith('SilkS') ||
          (graphic.kind === 'text' && !graphic.visible)) return [];
        const layer: CopperLayer['id'] =
          graphic.layer.startsWith('F.') === (placement.side === 'top') ? 'top' : 'bottom';
        return [{
          target: {
            kind: 'silk' as const, id: idForGraphic, componentId: id,
            label: label + ' · ' + graphic.kind + ' ' + (index + 1), layer,
            locked: placement.locked || placement.positionLocked || placement.rotationLocked,
          },
          placement,
          graphic: graphic.kind === 'text'
            ? { ...graphic, text: resolveFootprintText(graphic.text, parts.get(id) ?? {}) }
            : graphic,
        }];
      });
    });
  }, [board, geometry]);
  const routing = !!routingSnap;
  const snapTargets = useMemo(() => routing ? routingSnapTargets(board) : [], [board, routing]);
  function routeSnapAt(x: number, y: number, unitsPerPixel: number) {
    if (routingSnap)
      return snapRoutePoint(
        snapTargets, { x, y: -y }, 8 * unitsPerPixel, routingSnap.layer, routingSnap.activeNet,
      );
  }

  function selectRoute(event: React.MouseEvent<SVGGElement>) {
    if (routing || onMeasure || deletion?.pickingRegion) return;
    const routeElement = (event.target as Element).closest('[data-track], [data-via]');
    if (!routeElement) return;
    const trackId = routeElement.getAttribute('data-track');
    const viaId = routeElement.getAttribute('data-via');
    const selected = trackId
      ? board.tracks?.find(({ id }) => id === trackId)
      : board.vias?.find(({ id }) => id === viaId);
    if (!selected) return;
    const { id, netId } = selected;
    event.stopPropagation();
    const matrix = svgDrawingMatrix(event.currentTarget.ownerSVGElement)?.inverse();
    const picked = matrix && new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
    onRouteObject(id, netId, picked && { x: Math.round(picked.x), y: Math.round(-picked.y) });
  }
  function selectPlacement(event: React.MouseEvent<SVGGElement>) {
    if (routing || deletion?.pickingRegion) return;
    const target = event.target as Element;
    const componentId = target.closest('[data-component]')?.getAttribute('data-component');
    const padId = target.closest('[data-board-pad]')?.getAttribute('data-board-pad');
    if (!componentId || (!padId && onMeasure)) return;
    event.stopPropagation();
    if (event.shiftKey && onGroupComponent) {
      onGroupComponent(componentId);
    } else if (padId) {
      const feature = geometry.features.find(({ id }) => id === componentId);
      const pad = feature?.pads.find(({ id }) => id === padId);
      if (pad) onPad(componentId, padId, pad.position);
    } else {
      onComponent(componentId);
    }
  }

  const { netAnchors, otherAnchors } = useMemo(() => {
    const netAnchors = new Map<string, BoardPoint[]>();
    const otherAnchors = new Map<string, BoardPoint[]>();
    for (const { id, pads } of geometry.features) {
      for (const { netId, position } of pads) {
        if (!netId) continue;
        if (!netAnchors.has(netId)) netAnchors.set(netId, []);
        netAnchors.get(netId).push(position);
        if (id === selected) continue;
        if (!otherAnchors.has(netId)) otherAnchors.set(netId, []);
        otherAnchors.get(netId).push(position);
      }
    }
    return { netAnchors, otherAnchors };
  }, [geometry, selected]);

  const offsets = useMemo(() => {
    if (!placementPreview) return;
    try {
      return placementPreview.pads.map((pad) => ({
        ...pad,
        position: placeFootprintPoint(pad.position, {
          ...placementPreview.placement,
          positionNm: { x: 0, y: 0 },
        }),
      }));
    } catch {
      return undefined;
    }
  }, [placementPreview]);

  function previewAt(pointer?: readonly [number, number]) {
    const { placement, footprint, original, showDraft, estimates, snap } =
      placementPreview;
    const origin = pointer
      ? snap(...pointer)
      : showDraft
      ? placement.positionNm
      : undefined;
    if (!isBoardPoint(origin)) return;
    if (
      original &&
      original.side === placement.side &&
      original.rotationMicrodegree === placement.rotationMicrodegree &&
      samePoint(original.positionNm, origin)
    )
      return;
    return (
      <BoardPlacementPreview
        origin={origin}
        offsets={offsets}
        anchors={otherAnchors}
        estimates={estimates}
        scale={margin}
      >
        <g opacity={0.65} transform={placementTransform(origin, placement.rotationMicrodegree, placement.side)}>
          <FootprintPreviewDrawing footprint={footprint} padScale={margin / 4} />
        </g>
      </BoardPlacementPreview>
    );
  }

  function pointerOnCanvas(event: React.MouseEvent<HTMLDivElement>, captured = false) {
    const svg = event.currentTarget.querySelector('svg');
    const inverse = svgDrawingMatrix(svg)?.inverse();
    if (inverse && (captured || svg.contains(event.target as Node)))
      return new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
  }

  function cancelGesture() {
    const current = gesture.current;
    gesture.current = undefined;
    setDragPreview(undefined);
    if (current && drawing.current?.hasPointerCapture(current.pointer))
      drawing.current.releasePointerCapture(current.pointer);
  }

  function marqueeBounds(start: BoardPoint, end: BoardPoint) {
    return boundsOf([start, end]);
  }

  const movingId = dragPreview?.offset ? gesture.current?.componentId : undefined;
  const marquee = dragPreview && gesture.current && !gesture.current.componentId
    ? marqueeBounds(gesture.current.start, dragPreview.point) : undefined;
  const hoverBounds = selectionEnabled && !dragPreview && hover && (
    hover.componentId ? (hover.padId && selectionBounds.pads.get(hover.componentId + ':' + hover.padId)) ||
      selectionBounds.components.get(hover.componentId) : selectionBounds.routes.get(hover.routeId)
  );
  const selectedOutlines = [
    ...[...group, selected].filter(Boolean).map((id) => ({
      id,
      bounds: id === selected && selectedPad ? selectionBounds.pads.get(id + ':' + selectedPad) ??
        selectionBounds.components.get(id) : selectionBounds.components.get(id),
    })),
    ...[...selectedRoutes].map((id) => ({ id, bounds: selectionBounds.routes.get(id) })),
  ];

  return (
    <div ref={drawing} className="circuit-drawing pcb-svg"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        suppressClick.current = false;
        if (!selectionEnabled || event.pointerType === 'touch') return;
        const location = pointerOnCanvas(event);
        if (!location) return;
        const { componentId, routeId } = selectionTarget(event.target as Element);
        if (routeId || (componentId && (event.shiftKey || !onMoveComponent))) return;
        if (componentId && geometry.features.some(({ id, placement }) =>
          id === componentId && (placement.locked || placement.positionLocked))) return;
        gesture.current = {
          pointer: event.pointerId, clientX: event.clientX, clientY: event.clientY,
          start: { x: location.x, y: -location.y }, componentId, append: event.shiftKey,
        };
      }}
      onPointerMove={(event) => {
        const current = gesture.current;
        if (current?.pointer === event.pointerId && selectionEnabled) {
          if (!(event.buttons & 1)) {
            cancelGesture();
            return;
          }
          if (!suppressClick.current && Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY) < 4)
            return;
          const location = pointerOnCanvas(event, true);
          if (!location) return;
          if (!suppressClick.current) {
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.focus({ preventScroll: true });
            suppressClick.current = true;
          }
          const point = { x: location.x, y: -location.y };
          const offset = current.componentId && onMoveComponent?.(current.componentId,
            { x: point.x - current.start.x, y: point.y - current.start.y }, false);
          setDragPreview({ point, offset: offset || undefined });
          return;
        }
        const next = event.buttons === 0 && selectionEnabled && pointerOnCanvas(event)
          ? selectionTarget(event.target as Element) : undefined;
        setHover((previous) => previous?.componentId === next?.componentId &&
          previous?.padId === next?.padId && previous?.routeId === next?.routeId ? previous : next);
      }}
      onPointerUp={(event) => {
        const current = gesture.current;
        if (current?.pointer !== event.pointerId || event.button !== 0) return;
        const location = suppressClick.current && selectionEnabled && pointerOnCanvas(event, true);
        cancelGesture();
        if (!location) return;
        const point = { x: location.x, y: -location.y };
        if (current.componentId) {
          onMoveComponent?.(current.componentId,
            { x: point.x - current.start.x, y: point.y - current.start.y }, true);
        } else {
          const box = marqueeBounds(current.start, point);
          const inside = ([, bounds]: [string, CanvasBounds]) => bounds.left >= box.left &&
            bounds.right <= box.right && bounds.top >= box.top && bounds.bottom <= box.bottom;
          onSelectArea([...selectionBounds.components].filter(inside).map(([id]) => id),
            [...selectionBounds.routes].filter(inside).map(([id]) => id), current.append);
        }
      }}
      onPointerCancel={cancelGesture}
      onLostPointerCapture={cancelGesture}
      onPointerLeave={() => setHover(undefined)}
      onClickCapture={(event) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          event.stopPropagation();
          return;
        }
        if (picking) {
          pickAt(event);
          return;
        }
        if (!placementActive) return;
        if (event.button !== 0 || event.shiftKey) return;
        const location = pointerOnCanvas(event);
        if (!location) return;
        event.stopPropagation();
        onLocation(location.x, location.y);
      }}
      tabIndex={0}
      aria-label="Board drawing"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && gesture.current) {
          cancelGesture();
          event.preventDefault();
          return;
        }
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        onContextCommand({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }}
      onContextMenu={(event) => {
        if (event.detail === 0 && !event.clientX && !event.clientY) return;
        event.preventDefault();
        event.stopPropagation();
        if (gesture.current) {
          cancelGesture();
          return;
        }
        const hit = (event.target as Element).closest('[data-component], [data-track], [data-via]');
        onContextCommand({ x: event.clientX, y: event.clientY }, {
          componentId: hit?.getAttribute('data-component') ?? undefined,
          routeId: hit?.getAttribute('data-track') ?? hit?.getAttribute('data-via') ?? undefined,
        });
      }}
      onDragOver={onDropComponent && ((event) => {
        if (!event.dataTransfer.types.includes(boardPlacementDragType)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      })}
      onDrop={onDropComponent && ((event) => {
        const id = event.dataTransfer.getData(boardPlacementDragType);
        const location = id && pointerOnCanvas(event);
        if (!location) return;
        event.preventDefault();
        onDropComponent(id, location.x, location.y);
      })}
    >
      <SvgViewport
        label="Board layout"
        editorWheel
        scrollbars
        rulerUnits={showRulers ? { unitsPerMillimeter: 1_000_000, yUp: true } : undefined}
        viewportRef={viewport}
        fit={[
          area.left - margin,
          area.top - margin,
          area.right - area.left + 2 * margin,
          area.bottom - area.top + 2 * margin,
        ]}
        onLocation={(x, y, unitsPerPixel) => {
          const routeTarget = routeSnapAt(x, y, unitsPerPixel);
          if (routeTarget) {
            routingSnap.connect(routeTarget);
            return;
          }
          if (onMeasure) {
            const vertices = board.profile
              ? [board.profile.outline, ...board.profile.cutouts]
                  .flatMap((loop) => loop.map(({ start }) => start))
              : board.outline ?? [];
            const snapped = snapMeasurementPoint({ x, y: -y }, [
              ...vertices,
              ...(board.tracks ?? []).filter(({ layerId }) => visible(layerId))
                .flatMap(({ start, end }) => [start, end]),
              ...(board.vias ?? []).map(({ positionNm }) => positionNm),
              ...(board.mechanicalHoles ?? []).flatMap(({ start, end }) => [start, end]),
              ...(board.jumpers ?? []).flatMap(({ start, end }) => [start, end]),
              ...(datum ? [datum] : []),
              ...geometry.features.filter(({ placement }) => visible(placement.side))
                .flatMap(({ pads }) => pads.map(({ position }) => position)),
            ], 10 * unitsPerPixel);
            if (snapped) {
              onMeasure(snapped);
              return;
            }
          }
          onLocation(x, y);
        }}
        renderLocationPreview={routing ? (pointer) => {
          if (!pointer) return;
          const snap = routeSnapAt(...pointer);
          const leg = routingSnap.preview(pointer[0], pointer[1], snap?.position);
          const width = Math.max(180_000, trackWidthNm);
          const blockedEnd = leg?.blocked ? leg.points.at(-1) : undefined;
          const markerSize = 3 * pointer[2];
          return <g pointerEvents="none">
            {leg && <path
              data-route-preview={leg.blocked ? 'blocked' : 'clear'}
              d={'M' + leg.points.map(point).join(' L')}
              fill="none"
              stroke={leg.blocked ? '#b72525' : '#1765db'}
              strokeWidth={width}
              strokeDasharray={leg.blocked ? `${3 * width} ${2 * width}` : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.8"
            />}
            {snap && <circle
              data-route-snap=""
              {...svgCircle(snap.position.x, -snap.position.y, 5 * pointer[2])}
              fill="none"
              stroke="#163f92"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />}
            {blockedEnd && <g data-route-blocked-marker="" aria-hidden="true"
              transform={svgTranslation(blockedEnd.x, -blockedEnd.y)}>
              <circle {...svgCircle(0, 0, markerSize * 1.8)} fill="white" />
              <path d={`M${-markerSize},${-markerSize} L${markerSize},${markerSize} M${markerSize},${-markerSize} L${-markerSize},${markerSize}`}
                fill="none" stroke="#b72525" strokeWidth={2}
                strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </g>}
          </g>;
        } : offsets && ((pointer) => previewAt(pointer && [pointer[0], pointer[1]]))}
      >
        <path data-board-profile=""
          d={[geometry.profile.outer, ...geometry.profile.holes]
            .map(ring)
            .join(' ')}
          fill="#e8f0e9"
          fillRule="evenodd"
          stroke="#465b52"
          strokeWidth={margin * 0.065}
        />
        {board.placementAreas
          ?.filter(({ side }) => side === 'both' || visible(side))
          .map(({ id, kind, outline }) => (
            <path
              key={id}
              data-placement-area={id}
              d={ring(outline)}
              fill={kind === 'keep-out' ? '#a32957' : '#177a64'}
              fillOpacity={0.12}
              stroke={kind === 'keep-out' ? '#a32957' : '#177a64'}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ))}
        {board.routingRegions
          ?.filter(({ side }) => side === 'both' || visible(side))
          .map(({ id, outline }) => (
            <path
              key={id}
              data-routing-region={id}
              d={ring(outline)}
              fill="#785193"
              fillOpacity={0.12}
              stroke="#785193"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ))}
        <ZoneCopper fills={zoneFills} visibleCopper={visibleCopper} selectedNet={selectedNet} />
        {picking && board.zones?.filter(({ layerId }) => visible(layerId)).map((zone) => (
          <path key={zone.id}
            {...pickingAttributes?.({
              kind: 'zone', id: zone.id, layer: zone.layerId,
              label: board.nets?.find(({ id }) => id === zone.netId)?.name ?? 'Unassigned',
            })}
            d={[zone.outline, ...zone.cutouts.map(({ outline }) => outline)].map(ring).join(' ')}
            fill="none" stroke="#785193" strokeWidth={5} strokeOpacity={0.7}
            strokeDasharray="5 4" vectorEffect="non-scaling-stroke" pointerEvents="stroke"
          />
        ))}
        {board.mechanicalHoles?.map(
          ({ id, start, end, widthNm, landWidthNm, screwHeadDiameterNm, screwHeadSide, bodyClearanceNm }) => (
            <g key={id} data-hole={id} pointerEvents="none">
              {screwHeadDiameterNm !== undefined &&
                (screwHeadSide === 'both' || visible(screwHeadSide)) && (
                  <g fill="none" stroke="#9e6813" strokeDasharray="4 3">
                    <circle
                      data-screw-head={screwHeadSide}
                      {...svgCircle(start.x, -start.y, screwHeadDiameterNm / 2)}
                      vectorEffect="non-scaling-stroke"
                    />
                    {!!bodyClearanceNm && (
                      <circle
                        data-screw-body-clearance={screwHeadSide}
                        {...svgCircle(start.x, -start.y, screwHeadDiameterNm / 2 + bodyClearanceNm)}
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                  </g>
                )}
              {landWidthNm && (
                <path
                  d={`M${point(start)} L${point(end)}`}
                  stroke="#b17a2d"
                  strokeLinecap="round"
                  strokeWidth={landWidthNm}
                />
              )}
              <path
                data-board-opening=""
                d={`M${point(start)} L${point(end)}`}
                stroke="#fff"
                strokeLinecap="round"
                strokeWidth={widthNm}
              />
            </g>
          ),
        )}
        {visible('top') &&
          board.jumpers?.map(
            ({
              id,
              reference,
              fitted,
              start,
              end,
              landWidthNm,
              drillNm,
              netId,
            }) => (
              <g key={id} data-wire-jumper={id}>
                <path
                  d={`M${point(start)} L${point(end)}`}
                  stroke={fitted ? '#744501' : '#777'}
                  strokeWidth="1.5"
                  strokeDasharray="5 4"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
                {[start, end].map((position, index) => (
                  <g key={index}>
                    <circle
                      data-jumper-end={index === 0 ? 'A' : 'B'}
                      {...svgCircle(position.x, -position.y, landWidthNm / 2)}
                      fill={netId === selectedNet ? netHighlight : '#b17a2d'}
                    />
                    <circle
                      data-board-opening=""
                      {...svgCircle(position.x, -position.y, drillNm / 2)}
                      fill="white"
                      pointerEvents="none"
                    />
                  </g>
                ))}
                <ScaledSvgText
                  x={(start.x + end.x) / 2}
                  y={-(start.y + end.y) / 2 - margin * 0.12}
                  fontSize={margin * 0.24}
                  pointerEvents="none"
                >
                  {reference}
                  {fitted ? '' : ' (DNP)'}
                </ScaledSvgText>
              </g>
            ),
          )}
        <g onClick={selectRoute}>
          <RoutedCopper tracks={board.tracks} vias={board.vias} nets={board.nets}
            visibleCopper={visibleCopper} selectedNet={selectedNet} picking={picking} />
        </g>
        {(
          airwires ??
          [...netAnchors].flatMap(([netId, [start, ...anchors]]) =>
            anchors.map((end) => ({ netId, start, end })),
          )
        ).map(({ netId, start, end }, index) => (
          <path
            key={netId + ':' + index}
            d={'M' + point(start) + ' L' + point(end)}
            stroke={netId === selectedNet ? netHighlight : '#8292a3'}
            fill="none"
            strokeWidth={margin * 0.04}
            strokeDasharray={margin * 0.16}
            pointerEvents="none"
          />
        ))}
        <g onClick={selectPlacement}>
          {geometry.features.map((feature) => {
            const lands = feature.copper.length ? feature.copper : feature.pads;
            const highlightedNet = selectedNet && lands.some(({ netId }) => netId === selectedNet)
              ? selectedNet : '';
            const footprint = <PlacedFootprint key={feature.id} feature={feature} margin={margin}
              selected={feature.id === selected} inGroup={group.has(feature.id)}
              selectedPad={feature.id === selected ? selectedPad : undefined}
              selectedNet={highlightedNet} visibleCopper={visibleCopper} picking={picking} />;
            return feature.id === movingId ? <g key={feature.id} opacity={0.7} data-footprint-move-preview=""
              transform={svgTranslation(dragPreview.offset.x, -dragPreview.offset.y)}>{footprint}</g> : footprint;
          })}
        </g>
        {silk.filter(({ target }) => visible(target.layer)).map(({ target, placement, graphic }) => (
          <g key={target.id} {...pickingAttributes?.(target)}
            data-picked-silk={selectedSilk === target.id || undefined}
            transform={placementTransform(target.componentId === movingId ? {
              x: placement.positionNm.x + dragPreview.offset.x, y: placement.positionNm.y + dragPreview.offset.y,
            } : placement.positionNm, placement.rotationMicrodegree, placement.side)}
            pointerEvents={picking ? 'visiblePainted' : 'none'}>
            <FootprintArtwork item={graphic} highlighted={selectedSilk === target.id} />
          </g>
        ))}
        {dimensions.map(({ dimension, line }) => {
          const tick = margin * 0.08;
          const dx = line.end.x - line.start.x;
          const dy = line.end.y - line.start.y;
          const length = Math.hypot(dx, dy);
          const tickX = tick * (dx - dy) / length;
          const tickY = tick * (dx + dy) / length;
          const ticks = [line.start, line.end].map(({ x, y }) =>
            `M${x - tickX},${-y + tickY} L${x + tickX},${-y - tickY}`).join(' ');
          return (
            <g key={dimension.id} data-dimension={dimension.id} pointerEvents="none">
              <path
                d={`M${point(dimension.start)} L${point(line.start)} L${point(line.end)} L${point(dimension.end)} ${ticks}`}
                fill="none"
                stroke="#455c73"
                strokeWidth={1.2}
                vectorEffect="non-scaling-stroke"
              />
              <ScaledSvgText
                x={(line.start.x + line.end.x) / 2}
                y={-(line.start.y + line.end.y) / 2 - margin * 0.1}
                fill="#29445e"
                fontSize={margin * 0.28}
                textAnchor="middle"
                paintOrder="stroke" stroke="white" strokeWidth={margin * 0.045}
              >
                {dimensionText(dimension)}
              </ScaledSvgText>
            </g>
          );
        })}
        {datum && (
          <g data-measurement-datum pointerEvents="none" transform={svgTranslation(datum.x, -datum.y)}>
            <path
              d={`M${-margin * 0.13},0 H${margin * 0.13} M0,${-margin * 0.13} V${margin * 0.13}`}
              stroke="#455c73"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
            <ScaledSvgText x={margin * 0.15} y={-margin * 0.15} fill="#29445e" fontSize={margin * 0.24}>Datum</ScaledSvgText>
          </g>
        )}
        {measurement.length === 2 && (
          <path
            d={`M${point(measurement[0])} L${point(measurement[1])}`}
            stroke="#845100"
            strokeWidth={margin * 0.055}
            pointerEvents="none"
          />
        )}
        {route.length > 0 && (
          <g pointerEvents="none">
            {route.slice(1).map(({ position, layer }, index) => (
              <path
                key={index}
                d={`M${point(route[index].position)} L${point(position)}`}
                stroke={layer === 'top' ? '#b17a2d' : '#397188'}
                strokeWidth={Math.max(
                  180_000,
                  trackWidthNm,
                )}
                strokeLinecap="round"
                strokeDasharray="250000 120000"
                opacity="0.8"
              />
            ))}
          </g>
        )}
        {trackEdit && <TrackEditOverlay {...trackEdit} radius={margin * 0.27} />}
        {deletion && <RouteDeletionOverlay tracks={deletion.tracks} vias={deletion.vias} corners={deletion.corners} />}
        {checkMarker && (
          <circle
            data-check-marker=""
            {...svgCircle(checkMarker.x, -checkMarker.y, margin / 3)}
            stroke="#bd2222"
            vectorEffect="non-scaling-stroke"
            strokeWidth={2}
            fill="none"
            pointerEvents="none"
          />
        )}
        {!movingId && selectedOutlines.map(({ id, bounds }) => bounds &&
          <SelectionOutline key={id} bounds={bounds} preview={false} />)}
        {hoverBounds && <SelectionOutline bounds={hoverBounds} preview />}
        {marquee && <g transform={svgLengthTransform}>
          <SelectionMarquee x={svgLength(marquee.left)} y={svgLength(marquee.top)}
            width={svgLength(marquee.right - marquee.left)} height={svgLength(marquee.bottom - marquee.top)} />
        </g>}
      </SvgViewport>
    </div>
  );
}
