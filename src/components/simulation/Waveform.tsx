import React, { useState, useRef } from 'react';
import { ResultData } from '../../simulation/contracts';
import { download } from '../../simulation/export';

const colors = [
  '#0078d4',
  '#ca5010',
  '#107c10',
  '#8764b8',
  '#c239b3',
  '#008575',
];
export function Waveform({
  data,
  signals,
  baseline,
}: {
  data: ResultData;
  signals: string[];
  baseline?: ResultData;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [mode, setMode] = useState('real'),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState(0),
    [cursor, setCursor] = useState<number>(),
    [second, setSecond] = useState<number>();
  const [logX, setLogX] = useState(data.scale === 'frequency');
  const selected = data.vectors.filter(
    (v) =>
      v.name !== data.scale &&
      (signals.length ? signals.includes(v.name) : true),
  );
  const transform = (r: number, i: number) =>
    mode === 'phase'
      ? (Math.atan2(i, r) * 180) / Math.PI
      : mode === 'db'
      ? 20 * Math.log10(Math.max(1e-30, Math.hypot(r, i)))
      : mode === 'magnitude'
      ? Math.hypot(r, i)
      : r;
  const scale = data.vectors.find((v) => v.name === data.scale);
  const count = scale?.real.length || selected[0]?.real.length || 0;
  const xvalue = (i: number) => {
    const x = scale?.real[i] ?? i;
    return logX ? Math.log10(Math.max(1e-30, x)) : x;
  };
  const fullMin = count ? Math.min(xvalue(0), xvalue(count - 1)) : 0,
    fullMax = count ? Math.max(xvalue(0), xvalue(count - 1)) : 1,
    fullSpan = fullMax - fullMin || 1;
  const xmin = fullMin + pan * fullSpan,
    xmax = xmin + fullSpan / zoom;
  let ymin = Infinity,
    ymax = -Infinity;
  const series = selected.flatMap((v, j) => [
    { v, color: colors[j % colors.length], dashed: false },
    ...(baseline?.scale === data.scale &&
    baseline.vectors.find((b) => b.name === v.name && b.unit === v.unit)
      ? [
          {
            v: baseline.vectors.find((b) => b.name === v.name),
            color: colors[j % colors.length],
            dashed: true,
          },
        ]
      : []),
  ]);
  for (const { v, dashed } of series) {
    const xs = dashed
      ? baseline.vectors.find((b) => b.name === baseline.scale)
      : scale;
    for (let i = 0; i < v.real.length; i++) {
      const raw = xs?.real[i] ?? i;
      const x = logX ? Math.log10(Math.max(raw, 1e-30)) : raw;
      if (x < xmin || x > xmax) continue;
      const y = transform(v.real[i], v.imaginary?.[i] || 0);
      ymin = Math.min(ymin, y);
      ymax = Math.max(ymax, y);
    }
  }
  if (!Number.isFinite(ymin)) {
    ymin = -1;
    ymax = 1;
  }
  if (ymin === ymax) {
    ymin -= 1;
    ymax += 1;
  }
  const padding = (ymax - ymin) * 0.08;
  ymin -= padding;
  ymax += padding;
  const px = (x: number) => 70 + ((x - xmin) / (xmax - xmin)) * 800,
    py = (y: number) => 320 - ((y - ymin) / (ymax - ymin)) * 290;
  const paths = series.map(({ v, color, dashed }, j) => {
    const xs = dashed
      ? baseline.vectors.find((b) => b.name === baseline.scale)
      : scale;
    // Min/max bucket envelope preserves narrow spikes while bounding SVG cost.
    const points: string[] = [];
    const stride = Math.max(1, Math.floor(v.real.length / 1600));
    for (let i = 0; i < v.real.length; i += stride) {
      let lo = i,
        hi = i;
      for (let k = i + 1; k < Math.min(v.real.length, i + stride); k++) {
        if (
          transform(v.real[k], v.imaginary?.[k] || 0) <
          transform(v.real[lo], v.imaginary?.[lo] || 0)
        )
          lo = k;
        if (
          transform(v.real[k], v.imaginary?.[k] || 0) >
          transform(v.real[hi], v.imaginary?.[hi] || 0)
        )
          hi = k;
      }
      for (const k of [
        ...new Set([i, lo, hi, Math.min(i + stride - 1, v.real.length - 1)]),
      ].sort((a, b) => a - b)) {
        const raw = xs?.real[k] ?? k,
          x = logX ? Math.log10(Math.max(1e-30, raw)) : raw;
        if (x < xmin || x > xmax) continue;
        points.push(
          `${px(x)},${py(transform(v.real[k], v.imaginary?.[k] || 0))}`,
        );
      }
    }
    return (
      <polyline
        key={j}
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeDasharray={dashed ? '6 4' : undefined}
      >
        <title>
          {v.name} [{v.unit}]{dashed ? ' baseline' : ''}
        </title>
      </polyline>
    );
  });
  const cursorX = (index: number) => px(xvalue(index));
  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <label>
          Display{' '}
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="real">Real</option>
            <option value="magnitude">Magnitude</option>
            <option value="db">Magnitude (dB)</option>
            <option value="phase">Phase (°)</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={logX}
            onChange={(e) => setLogX(e.target.checked)}
          />
          Log horizontal axis
        </label>
        <button
          onClick={() => {
            setZoom(1);
            setPan(0);
          }}
        >
          Fit
        </button>
        <button onClick={() => setZoom(Math.min(100, zoom * 2))}>
          Zoom in
        </button>
        <button
          onClick={() => {
            setZoom(Math.max(1, zoom / 2));
            setPan(0);
          }}
        >
          Zoom out
        </button>
        {zoom > 1 && (
          <label>
            Pan
            <input
              aria-label="Pan plot"
              type="range"
              min="0"
              max={1 - 1 / zoom}
              step="0.001"
              value={pan}
              onChange={(e) => setPan(Number(e.target.value))}
            />
          </label>
        )}
        <button
          onClick={() => {
            const svg = svgRef.current;
            if (svg)
              download(
                'simulation.svg',
                new XMLSerializer().serializeToString(svg),
                'image/svg+xml',
              );
          }}
        >
          Export SVG
        </button>
      </div>
      <svg
        ref={svgRef}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 920 370"
        role="img"
        aria-label="Simulation waveform plot. Use the cursor sliders or Data table for precise values."
        style={{
          width: '100%',
          minHeight: 230,
          background: 'white',
          color: 'black',
        }}
        onClick={(e) => {
          if (!count) return;
          const rect = e.currentTarget.getBoundingClientRect(),
            x =
              xmin +
              ((((e.clientX - rect.left) / rect.width) * 920 - 70) / 800) *
                (xmax - xmin);
          let best = 0;
          for (let i = 1; i < count; i++)
            if (Math.abs(xvalue(i) - x) < Math.abs(xvalue(best) - x)) best = i;
          e.shiftKey ? setSecond(best) : setCursor(best);
        }}
      >
        <rect
          x="70"
          y="30"
          width="800"
          height="290"
          fill="none"
          stroke="#888"
        />
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i} fontSize="11" fill="#333">
            <line
              x1="70"
              y1={30 + i * 72.5}
              x2="870"
              y2={30 + i * 72.5}
              stroke="#ddd"
            />
            <text x="65" y={34 + i * 72.5} textAnchor="end">
              {(ymax - (i * (ymax - ymin)) / 4).toPrecision(4)}
            </text>
            <text x={70 + i * 200} y="340" textAnchor="middle">
              {(logX
                ? 10 ** (xmin + (i * (xmax - xmin)) / 4)
                : xmin + (i * (xmax - xmin)) / 4
              ).toPrecision(4)}
            </text>
          </g>
        ))}
        {paths}
        {[cursor, second]
          .filter((i) => i !== undefined && i < count)
          .map((i, j) => (
            <line
              key={j}
              x1={cursorX(i)}
              x2={cursorX(i)}
              y1="30"
              y2="320"
              stroke={j ? '#666' : '#111'}
              strokeDasharray="4 3"
            />
          ))}
        <text x="470" y="362" textAnchor="middle" fill="black" fontSize="12">
          {data.scale || 'Sample'} {scale ? `[${scale.unit}]` : ''}
        </text>
      </svg>
      <div>
        {selected.map((v, j) => (
          <span
            key={v.name}
            style={{ color: colors[j % colors.length], marginRight: 16 }}
          >
            {v.name} [{mode === 'phase' ? '°' : mode === 'db' ? 'dB' : v.unit}]
          </span>
        ))}
      </div>
      {count > 0 && (
        <div>
          <label>
            Cursor A{' '}
            <input
              type="range"
              min="0"
              max={count - 1}
              value={cursor ?? 0}
              onChange={(e) => setCursor(Number(e.target.value))}
            />
          </label>
          <label>
            Cursor B{' '}
            <input
              type="range"
              min="0"
              max={count - 1}
              value={second ?? 0}
              onChange={(e) => setSecond(Number(e.target.value))}
            />
          </label>
          <output>
            {cursor !== undefined
              ? `${data.scale || 'Sample'}: ${scale?.real[cursor] ?? cursor}${
                  second !== undefined
                    ? `; Δ: ${
                        (scale?.real[second] ?? second) -
                        (scale?.real[cursor] ?? cursor)
                      }`
                    : ''
                }`
              : ''}
          </output>
          {cursor !== undefined && (
            <ul>
              {selected.map((v) => (
                <li key={v.name}>
                  {v.name}:{' '}
                  {transform(
                    v.real[cursor],
                    v.imaginary?.[cursor] || 0,
                  ).toPrecision(7)}{' '}
                  {mode === 'phase' ? '°' : mode === 'db' ? 'dB' : v.unit}
                  {second !== undefined
                    ? `; Δ ${
                        transform(v.real[second], v.imaginary?.[second] || 0) -
                        transform(v.real[cursor], v.imaginary?.[cursor] || 0)
                      }`
                    : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
