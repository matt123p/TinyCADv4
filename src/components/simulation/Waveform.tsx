import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, registerables, ChartDataset, ChartOptions } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import {
  Button,
  Checkbox,
  Field,
  Input,
  Select,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
} from '@fluentui/react-components';
import {
  ZoomInRegular,
  ZoomOutRegular,
  ZoomFitRegular,
  SearchRegular,
  MoreHorizontalRegular,
  ArrowDownloadRegular,
  ImageRegular,
  OptionsRegular,
  ArrowLeftRegular,
  ArrowRightRegular,
} from '@fluentui/react-icons';
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

export interface WaveformPreferences {
  mode: DisplayMode;
  logX: boolean;
  grid: boolean;
  axisLabels: Record<string, string>;
  cursor: number;
  second: number;
}

function usePreference<K extends keyof WaveformPreferences>(
  key: K,
  initial: WaveformPreferences[K],
  preferences: Partial<WaveformPreferences>,
  change?: React.Dispatch<React.SetStateAction<Partial<WaveformPreferences>>>,
): [WaveformPreferences[K], (value: WaveformPreferences[K]) => void] {
  const [local, setLocal] = useState(initial);
  return [
    (preferences?.[key] ?? local) as WaveformPreferences[K],
    (value) => {
      setLocal(value);
      change?.((current) => ({ ...current, [key]: value }));
    },
  ];
}

export function Waveform({
  data,
  signals,
  emptyMeansAll = true,
  baseline,
  compact = false,
  overlays,
  evidence,
  initialMode = 'real',
  channelScales,
  showCursors = false,
  preferences,
  onPreferencesChange,
  viewportRef,
  signalLabels,
  fillHeight = false,
  scopeView = false,
  scopeTrigger,
}: {
  data: ResultData;
  signals: string[];
  emptyMeansAll?: boolean;
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
  preferences?: Partial<WaveformPreferences>;
  onPreferencesChange?: React.Dispatch<
    React.SetStateAction<Partial<WaveformPreferences>>
  >;
  viewportRef?: React.MutableRefObject<{ min: number; max: number }>;
  signalLabels?: Record<string, string>;
  fillHeight?: boolean;
  scopeView?: boolean;
  scopeTrigger?: { source: string; level: number };
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart<'line'>>();
  const localViewport = useRef<{ min: number; max: number }>();
  const viewport = viewportRef || localViewport;
  const [mode, setMode] = usePreference(
    'mode',
    initialMode,
    preferences,
    onPreferencesChange,
  );
  const [logX, setLogX] = usePreference(
    'logX',
    data.scale === 'frequency',
    preferences,
    onPreferencesChange,
  );
  const [grid, setGrid] = usePreference(
    'grid',
    true,
    preferences,
    onPreferencesChange,
  );
  const [axisLabels, setAxisLabels] = usePreference(
    'axisLabels',
    {},
    preferences,
    onPreferencesChange,
  );
  const [cursor, setCursor] = usePreference(
      'cursor',
      0,
      preferences,
      onPreferencesChange,
    ),
    [second, setSecond] = usePreference(
      'second',
      0,
      preferences,
      onPreferencesChange,
    );
  const cursorMarkers = useRef({ a: 0, b: 0 });
  cursorMarkers.current = { a: cursor, b: second };
  const selected = useMemo(
    () =>
      data.vectors.filter(
        (v) =>
          v.name !== data.scale &&
          ((emptyMeansAll && !signals.length) || signals.includes(v.name)),
      ),
    [data, signals, emptyMeansAll],
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
          label: `${
            signalLabels?.[v.name] || signalLabel(v.name)
          } (${displayUnit(v, mode)})`,
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
            label: `${
              signalLabels?.[v.name] || signalLabel(v.name)
            } baseline (${displayUnit(v, mode)})`,
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
              label: `${overlay.label} · ${
                signalLabels?.[v.name] || signalLabel(v.name)
              }`,
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
          display: !scopeView,
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
                display: !scopeView,
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
          display: !scopeView,
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
          display: !scopeView,
          maxTicksLimit: channel ? 9 : compact ? 5 : 8,
          ...(channel ? { stepSize: channel.scale, color: channel.color } : {}),
          ...(channel ? { autoSkip: false } : {}),
        },
      };
    });
    const instance = new Chart(canvas.current, {
      type: 'line',
      data: { datasets },
      plugins: [
        ...(scopeView
          ? [
              {
                id: 'scope-position-markers',
                afterDraw(instance: Chart<'line'>) {
                  const { ctx, chartArea } = instance;
                  if (!chartArea) return;
                  ctx.save();
                  ctx.font = 'bold 11px Consolas,monospace';
                  units.forEach((unit, index) => {
                    const channel = channelScales?.[unit];
                    const axis = instance.scales[`y${index}`];
                    if (!channel || !axis) return;
                    const zero = axis.getPixelForValue(0);
                    const y = Math.max(
                      chartArea.top + 5,
                      Math.min(chartArea.bottom - 5, zero),
                    );
                    ctx.fillStyle = channel.color;
                    ctx.fillText(unit, chartArea.left - 25, y + 4);
                    ctx.beginPath();
                    ctx.moveTo(chartArea.left - 10, y - 4);
                    ctx.lineTo(chartArea.left - 2, y);
                    ctx.lineTo(chartArea.left - 10, y + 4);
                    ctx.fill();
                    if (scopeTrigger?.source === unit) {
                      const level = axis.getPixelForValue(scopeTrigger.level);
                      if (level >= chartArea.top && level <= chartArea.bottom) {
                        ctx.strokeStyle = '#b8dacd';
                        ctx.setLineDash([3, 5]);
                        ctx.beginPath();
                        ctx.moveTo(chartArea.left, level);
                        ctx.lineTo(chartArea.right, level);
                        ctx.stroke();
                        ctx.setLineDash([]);
                        ctx.fillStyle = '#b8dacd';
                        ctx.fillText('T', chartArea.right + 4, level + 4);
                      }
                    }
                  });
                  ctx.restore();
                },
              },
            ]
          : []),
        ...(showCursors
          ? [
              {
                id: 'instrument-cursors',
                afterDraw(instance: Chart<'line'>) {
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
          : []),
      ],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        ...(scopeView
          ? {
              layout: { padding: { left: 28, right: 16, top: 10, bottom: 10 } },
            }
          : {}),
        font: { family: 'Segoe UI, sans-serif' },
        interaction: { mode: 'nearest', intersect: false },
        scales,
        plugins: {
          legend: {
            display: !scopeView,
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
    // The chart library's observer schedules work on the main window. Popup
    // windows also need their own resize event, including while the owner is idle.
    const owner = fillHeight
      ? canvas.current.ownerDocument.defaultView
      : undefined;
    const resize = () => instance.resize();
    owner?.addEventListener('resize', resize);
    return () => {
      owner?.removeEventListener('resize', resize);
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
    signalLabels,
    fillHeight,
    scopeView,
    scopeTrigger,
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
    <div
      style={{
        minWidth: 0,
        ...(fillHeight
          ? ({
              display: 'flex',
              flexDirection: 'column',
              flex: '1 1 0',
              minHeight: 0,
            } as React.CSSProperties)
          : {}),
      }}
    >
      {!scopeView && (
        <div style={{ ...row, justifyContent: 'flex-end', flexShrink: 0 }}>
          {!channelScales && (
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <Button
                  size="small"
                  appearance="subtle"
                  icon={<SearchRegular />}
                  aria-label="Zoom"
                  title="Zoom"
                />
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem
                    icon={<ZoomFitRegular />}
                    onClick={() => chart.current?.resetZoom()}
                  >
                    Fit
                  </MenuItem>
                  <MenuItem
                    icon={<ZoomInRegular />}
                    onClick={() => chart.current?.zoom(1.5)}
                  >
                    Zoom in
                  </MenuItem>
                  <MenuItem
                    icon={<ZoomOutRegular />}
                    onClick={() => chart.current?.zoom(1 / 1.5)}
                  >
                    Zoom out
                  </MenuItem>
                  <MenuItem
                    icon={<ArrowLeftRegular />}
                    onClick={() => chart.current?.pan({ x: 100 })}
                  >
                    Scroll left
                  </MenuItem>
                  <MenuItem
                    icon={<ArrowRightRegular />}
                    onClick={() => chart.current?.pan({ x: -100 })}
                  >
                    Scroll right
                  </MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          )}
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <Button
                size="small"
                appearance="subtle"
                icon={<MoreHorizontalRegular />}
                aria-label="Chart menu"
                title="Chart menu"
              />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <Menu>
                  <MenuTrigger disableButtonEnhancement>
                    <MenuItem icon={<OptionsRegular />}>
                      Chart options and cursors
                    </MenuItem>
                  </MenuTrigger>
                  <MenuPopover>
                    <div
                      role="group"
                      aria-label="Chart options and cursors"
                      style={{
                        padding: 12,
                        width: 320,
                        maxHeight: '70vh',
                        overflowY: 'auto',
                      }}
                    >
                      <Field label="Display" size="small">
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
                            <Field
                              key={unit}
                              label={`${unit} axis label`}
                              size="small"
                            >
                              <Input
                                size="small"
                                value={axisLabels[unit] ?? ''}
                                placeholder={`Automatic (${unit})`}
                                onChange={(_, d) =>
                                  setAxisLabels({
                                    ...axisLabels,
                                    [unit]: d.value,
                                  })
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
                              onChange={(e) =>
                                setCursor(Number(e.target.value))
                              }
                            />
                          </label>
                          <label>
                            Cursor B{' '}
                            <input
                              type="range"
                              min={0}
                              max={count - 1}
                              value={second}
                              onChange={(e) =>
                                setSecond(Number(e.target.value))
                              }
                            />
                          </label>
                          <div>
                            {xLabel}: A ={' '}
                            {number(scale?.real[cursor] ?? cursor)}, B ={' '}
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
                                displayValue(
                                  v.real[cursor],
                                  v.imaginary?.[cursor],
                                  mode,
                                ),
                              )}
                              , B ={' '}
                              {number(
                                displayValue(
                                  v.real[second],
                                  v.imaginary?.[second],
                                  mode,
                                ),
                              )}{' '}
                              {displayUnit(v, mode)}
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  </MenuPopover>
                </Menu>
                <MenuItem
                  icon={<ArrowDownloadRegular />}
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
                </MenuItem>
                <MenuItem
                  icon={<ImageRegular />}
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
                </MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>
      )}
      <div
        style={{
          position: 'relative',
          ...(fillHeight
            ? { flex: '1 1 0', minHeight: 120 }
            : { height: scopeView ? 170 : compact ? 180 : 360 }),
          marginTop: scopeView ? 0 : 8,
        }}
      >
        <canvas
          ref={canvas}
          role="img"
          aria-label={`Simulation chart. Signals: ${
            selected
              .map((v) => signalLabels?.[v.name] || signalLabel(v.name))
              .join(', ') || 'none selected'
          }. Use the controls to zoom and pan, or download CSV for all samples.`}
        />
      </div>
    </div>
  );
}
