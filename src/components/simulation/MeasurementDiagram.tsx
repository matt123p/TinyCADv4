import React, { useId, useMemo } from 'react';
import { ResultData } from '../../simulation/contracts';
import {
  MeasurementDefinition,
  MeasurementResult,
} from '../../simulation/explorerTypes';
import { measurementDiagram } from '../../simulation/measurementDiagram';
import { measurementLabels } from '../../simulation/measurementPresentation';
import { scopeQuantity } from '../../simulation/scopeControls';

export function MeasurementDiagram({
  definition,
  data,
  result,
  captured = false,
}: {
  definition: MeasurementDefinition;
  data?: ResultData;
  result?: MeasurementResult;
  captured?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const model = useMemo(
    () => measurementDiagram(definition, data, result),
    [definition, data, result],
  );
  const { points, reference, lines, interval } = model;
  if (!points.length || (captured && !data))
    return (
      <figure
        aria-label={`${measurementLabels[definition.kind]} measurement diagram`}
        style={{
          margin: '8px 0',
          padding: 8,
          border: '1px solid #ccd6df',
          borderRadius: 6,
        }}
      >
        <figcaption>
          {measurementLabels[definition.kind]} · Selected acquisition
        </figcaption>
        <p role="status" style={{ color: '#a4262c', fontSize: 12 }}>
          {(result?.state !== 'valid' && result?.explanation) ||
            (!data
              ? 'Numerical data for this acquisition is no longer available. Run a new acquisition to view the captured signal.'
              : model.description)}
        </p>
        {data && result?.explanation && (
          <p style={{ fontSize: 11 }}>{model.description}</p>
        )}
      </figure>
    );
  const x0 = points[0].x,
    x1 = points.at(-1).x;
  const ys = [
    ...points.map((p) => p.y),
    ...(reference || []).map((p) => p.y),
    ...lines.map((l) => l.value),
    0,
  ];
  const low = Math.min(...ys),
    high = Math.max(...ys),
    span = high - low || 1;
  const transform = (x: number) =>
    model.logX ? Math.log10(Math.max(x, 1e-30)) : x;
  const px = (x: number) =>
    x1 === x0
      ? 310
      : 40 +
        (540 * (transform(x) - transform(x0))) /
          (transform(x1) - transform(x0) || 1);
  const py = (y: number) => 133 - (110 * (y - low + span * 0.1)) / (span * 1.2);
  const path = (wave: typeof points) =>
    wave
      .map(
        (p, i) => `${i ? 'L' : 'M'}${px(p.x).toFixed(2)},${py(p.y).toFixed(2)}`,
      )
      .join(' ');
  const left = Math.max(40, Math.min(580, px(model.from))),
    right = Math.max(40, Math.min(580, px(model.to)));
  return (
    <figure
      aria-label={`${measurementLabels[definition.kind]} measurement diagram`}
      style={{
        margin: '8px 0',
        padding: 8,
        border: '1px solid #ccd6df',
        borderRadius: 6,
        background: '#f6f9fc',
        maxWidth: 760,
      }}
    >
      <figcaption
        style={{
          fontSize: 11,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <strong>
          {measurementLabels[definition.kind]} ·{' '}
          {model.actual
            ? 'Selected acquisition'
            : 'Illustration — not acquired data'}
        </strong>
        {model.annotations && (
          <span>
            Highlighted: {definition.from || 'start'} – {definition.to || 'end'}
          </span>
        )}
      </figcaption>
      {result && result.state !== 'valid' && (
        <p
          role="status"
          style={{ color: '#a4262c', fontSize: 12, margin: '4px 0' }}
        >
          {result.explanation}
        </p>
      )}
      <svg
        viewBox="0 0 600 166"
        role="img"
        aria-label={model.description}
        style={{
          display: 'block',
          width: '100%',
          maxHeight: 185,
          font: '10px Segoe UI,sans-serif',
        }}
      >
        <defs>
          <clipPath id={id}>
            <rect x={40} y={12} width={540} height={126} />
          </clipPath>
          <clipPath id={`${id}window`}>
            <rect
              x={Math.min(left, right)}
              y={12}
              width={Math.abs(right - left)}
              height={126}
            />
          </clipPath>
        </defs>
        <rect
          x={40}
          y={12}
          width={540}
          height={126}
          fill="white"
          stroke="#ccd6df"
        />
        <g clipPath={`url(#${id})`}>
          {model.annotations && (
            <rect
              x={Math.min(left, right)}
              y={12}
              width={Math.abs(right - left)}
              height={126}
              fill="#e1efff"
            />
          )}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <line
              key={t}
              x1={40}
              x2={580}
              y1={12 + 126 * t}
              y2={12 + 126 * t}
              stroke="#dce5ed"
            />
          ))}
          <line x1={40} x2={580} y1={py(0)} y2={py(0)} stroke="#8d9eac" />
          {model.fill && (
            <path
              clipPath={`url(#${id}window)`}
              d={`${path(points)} L${px(x1)},${py(0)} L${px(x0)},${py(0)} Z`}
              fill="#75b4dd"
              opacity={0.25}
            />
          )}
          {reference && (
            <path
              d={path(reference)}
              fill="none"
              stroke="#526bcb"
              strokeWidth={1.5}
              strokeDasharray="5 3"
            />
          )}
          <path d={path(points)} fill="none" stroke="#00816f" strokeWidth={2} />
          {points.length === 1 && (
            <circle
              cx={px(points[0].x)}
              cy={py(points[0].y)}
              r={4}
              fill="#00816f"
            />
          )}
          {lines.map((line, i) => (
            <g key={i}>
              <line
                x1={left}
                x2={right}
                y1={py(line.value)}
                y2={py(line.value)}
                stroke="#b36b00"
                strokeWidth={1.5}
                strokeDasharray="5 3"
              />
              <text
                x={Math.min(470, Math.max(44, left + 4))}
                y={Math.max(22, py(line.value) - 4)}
                fill="#855000"
              >
                {line.label}
                {model.actual
                  ? ` ${scopeQuantity(line.reading ?? line.value, model.unit)}`
                  : ''}
              </text>
            </g>
          ))}
          {model.annotations &&
            [
              model.from,
              model.to,
              ...(interval ? [interval.from, interval.to] : []),
              ...(model.at !== undefined ? [model.at] : []),
            ].map((x, i) => (
              <line
                key={i}
                x1={px(x)}
                x2={px(x)}
                y1={12}
                y2={138}
                stroke={i < 2 ? '#8eabbf' : '#b36b00'}
                strokeDasharray="3 3"
              />
            ))}
        </g>
        <text x={3} y={20} fill="#445a6b">
          {model.unit}
        </text>
        <text x={40} y={155} fill="#445a6b">
          {scopeQuantity(x0, model.xUnit)}
        </text>
        {points.length > 1 && (
          <text x={580} y={155} textAnchor="end" fill="#445a6b">
            {scopeQuantity(x1, model.xUnit)}
          </text>
        )}
        {interval && (
          <g>
            <line
              x1={px(interval.from)}
              x2={px(interval.to)}
              y1={18}
              y2={18}
              stroke="#b36b00"
              strokeWidth={2}
            />
            <text
              x={(px(interval.from) + px(interval.to)) / 2}
              y={31}
              textAnchor="middle"
              fill="#855000"
            >
              {interval.label}
            </text>
          </g>
        )}
      </svg>
      <p style={{ fontSize: 11, margin: '2px 0' }}>{model.description}</p>
    </figure>
  );
}
