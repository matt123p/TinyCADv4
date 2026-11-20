import React, { useMemo, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from '@fluentui/react-components';
import { boardPadSources } from '../../pcb/hierarchicalSnapshot';
import { boardPlacementView } from '../../pcb/boardPlacement';
import { lengthInNanometres } from '../../pcb/geometry';
import type { BoardPoint } from '../../pcb/geometry';
import type { ProjectBoardWorkspace } from '../../io/projectBoardWorkspace';

const mm = (value: number) => String(value / 1_000_000);
const nm = (value: string) => lengthInNanometres(value, 'mm');
const point = ({ x, y }: BoardPoint) => `${x},${-y}`;
const ring = (points: readonly BoardPoint[]) =>
  'M' + points.map(point).join(' L') + ' Z';

export default function ProjectBoardWorkspaceDialog({
  session,
  onClose,
  syncStatus,
  probe,
  onProbe,
  onUpdate,
  onEditReferences,
  onBackAnnotate,
}: {
  session: ProjectBoardWorkspace;
  onClose(): void;
  syncStatus?: string;
  probe?: { componentId: string; padId?: string };
  onProbe(source: ReturnType<typeof boardPadSources>[number]['source']): void;
  onUpdate(): void;
  onEditReferences(): void;
  onBackAnnotate(): void;
}) {
  const [board, setBoard] = useState(session.board);
  const [selected, setSelected] = useState(probe?.componentId ?? '');
  const [x, setX] = useState('10');
  const [y, setY] = useState('10');
  const [rotation, setRotation] = useState('0');
  const [side, setSide] = useState<'top' | 'bottom'>('top');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const layout = useMemo<{
    geometry?: ReturnType<typeof boardPlacementView>;
    error?: string;
  }>(() => {
    try {
      return { geometry: boardPlacementView(board) };
    } catch (failure) {
      return { error: String(failure) };
    }
  }, [board]);
  const { geometry } = layout;
  const placed = new Set(
    board.footprints?.map(({ componentId }) => componentId),
  );
  const unplaced = (board.components ?? []).filter(({ id }) => !placed.has(id));
  const target = unplaced.find(({ id }) => id === selected);
  const selectedPlacement = board.footprints?.find(
    ({ componentId }) => componentId === selected,
  );
  const sourcePads =
    session.circuit && selectedPlacement
      ? boardPadSources(board, session.circuit).filter(
          ({ footprintId }) => footprintId === selectedPlacement.id,
        )
      : [];
  const area = geometry?.profile.outer.reduce(
    (bounds, p) => [
      Math.min(bounds[0], p.x),
      Math.min(bounds[1], -p.y),
      Math.max(bounds[2], p.x),
      Math.max(bounds[3], -p.y),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
  const margin = area
    ? Math.max(area[2] - area[0], area[3] - area[1]) * 0.06
    : 0;
  const netAnchors = new Map<string, BoardPoint[]>();
  for (const feature of geometry?.features ?? []) {
    for (const { netId, position } of feature.pads) {
      if (!netId) continue;
      if (!netAnchors.has(netId)) netAnchors.set(netId, []);
      netAnchors.get(netId).push(position);
    }
  }

  async function place() {
    if (!target) return;
    setBusy(true);
    setError('');
    try {
      const angle = ((nm(rotation) % 360_000_000) + 360_000_000) % 360_000_000;
      setBoard(
        await session.place(target.id, {
          positionNm: { x: nm(x), y: nm(y) },
          rotationMicrodegree: angle,
          side,
        }),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(_, data) => {
        if (!data.open && !busy) onClose();
      }}
    >
      <DialogSurface style={{ maxWidth: 1100 }}>
        <DialogBody>
          <DialogTitle>PCB layout</DialogTitle>
          <DialogContent>
            <p>
              {session.path}
              {syncStatus ? ' · ' + syncStatus : ''}
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 3fr) minmax(200px, 1fr)',
                gap: 12,
              }}
            >
              {area && geometry ? (
                <svg
                  role="img"
                  aria-label="Board layout"
                  width="100%"
                  height="420"
                  viewBox={`${area[0] - margin} ${area[1] - margin} ${
                    area[2] - area[0] + 2 * margin
                  } ${area[3] - area[1] + 2 * margin}`}
                  onClick={(event) => {
                    if (
                      !target ||
                      (event.target !== event.currentTarget &&
                        (event.target as Element).closest('[data-component]'))
                    )
                      return;
                    const canvas = event.currentTarget;
                    const transform = canvas.getScreenCTM()?.inverse();
                    if (!transform) return;
                    const root = new DOMPoint(
                      event.clientX,
                      event.clientY,
                    ).matrixTransform(transform);
                    setX(mm(Math.round(root.x)));
                    setY(mm(Math.round(-root.y)));
                  }}
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
                  {(board.tracks ?? []).map(
                    ({ id, start, end, widthNm, layerId, reviewRequired }) => (
                      <path
                        key={id}
                        d={'M' + point(start) + ' L' + point(end)}
                        fill="none"
                        strokeLinecap="round"
                        stroke={
                          reviewRequired
                            ? '#a52c24'
                            : layerId === 'top'
                            ? '#b17a2d'
                            : '#397188'
                        }
                        strokeWidth={widthNm}
                      />
                    ),
                  )}
                  {(board.vias ?? []).map(
                    ({
                      id,
                      positionNm,
                      diameterNm,
                      drillNm,
                      reviewRequired,
                    }) => (
                      <g key={id}>
                        <circle
                          cx={positionNm.x}
                          cy={-positionNm.y}
                          r={diameterNm / 2}
                          fill={reviewRequired ? '#a52c24' : '#79644e'}
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
                  {[...netAnchors].flatMap(([net, [start, ...anchors]]) =>
                    anchors.map((end, index) => (
                      <path
                        key={net + ':' + index}
                        d={'M' + point(start) + ' L' + point(end)}
                        stroke="#8292a3"
                        fill="none"
                        strokeWidth={margin * 0.04}
                        strokeDasharray={margin * 0.16}
                        pointerEvents="none"
                      />
                    )),
                  )}
                  {geometry.features.map((feature) => {
                    const position = feature.placement.positionNm;
                    const fill =
                      feature.id === selected ? '#b34b27' : '#226a59';
                    return (
                      <g
                        key={feature.id}
                        data-component={feature.id}
                        onClick={() => setSelected(feature.id)}
                      >
                        {feature.copper.map(({ id, region }) => (
                          <path
                            key={id}
                            d={[region.outer, ...region.holes]
                              .map(ring)
                              .join(' ')}
                            fill={
                              feature.id === probe?.componentId &&
                              id.split(':')[1] === probe.padId
                                ? '#af242e'
                                : fill
                            }
                            fillRule="evenodd"
                          />
                        ))}
                        {!feature.copper.length &&
                          feature.pads.map(({ id, position }) => (
                            <circle
                              key={id}
                              cx={position.x}
                              cy={-position.y}
                              fill={fill}
                              r={margin * 0.085}
                            />
                          ))}
                        <text
                          x={position.x}
                          y={-position.y - margin * 0.14}
                          fill="#192b22"
                          fontSize={margin * 0.29}
                        >
                          {feature.label}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              ) : (
                <p role="alert">{layout.error}</p>
              )}
              <div style={{ maxHeight: '65vh', overflow: 'auto' }}>
                <h3>Unplaced components</h3>
                {unplaced.length ? (
                  <ul aria-label="Unplaced components">
                    {unplaced.map(({ id, reference, value, deviceId }) => (
                      <li key={id}>
                        <Button
                          size="small"
                          appearance={id === selected ? 'primary' : 'subtle'}
                          disabled={busy || !deviceId}
                          onClick={() => setSelected(id)}
                        >
                          {reference ?? id}
                          {value ? ' · ' + value : ''}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>All board components are placed.</p>
                )}
                {!!sourcePads.length && (
                  <>
                    <h3>Schematic connections</h3>
                    <ul aria-label="Schematic connections">
                      {sourcePads.map(({ padId, padLabel, signal, source }) => (
                        <li
                          key={padId + ':' + source.unitId + ':' + source.pinId}
                        >
                          <Button size="small" onClick={() => onProbe(source)}>
                            {padLabel} · {signal}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {!!geometry?.features.length && (
                  <>
                    <h3>Placed components</h3>
                    <ul aria-label="Placed components">
                      {geometry.features.map(({ id, label }) => (
                        <li key={id}>
                          <Button
                            size="small"
                            appearance={id === selected ? 'primary' : 'subtle'}
                            onClick={() => setSelected(id)}
                          >
                            {label}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
            {target && (
              <fieldset disabled={busy}>
                <legend>Place {target.reference ?? 'component'}</legend>
                <label>
                  X (mm){' '}
                  <input
                    size={6}
                    value={x}
                    onChange={(e) => setX(e.target.value)}
                  />
                </label>{' '}
                <label>
                  Y (mm){' '}
                  <input
                    size={6}
                    value={y}
                    onChange={(e) => setY(e.target.value)}
                  />
                </label>{' '}
                <label>
                  Rotation (°){' '}
                  <input
                    size={6}
                    value={rotation}
                    onChange={(e) => setRotation(e.target.value)}
                  />
                </label>{' '}
                <label>
                  Board side{' '}
                  <select
                    value={side}
                    onChange={(e) => setSide(e.target.value as typeof side)}
                  >
                    {board.copperLayers.map(({ id }) => (
                      <option key={id} value={id}>
                        {id === 'top' ? 'Top' : 'Bottom'}
                      </option>
                    ))}
                  </select>
                </label>{' '}
                <Button
                  appearance="primary"
                  onClick={(): void => {
                    void place();
                  }}
                >
                  Place and save
                </Button>
              </fieldset>
            )}
            {error && <p role="alert">{error}</p>}
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={onUpdate}>
              Update PCB from Schematic…
            </Button>
            <Button
              disabled={busy || !board.components?.length}
              onClick={onEditReferences}
            >
              Edit PCB references…
            </Button>
            <Button
              disabled={busy || !session.circuit}
              onClick={onBackAnnotate}
            >
              Update Schematic from PCB…
            </Button>
            <Button disabled={busy} onClick={onClose}>
              Close
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
