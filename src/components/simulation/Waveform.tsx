import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, registerables, ChartDataset, ChartOptions } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import {
  Button,
  Checkbox,
  Field,
  Input,
  Select,
} from '@fluentui/react-components';
import { ResultData } from '../../simulation/contracts';
import { csv, download } from '../../simulation/export';
import { signalLabel } from '../../simulation/signals';
import {
  chartPoints,
  DisplayMode,
  displayUnit,
  displayValue,
} from '../../simulation/chartData';

Chart.register(...registerables, zoomPlugin);
const colors = [
  '#0078d4',
  '#ca5010',
  '#107c10',
  '#8764b8',
  '#c239b3',
  '#008575',
];
const row: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  alignItems: 'center',
};
const number = (n: number) =>
  Number.isFinite(n)
    ? n.toLocaleString(undefined, { maximumSignificantDigits: 6 })
    : '—';

export function Waveform({
  data,
  signals,
  baseline,
  compact = false,
  overlays,
  evidence,
  initialMode = 'real',
  channelScales,
  showCursors = false,
}: {
  data: ResultData;
  signals: string[];
  baseline?: ResultData;
  compact?: boolean;
  overlays?: { label: string; data: ResultData }[];
  evidence?: { from: number; to: number };
  initialMode?: DisplayMode;
  channelScales?: Record<
    string,
    { scale: number; offset: number; color: string }
  >;
  showCursors?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart<'line'>>();
  const viewport = useRef<{ min: number; max: number }>();
  const [mode, setMode] = useState<DisplayMode>(initialMode);
  const [logX, setLogX] = useState(data.scale === 'frequency');
  const [grid, setGrid] = useState(true);
  const [axisLabels, setAxisLabels] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState(0),
    [second, setSecond] = useState(0);
  const cursorMarkers = useRef({ a: 0, b: 0 });
  cursorMarkers.current = { a: cursor, b: second };
  const selected = useMemo(
    () =>
      data.vectors.filter(
        (v) =>
          v.name !== data.scale &&
          (!signals.length || signals.includes(v.name)),
      ),
    [data, signals],
  );
  const axisKey = (v: ResultData['vectors'][number]) =>
    channelScales?.[v.name] ? v.name : displayUnit(v, mode);
  const units = [...new Set(selected.map(axisKey))];
  const scale = data.vectors.find((v) => v.name === data.scale);
  const count = scale?.real.length || selected[0]?.real.length || 0;
  const xLabel =
    data.scale === 'time'
      ? 'Time (s)'
      : data.scale === 'frequency'
      ? 'Frequency (Hz)'
      : scale
      ? `${scale.name} (${scale.unit})`
      : 'Sample';

  useEffect(() => {
    if (!canvas.current) return;
    const datasets: ChartDataset<'line'>[] = [];
    const refine: ((range: { min: number; max: number }) => void)[] = [];
    const append = (
      dataset: ChartDataset<'line'>,
      source: ResultData,
      vector: ResultData['vectors'][number],
    ) => {
      const full = chartPoints(source, vector, mode, logX).sort(
        (a, b) => a.x - b.x,
      );
      dataset.data = full;
      datasets.push(dataset);
      refine.push((range) => {
        const detailed = chartPoints(source, vector, mode, logX, range);
        dataset.data = [
          ...new Map(
            [...full, ...detailed].map((point) => [point.x, point]),
          ).values(),
        ].sort((a, b) => a.x - b.x);
      });
    };
    const detail = ({ chart: instance }: { chart: Chart }) => {
      const range = { min: instance.scales.x.min, max: instance.scales.x.max };
      refine.forEach((fn) => fn(range));
      instance.update('none');
    };
    selected.forEach((v, index) => {
      const axis = `y${units.indexOf(axisKey(v))}`;
      const color =
        channelScales?.[v.name]?.color || colors[index % colors.length];
      append(
        {
          label: `${signalLabel(v.name)} (${displayUnit(v, mode)})`,
          yAxisID: axis,
          data: [],
          borderColor: color,
          backgroundColor: color,
          borderWidth: 1.5,
          pointRadius: count === 1 ? 4 : 0,
          pointHitRadius: 8,
        },
        data,
        v,
      );
      const previous =
        baseline?.scale === data.scale &&
        baseline.vectors.find((b) => b.name === v.name && b.unit === v.unit);
      if (previous)
        append(
          {
            label: `${signalLabel(v.name)} baseline (${displayUnit(v, mode)})`,
            yAxisID: axis,
            data: [],
            borderColor: color,
            borderWidth: 1.5,
            borderDash: [6, 4],
            pointRadius: 0,
          },
          baseline,
          previous,
        );
    });
    overlays?.forEach((overlay, index) => {
      selected.forEach((v) => {
        const source = overlay.data.vectors.find(
          (b) => b.name === v.name && b.unit === v.unit,
        );
        if (source && overlay.data.scale === data.scale)
          append(
            {
              label: `${overlay.label} · ${signalLabel(v.name)}`,
              yAxisID: `y${units.indexOf(axisKey(v))}`,
              data: [],
              borderColor: colors[(index + 1) % colors.length],
              borderWidth: 1,
              pointRadius: 0,
            },
            overlay.data,
            source,
          );
      });
    });
    const scales: ChartOptions<'line'>['scales'] = {
      x: {
        type: logX ? 'logarithmic' : 'linear',
        title: {
          display: true,
          text:
            axisLabels.x || (channelScales ? 'Time from trigger (ms)' : xLabel),
          ...(channelScales ? { color: '#dbeaf4' } : {}),
        },
        grid: {
          display: grid,
          ...(channelScales ? { color: 'rgba(210,230,245,.15)' } : {}),
        },
        ticks: {
          maxTicksLimit: 10,
          ...(channelScales ? { color: '#dbeaf4' } : {}),
        },
        ...(channelScales
          ? {
              afterBuildTicks: (scale) => {
                scale.ticks = Array.from({ length: 11 }, (_, i) => ({
                  value: scale.min + ((scale.max - scale.min) * i) / 10,
                }));
              },
              ticks: {
                autoSkip: false,
                maxRotation: 0,
                minRotation: 0,
                callback: (value, index) =>
                  index % 2
                    ? ''
                    : (
                        (Number(value) - (evidence?.from || 0)) *
                        1000
                      ).toPrecision(3),
                color: '#dbeaf4',
              },
            }
          : {}),
        ...(evidence ? { min: evidence.from, max: evidence.to } : {}),
      },
    };
    units.forEach((unit, index) => {
      const channel = channelScales?.[unit];
      scales[`y${index}`] = {
        ...(channel
          ? {
              min: channel.offset - 4 * channel.scale,
              max: channel.offset + 4 * channel.scale,
            }
          : {}),
        type: 'linear',
        axis: 'y',
        position: index % 2 ? 'right' : 'left',
        title: {
          display: true,
          ...(channel ? { color: channel.color } : {}),
          text: channel
            ? `${unit} (V)`
            : axisLabels[unit] ||
              {
                V: 'Voltage (V)',
                A: 'Current (A)',
                W: 'Power (W)',
                '°': 'Phase (°)',
                dB: 'Magnitude (dB)',
              }[unit] ||
              unit,
        },
        grid: {
          display: grid,
          drawOnChartArea: index === 0,
          ...(channel ? { color: 'rgba(210,230,245,.15)' } : {}),
        },
        ticks: {
          maxTicksLimit: channel ? 9 : compact ? 5 : 8,
          ...(channel ? { stepSize: channel.scale, color: channel.color } : {}),
          ...(channel ? { autoSkip: false } : {}),
        },
      };
    });
    const instance = new Chart(canvas.current, {
      type: 'line',
      data: { datasets },
      plugins: showCursors
        ? [
            {
              id: 'instrument-cursors',
              afterDraw(instance) {
                const { ctx, chartArea } = instance;
                if (!chartArea || !scale) return;
                [cursorMarkers.current.a, cursorMarkers.current.b].forEach(
                  (sample, i) => {
                    const time = scale.real[sample];
                    if (time === undefined) return;
                    const x = instance.scales.x.getPixelForValue(time);
                    if (x < chartArea.left || x > chartArea.right) return;
                    ctx.save();
                    ctx.strokeStyle = i ? '#7fe3bf' : '#efefef';
                    ctx.fillStyle = ctx.strokeStyle;
                    ctx.setLineDash([4, 3]);
                    ctx.beginPath();
                    ctx.moveTo(x, chartArea.top);
                    ctx.lineTo(x, chartArea.bottom);
                    ctx.stroke();
                    ctx.font = '10px Segoe UI';
                    ctx.fillText(
                      `Cursor ${i ? 'B' : 'A'}`,
                      Math.min(x + 3, chartArea.right - 48),
                      chartArea.top + 11 + i * 12,
                    );
                    ctx.restore();
                  },
                );
              },
            },
          ]
        : [],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        font: { family: 'Segoe UI, sans-serif' },
        interaction: { mode: 'nearest', intersect: false },
        scales,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              boxWidth: 16,
              font: { family: 'Segoe UI, sans-serif' },
              ...(channelScales ? { color: '#dbeaf4' } : {}),
            },
          },
          tooltip: {
            callbacks: {
              label: (context) =>
                `${context.dataset.label}: ${number(context.parsed.y)}`,
            },
          },
          zoom: {
            pan: {
              enabled: !channelScales,
              mode: 'x',
              onPanComplete: detail,
              onPan: detail,
            },
            zoom: {
              wheel: { enabled: !channelScales },
              pinch: { enabled: !channelScales },
              drag: { enabled: !channelScales, modifierKey: 'shift' },
              mode: 'x',
              onZoomComplete: detail,
              onZoom: ({ chart, trigger }) => {
                if (trigger === 'api') detail({ chart });
              },
            },
          },
        },
      },
    });
    if (viewport.current && !evidence)
      instance.zoomScale('x', viewport.current, 'none');
    chart.current = instance;
    return () => {
      viewport.current = instance.isZoomedOrPanned?.()
        ? { min: instance.scales.x.min, max: instance.scales.x.max }
        : undefined;
      instance.destroy();
      chart.current = undefined;
    };
  }, [
    data,
    baseline,
    overlays,
    evidence,
    selected,
    mode,
    logX,
    grid,
    axisLabels,
    compact,
    channelScales,
    showCursors,
  ]);
  useEffect(() => {
    chart.current?.draw?.();
  }, [cursor, second]);
  useEffect(() => {
    if (showCursors && scale?.real.length) {
      const first = Math.max(
        0,
        scale.real.findIndex((n) => n >= (evidence?.from ?? scale.real[0])),
      );
      setCursor(first);
      setSecond(
        Math.min(
          scale.real.length - 1,
          first + Math.max(1, Math.floor(scale.real.length / 10)),
        ),
      );
    }
  }, [scale?.real, showCursors]);

  return (
    <div style={{ minWidth: 0 }}>
      <div style={row}>
        {(!compact ||
          selected.some((v) => v.imaginary?.some((n) => n !== 0))) && (
          <Field label="Display" orientation="horizontal" size="small">
            <Select
              size="small"
              value={mode}
              onChange={(_, d) => setMode(d.value as DisplayMode)}
            >
              <option value="real">Real</option>
              <option value="magnitude">Magnitude</option>
              <option value="db">Magnitude (dB)</option>
              <option value="phase">Phase (°)</option>
            </Select>
          </Field>
        )}
        {!channelScales && (
          <>
            <Button size="small" onClick={() => chart.current?.resetZoom()}>
              Fit
            </Button>
            <Button size="small" onClick={() => chart.current?.zoom(1.5)}>
              Zoom in
            </Button>
            <Button size="small" onClick={() => chart.current?.zoom(1 / 1.5)}>
              Zoom out
            </Button>
          </>
        )}
        <Button
          size="small"
          onClick={() =>
            download(
              'simulation.csv',
              csv({
                ...data,
                vectors: [...(scale ? [scale] : []), ...selected],
              }),
              'text/csv;charset=utf-8',
            )
          }
        >
          Download CSV
        </Button>
        {!compact && (
          <Button
            size="small"
            onClick={() =>
              canvas.current?.toBlob((blob) => {
                if (!blob) return;
                const link = document.createElement('a'),
                  url = URL.createObjectURL(blob);
                link.href = url;
                link.download = 'simulation.png';
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              })
            }
          >
            Download image
          </Button>
        )}
      </div>
      <div
        style={{
          position: 'relative',
          height: compact ? 180 : 360,
          marginTop: 8,
        }}
      >
        <canvas
          ref={canvas}
          role="img"
          aria-label="Simulation chart. Use the controls to zoom and pan, or download CSV for all samples."
        />
      </div>
      {(!compact || showCursors) && (
        <>
          {!channelScales && (
            <div style={row}>
              <span>
                Wheel or pinch to zoom · Drag to pan · Shift-drag to zoom a
                region · Click legend to hide a trace
              </span>
              <Button
                size="small"
                onClick={() => chart.current?.pan({ x: 100 })}
              >
                Scroll left
              </Button>
              <Button
                size="small"
                onClick={() => chart.current?.pan({ x: -100 })}
              >
                Scroll right
              </Button>
            </div>
          )}
          <details style={{ marginTop: 8 }}>
            <summary>Chart options and cursors</summary>
            {!channelScales && (
              <div style={row}>
                <Checkbox
                  label="Logarithmic horizontal axis"
                  checked={logX}
                  onChange={(_, d) => setLogX(!!d.checked)}
                />
                <Checkbox
                  label="Grid"
                  checked={grid}
                  onChange={(_, d) => setGrid(!!d.checked)}
                />
                <Field label="Horizontal axis" size="small">
                  <Input
                    size="small"
                    value={axisLabels.x ?? xLabel}
                    onChange={(_, d) =>
                      setAxisLabels({ ...axisLabels, x: d.value })
                    }
                  />
                </Field>
                {units.map((unit) => (
                  <Field key={unit} label={`${unit} axis label`} size="small">
                    <Input
                      size="small"
                      value={axisLabels[unit] ?? ''}
                      placeholder={`Automatic (${unit})`}
                      onChange={(_, d) =>
                        setAxisLabels({ ...axisLabels, [unit]: d.value })
                      }
                    />
                  </Field>
                ))}
              </div>
            )}
            {count > 0 && (
              <>
                <label>
                  Cursor A{' '}
                  <input
                    type="range"
                    min={0}
                    max={count - 1}
                    value={cursor}
                    onChange={(e) => setCursor(Number(e.target.value))}
                  />
                </label>
                <label>
                  Cursor B{' '}
                  <input
                    type="range"
                    min={0}
                    max={count - 1}
                    value={second}
                    onChange={(e) => setSecond(Number(e.target.value))}
                  />
                </label>
                <div>
                  {xLabel}: A = {number(scale?.real[cursor] ?? cursor)}, B ={' '}
                  {number(scale?.real[second] ?? second)}, Δ ={' '}
                  {number(
                    (scale?.real[second] ?? second) -
                      (scale?.real[cursor] ?? cursor),
                  )}
                </div>
                {selected.map((v) => (
                  <div key={v.name}>
                    {v.name}: A ={' '}
                    {number(
                      displayValue(v.real[cursor], v.imaginary?.[cursor], mode),
                    )}
                    , B ={' '}
                    {number(
                      displayValue(v.real[second], v.imaginary?.[second], mode),
                    )}{' '}
                    {displayUnit(v, mode)}
                  </div>
                ))}
              </>
            )}
          </details>
        </>
      )}
    </div>
  );
}
