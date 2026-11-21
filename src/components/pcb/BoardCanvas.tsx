import React, { useImperativeHandle, useMemo, useRef } from 'react';
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
import { SvgViewport } from '../svg/SvgViewport';
import type { SvgViewportHandle } from '../svg/SvgViewport';
import TrackEditOverlay from './TrackEditOverlay';
import RouteDeletionOverlay from './RouteDeletionOverlay';
import type { BoardTrack, BoardVia } from '../../pcb/boardRouting';
import type { TrackEditPreview } from './TrackEditOverlay';
import { dimensionGeometry, dimensionText, snapMeasurementPoint } from '../../pcb/boardAnnotations';
import { routingSnapTargets, snapRoutePoint } from '../../pcb/routingSnap';
import type { RouteSnap } from '../../pcb/routingSnap';
import { FootprintPreviewDrawing } from '../projects/DeviceFootprintPreview';
import { FootprintArtwork } from '../projects/FootprintArtwork';
import { resolveFootprintText } from '../../pcb/footprintText';

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
  return `translate(${position.x} ${-position.y}) rotate(${-rotationMicrodegree / 1e6})${mirror}`;
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
  trackWidth,
  onLocation,
  onMeasure,
  routingSnap,
  onRouteObject,
  onComponent,
  onGroupComponent,
  onPad,
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
  trackWidth: string;
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
  onPad(
    componentId: string,
    padId: string,
    position: BoardPoint,
  ): void;
}) {
  const drawing = useRef<HTMLDivElement>(null);
  const viewport = useRef<SvgViewportHandle>(null);
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
  const picking = !!onPick;
  const pickingAttributes = picking ? (target: BoardPickTarget) => ({
    'data-board-pick': JSON.stringify(target),
  }) : undefined;
  function pickAt(event: React.MouseEvent<HTMLDivElement>) {
    const svg = event.currentTarget.querySelector('svg');
    const inverse = svg?.getScreenCTM()?.inverse();
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

  function selectRoute(event: React.MouseEvent<SVGElement>, id: string, netId?: string) {
    if (routing || onMeasure || deletion?.pickingRegion) return;
    event.stopPropagation();
    const matrix = event.currentTarget.ownerSVGElement?.getScreenCTM()?.inverse();
    const picked = matrix && new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
    onRouteObject(id, netId, picked && { x: Math.round(picked.x), y: Math.round(-picked.y) });
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

  function pointerOnCanvas(event: React.MouseEvent<HTMLDivElement>) {
    const svg = event.currentTarget.querySelector('svg');
    const inverse = svg?.getScreenCTM()?.inverse();
    if (inverse && svg.contains(event.target as Node))
      return new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
  }

  return (
    <div ref={drawing} className="circuit-drawing pcb-svg"
      onClickCapture={placementActive ? (event) => {
        if (event.button !== 0 || event.shiftKey) return;
        const location = pointerOnCanvas(event);
        if (!location) return;
        event.stopPropagation();
        onLocation(location.x, location.y);
      } : picking ? pickAt : undefined}
      tabIndex={0}
      aria-label="Board drawing"
      onKeyDown={(event) => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        onContextCommand({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }}
      onContextMenu={(event) => {
        if (event.detail === 0 && !event.clientX && !event.clientY) return;
        event.preventDefault();
        event.stopPropagation();
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
          return <g pointerEvents="none">
            {leg && <path
              data-route-preview={leg.blocked ? 'blocked' : 'clear'}
              d={'M' + leg.points.map(point).join(' L')}
              fill="none"
              stroke={leg.blocked ? '#b72525' : '#1765db'}
              strokeWidth={Math.max(180_000, Number(trackWidth) * 1_000_000 || 0)}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.8"
            />}
            {snap && <circle
              data-route-snap=""
              cx={snap.position.x}
              cy={-snap.position.y}
              r={5 * pointer[2]}
              fill="none"
              stroke="#163f92"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />}
          </g>;
        } : offsets && ((pointer) => previewAt(pointer && [pointer[0], pointer[1]]))}
      >
        <path
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
        {zoneFills
          ?.filter(({ layerId }) => visible(layerId))
          .map(({ id, region, netId, layerId }) => (
            <path
              key={id}
              data-zone-fill={id}
              d={[region.outer, ...region.holes].map(ring).join(' ')}
              fillRule="evenodd"
              fill={
                netId === selectedNet
                  ? netHighlight
                  : layerId === 'top'
                  ? '#bf562f'
                  : '#477cae'
              }
              opacity={0.32}
              pointerEvents="none"
            />
          ))}
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
                      cx={start.x}
                      cy={-start.y}
                      r={screwHeadDiameterNm / 2}
                      vectorEffect="non-scaling-stroke"
                    />
                    {!!bodyClearanceNm && (
                      <circle
                        data-screw-body-clearance={screwHeadSide}
                        cx={start.x}
                        cy={-start.y}
                        r={screwHeadDiameterNm / 2 + bodyClearanceNm}
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
                      cx={position.x}
                      cy={-position.y}
                      r={landWidthNm / 2}
                      fill={netId === selectedNet ? netHighlight : '#b17a2d'}
                    />
                    <circle
                      cx={position.x}
                      cy={-position.y}
                      r={drillNm / 2}
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
        {(board.tracks ?? [])
          .filter(({ layerId }) => visible(layerId))
          .map(
            ({ id, start, end, widthNm, layerId, reviewRequired, netId, locked }) => (
              <path
                key={id}
                data-track={id}
                {...pickingAttributes?.({
                  kind: 'track', id, layer: layerId, locked,
                  label: board.nets?.find(({ id }) => id === netId)?.name ?? 'Unassigned',
                })}
                data-route-locked={locked || undefined}
                d={'M' + point(start) + ' L' + point(end)}
                fill="none"
                strokeLinecap="round"
                stroke={
                  netId && netId === selectedNet
                    ? netHighlight
                    : reviewRequired
                    ? '#a52c24'
                    : layerId === 'top'
                    ? '#b17a2d'
                    : '#397188'
                }
                strokeWidth={widthNm}
                data-net-highlighted={
                  (!!netId && netId === selectedNet) || undefined
                }
                onClick={(event) => selectRoute(event, id, netId)}
              />
            ),
          )}
        {(board.vias ?? []).map(
          ({ id, positionNm, diameterNm, drillNm, reviewRequired, netId, locked }) => (
            <g
              key={id}
              data-via={id}
              {...pickingAttributes?.({
                kind: 'via', id, layer: 'both', locked,
                label: board.nets?.find(({ id }) => id === netId)?.name ?? 'Unassigned',
              })}
              data-route-locked={locked || undefined}
              onClick={(event) => selectRoute(event, id, netId)}
            >
              <circle
                cx={positionNm.x}
                cy={-positionNm.y}
                r={diameterNm / 2}
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
                cx={positionNm.x}
                cy={-positionNm.y}
                r={drillNm / 2}
                fill="#fff"
              />
            </g>
          ),
        )}
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
        {geometry.features.map((feature) => {
          const position = feature.placement.positionNm;
          const inGroup = group.has(feature.id);
          const fill =
            feature.id === selected || inGroup ? '#b34b27' : '#226a59';
          return (
            <g
              key={feature.id}
              data-component={feature.id}
              data-placement-group={inGroup || undefined}
              onClick={(event) => {
                if (routing || onMeasure || deletion?.pickingRegion) return;
                event.stopPropagation();
                if (event.shiftKey && onGroupComponent)
                  onGroupComponent(feature.id);
                else onComponent(feature.id);
              }}
            >
              {feature.copper
                .filter(({ layerId }) => visible(layerId))
                .map(({ id, region, netId, layerId }) => {
                  const padId = id.split(':')[1];
                  const highlighted = !!netId && netId === selectedNet;
                  return (
                    <path
                      key={id}
                      {...pickingAttributes?.({
                        kind: 'pad', id: padId, layer: layerId, componentId: feature.id,
                        label: feature.label + ' · ' + (feature.pads.find(({ id }) => id === padId)?.label ?? padId),
                        locked: feature.placement.locked || feature.placement.positionLocked || feature.placement.rotationLocked,
                      })}
                      d={[region.outer, ...region.holes].map(ring).join(' ')}
                      fill={
                        highlighted
                          ? netHighlight
                          : feature.id === selected && padId === selectedPad
                          ? '#af242e'
                          : fill
                      }
                      fillRule="evenodd"
                      data-net-highlighted={highlighted || undefined}
                      onClick={(event) => {
                        if (routing || deletion?.pickingRegion) return;
                        event.stopPropagation();
                        if (event.shiftKey && onGroupComponent) {
                          onGroupComponent(feature.id);
                          return;
                        }
                        const pad = feature.pads.find(({ id }) => id === padId);
                        if (pad)
                          onPad(feature.id, padId, pad.position);
                      }}
                    />
                  );
                })}
              {!feature.copper.length &&
                visible(feature.placement.side) && feature.pads.map(({ id, position, netId, label }) => (
                  <circle
                    key={id}
                    {...pickingAttributes?.({
                      kind: 'pad', id, layer: feature.placement.side, componentId: feature.id,
                      label: feature.label + ' · ' + label,
                      locked: feature.placement.locked || feature.placement.positionLocked || feature.placement.rotationLocked,
                    })}
                    cx={position.x}
                    cy={-position.y}
                    fill={
                      netId && netId === selectedNet
                        ? netHighlight
                        : feature.id === selected && id === selectedPad
                        ? '#af242e'
                        : fill
                    }
                    r={margin * 0.085}
                    data-net-highlighted={
                      (!!netId && netId === selectedNet) || undefined
                    }
                    onClick={(event) => {
                      if (routing || deletion?.pickingRegion) return;
                      event.stopPropagation();
                      if (event.shiftKey && onGroupComponent)
                        onGroupComponent(feature.id);
                      else onPad(feature.id, id, position);
                    }}
                  />
                ))}
              <ScaledSvgText
                x={position.x}
                y={-position.y - margin * 0.14}
                fill="#192b22"
                fontSize={margin * 0.29}
              >
                {feature.label}
              </ScaledSvgText>
            </g>
          );
        })}
        {silk.filter(({ target }) => visible(target.layer)).map(({ target, placement, graphic }) => (
          <g key={target.id} {...pickingAttributes?.(target)}
            data-picked-silk={selectedSilk === target.id || undefined}
            transform={placementTransform(placement.positionNm, placement.rotationMicrodegree, placement.side)}
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
          <g data-measurement-datum pointerEvents="none" transform={`translate(${point(datum)})`}>
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
                  Number(trackWidth) * 1_000_000 || 0,
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
            cx={checkMarker.x}
            cy={-checkMarker.y}
            r={margin / 3}
            stroke="#bd2222"
            vectorEffect="non-scaling-stroke"
            strokeWidth={2}
            fill="none"
            pointerEvents="none"
          />
        )}
      </SvgViewport>
    </div>
  );
}
