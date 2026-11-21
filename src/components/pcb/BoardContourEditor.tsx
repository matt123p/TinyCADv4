import React from 'react';
import { Button } from '@fluentui/react-components';
import type { ContourEdge } from '../../pcb/contours';
import { repairProfileJunction } from '../../pcb/boardProfiles';
import {
  isBoardPoint,
  lengthInNanometres,
  OutlineTopologyError,
} from '../../pcb/geometry';
import type { BoardPoint } from '../../pcb/geometry';

const nm = (value: string) => lengthInNanometres(value, 'mm');
const mm = (value: number) => String(value / 1_000_000);
const pair = ({ x, y }: BoardPoint) => ({ x: mm(x), y: mm(y) });

export type ContourRow = {
  readonly kind: ContourEdge['kind'];
  readonly start: { x: string; y: string };
  readonly end: { x: string; y: string };
  readonly centre: { x: string; y: string };
  readonly clockwise: boolean;
};

export function contourRow(edge: ContourEdge): ContourRow {
  return {
    kind: edge.kind,
    start: pair(edge.start),
    end: pair(edge.end),
    centre: pair(
      edge.kind === 'arc'
        ? edge.centre
        : {
            x: (edge.start.x + edge.end.x) / 2,
            y: (edge.start.y + edge.end.y) / 2,
          },
    ),
    clockwise: edge.kind === 'arc' && edge.clockwise,
  };
}

function readPoint({ x, y }: ContourRow['start']) {
  const point = { x: nm(x), y: nm(y) };
  if (!isBoardPoint(point))
    throw new Error('Coordinate is outside the board range.');
  return point;
}

function readEdge(row: ContourRow, index: number): ContourEdge {
  let start: BoardPoint;
  try {
    start = readPoint(row.start);
    const end = readPoint(row.end);
    return row.kind === 'line'
      ? { kind: 'line', start, end }
      : {
          kind: 'arc',
          start,
          end,
          centre: readPoint(row.centre),
          clockwise: row.clockwise,
        };
  } catch (failure) {
    throw new OutlineTopologyError(
      'Enter valid coordinates for edge ' +
        (index + 1) +
        '. ' +
        (failure instanceof Error ? failure.message : String(failure)),
      index,
      start,
    );
  }
}

export function readContourRows(rows: readonly ContourRow[]) {
  return rows.map(readEdge);
}

function edgePath(edge: ContourEdge) {
  const { start, end } = edge;
  const begin = `M${start.x},${-start.y}`;
  const finish = `${end.x},${-end.y}`;
  if (edge.kind === 'line') return begin + ' L' + finish;
  const { centre, clockwise } = edge;
  const arrive = Math.atan2(end.y - centre.y, end.x - centre.x);
  const leave = Math.atan2(start.y - centre.y, start.x - centre.x);
  const turn = 2 * Math.PI;
  const sweep = ((clockwise ? leave - arrive : arrive - leave) + turn) % turn;
  const radius = Math.hypot(start.x - centre.x, start.y - centre.y);
  return `${begin} A${radius},${radius} 0 ${sweep > Math.PI ? 1 : 0} ${
    clockwise ? 1 : 0
  } ${finish}`;
}

export function ProfilePreview({
  edges,
  background,
  issue,
}: {
  edges: readonly (ContourEdge | undefined)[];
  background: readonly ContourEdge[];
  issue?: OutlineTopologyError;
}) {
  const paths = [...background, ...edges.filter(Boolean)];
  if (!paths.length) return null;
  const bounds = paths.reduce(
    (box, edge) => {
      const points = [edge.start, edge.end];
      if (edge.kind === 'arc') {
        const radius = Math.hypot(
          edge.start.x - edge.centre.x,
          edge.start.y - edge.centre.y,
        );
        points.push(
          { x: edge.centre.x - radius, y: edge.centre.y - radius },
          { x: edge.centre.x + radius, y: edge.centre.y + radius },
        );
      }
      for (const { x, y } of points) {
        box.minX = Math.min(box.minX, x);
        box.minY = Math.min(box.minY, -y);
        box.maxX = Math.max(box.maxX, x);
        box.maxY = Math.max(box.maxY, -y);
      }
      return box;
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  const { minX, minY, maxX, maxY } = bounds;
  const margin = Math.max(500_000, 0.1 * Math.max(maxX - minX, maxY - minY));
  return (
    <svg
      role="img"
      aria-label="Profile draft"
      className="pcb-contour-preview"
      viewBox={[
        minX - margin,
        minY - margin,
        maxX - minX + 2 * margin,
        maxY - minY + 2 * margin,
      ].join(' ')}
      fill="none"
      vectorEffect="non-scaling-stroke"
    >
      {background.map((edge, index) => (
        <path
          key={index}
          d={edgePath(edge)}
          stroke="#779087"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {edges.map(
        (edge, index) =>
          edge && (
            <path
              key={index}
              data-profile-edge={index + 1}
              d={edgePath(edge)}
              stroke={
                issue?.edgeIndex === index || issue?.otherEdgeIndex === index
                  ? '#b32623'
                  : '#22576b'
              }
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ),
      )}
      {issue?.location && (
        <circle
          data-profile-issue
          cx={issue.location.x}
          cy={-issue.location.y}
          r={margin / 4}
          stroke="#b32623"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

export default function BoardContourEditor({
  rows,
  background,
  issue,
  onChange,
}: {
  rows: readonly ContourRow[];
  background: readonly ContourEdge[];
  issue?: OutlineTopologyError;
  onChange(rows: ContourRow[]): void;
}) {
  const parsed = rows.map((row, index) => {
    try {
      return readEdge(row, index);
    } catch {
      return undefined;
    }
  });
  const complete = parsed.every(Boolean);
  function patch(index: number, values: Partial<ContourRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...values } : row)));
  }

  function add(kind: ContourRow['kind']) {
    const start = rows.at(-1)?.end ?? { x: '0', y: '0' };
    const end = rows[0]?.start ?? { x: '10', y: '0' };
    const centre = {
      x: String((Number(start.x) + Number(end.x)) / 2),
      y: String((Number(start.y) + Number(end.y)) / 2),
    };
    onChange([...rows, { kind, start, end, centre, clockwise: false }]);
  }

  return (
    <div className="pcb-contour-editor">
      <ProfilePreview edges={parsed} background={background} issue={issue} />
      <p>
        Enter edge coordinates in millimetres. Each edge must end where the next
        one starts.
      </p>
      <div className="pcb-contour-edges">
        {rows.map((row, index) => {
          const fields =
            row.kind === 'arc'
              ? (['start', 'end', 'centre'] as const)
              : (['start', 'end'] as const);
          const repair = complete && repairProfileJunction(parsed, index);
          return (
            <fieldset
              key={index}
              className="pcb-contour-edge"
              aria-invalid={
                issue?.edgeIndex === index ||
                issue?.otherEdgeIndex === index ||
                undefined
              }
            >
              <legend>Edge {index + 1}</legend>
              <label>
                Type
                <select
                  aria-label="Type"
                  value={row.kind}
                  onChange={(e) =>
                    patch(index, { kind: e.target.value as ContourRow['kind'] })
                  }
                >
                  <option value="line">Line</option>
                  <option value="arc">Circular arc</option>
                </select>
              </label>
              {fields.map((field) =>
                (['x', 'y'] as const).map((axis) => (
                  <label key={field + axis}>
                    {field[0].toUpperCase() + field.slice(1)}{' '}
                    {axis.toUpperCase()}
                    <input
                      value={row[field][axis]}
                      onChange={(e) =>
                        patch(index, {
                          [field]: { ...row[field], [axis]: e.target.value },
                        })
                      }
                    />
                  </label>
                )),
              )}
              {row.kind === 'arc' && (
                <label>
                  Direction
                  <select
                    value={row.clockwise ? 'clockwise' : 'counterclockwise'}
                    onChange={(e) =>
                      patch(index, {
                        clockwise: e.target.value === 'clockwise',
                      })
                    }
                  >
                    <option value="counterclockwise">Counterclockwise</option>
                    <option value="clockwise">Clockwise</option>
                  </select>
                </label>
              )}
              <Button
                type="button"
                size="small"
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
              >
                Remove edge {index + 1}
              </Button>
              {repair && (
                <Button
                  type="button"
                  size="small"
                  onClick={() => {
                    const next = (index + 1) % rows.length;
                    const changed = rows.slice();
                    if (repair[index] !== parsed[index])
                      changed[index] = {
                        ...rows[index],
                        end: pair(repair[index].end),
                      };
                    if (repair[next] !== parsed[next])
                      changed[next] = {
                        ...rows[next],
                        start: pair(repair[next].start),
                      };
                    onChange(changed);
                  }}
                >
                  Close small gap after edge {index + 1}
                </Button>
              )}
            </fieldset>
          );
        })}
      </div>
      <Button type="button" size="small" onClick={() => add('line')}>
        Add line edge
      </Button>
      <Button type="button" size="small" onClick={() => add('arc')}>
        Add circular arc
      </Button>
    </div>
  );
}
