import React, { Dispatch, useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  Field,
  Input,
  Select,
  Textarea,
} from '@fluentui/react-components';
import { dsnSymbol } from '../../model/dsnItem';
import { dsnDrawing } from '../../model/dsnDrawing';
import {
  SourceConfig,
  SpiceControl,
  controlTemplate,
  probeResult,
  readControl,
  sourcePreview,
} from '../../simulation/controls';
import { Waveform } from '../simulation/Waveform';
import { useInstrumentAcquisition } from '../simulation/useInstrumentAcquisition';

import { parseQuantity } from '../../simulation/numbers';

const sourceFields: Record<
  SourceConfig['waveform'],
  [keyof SourceConfig, string][]
> = {
  dc: [],
  sine: [
    ['offset', 'Offset'],
    ['amplitude', 'Amplitude'],
    ['frequency', 'Frequency (Hz)'],
    ['phase', 'Phase (°)'],
    ['delay', 'Delay (s)'],
    ['damping', 'Damping (1/s)'],
  ],
  pulse: [
    ['low', 'Low level'],
    ['high', 'High level'],
    ['delay', 'Delay (s)'],
    ['rise', 'Rise time (s)'],
    ['fall', 'Fall time (s)'],
    ['width', 'Pulse width (s)'],
    ['period', 'Period (s)'],
  ],
  triangle: [
    ['low', 'Low level'],
    ['high', 'High level'],
    ['delay', 'Delay (s)'],
    ['period', 'Period (s)'],
  ],
  pwl: [],
  exponential: [
    ['low', 'Initial level'],
    ['high', 'Pulsed level'],
    ['riseDelay', 'Rise delay (s)'],
    ['riseTau', 'Rise time constant (s)'],
    ['fallDelay', 'Fall delay (s)'],
    ['fallTau', 'Fall time constant (s)'],
  ],
  fm: [
    ['offset', 'Offset'],
    ['amplitude', 'Amplitude'],
    ['frequency', 'Carrier frequency (Hz)'],
    ['modulationFrequency', 'Modulation frequency (Hz)'],
    ['modulationIndex', 'Modulation index'],
  ],
};

export function SpiceControlPanel({
  symbol,
  drawing,
  dispatch,
}: {
  symbol: dsnSymbol;
  drawing: dsnDrawing;
  dispatch: Dispatch<any>;
}) {
  const selectedControl = readControl(symbol);
  const config =
    selectedControl?.kind === 'instrument' ? undefined : selectedControl;
  const [selectedRun, setSelectedRun] = useState('');
  const {
    available,
    chosen,
    net,
    fresh,
    checking,
    data: acquisitionData,
  } = useInstrumentAcquisition(drawing, selectedRun);
  useEffect(() => setSelectedRun(''), [available[0]?.run.id]);
  if (!config) return null;
  const change = (patch: Partial<SpiceControl> | Partial<SourceConfig>) =>
    dispatch({
      type: 'simulation/configure-control',
      config: { ...config, ...patch },
    });
  let error = '';
  try {
    controlTemplate(config);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const preview =
    config.kind === 'source' && !error ? sourcePreview(config) : undefined;
  const data =
    config.kind === 'probe' && chosen && acquisitionData
      ? probeResult(net, symbol, acquisitionData)
      : undefined;
  const field = (key: keyof SourceConfig, label: string) =>
    config.kind === 'source' && (
      <Field key={key} label={label} size="small">
        <Input
          size="small"
          value={String(config[key])}
          onChange={(_, d) => change({ [key]: d.value })}
        />
      </Field>
    );
  const ref = symbol.text.find((f) => f.description === 'Ref')?.value;
  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        overflow: 'auto',
        padding: 12,
        gap: 24,
        boxSizing: 'border-box',
        flexWrap: 'wrap',
      }}
    >
      <section style={{ flex: '1 1 420px', minWidth: 280 }}>
        <strong>
          {ref} —{' '}
          {config.kind === 'probe'
            ? 'Probe'
            : config.kind === 'controlled'
            ? 'Controlled source'
            : 'Source settings'}
        </strong>
        {symbol._symbol.uid?.endsWith('-v1') && (
          <Button
            size="small"
            style={{ marginLeft: 12 }}
            onClick={() => dispatch({ type: 'simulation/compact-control' })}
          >
            Use compact symbol
          </Button>
        )}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '8px 12px',
            marginTop: 8,
          }}
        >
          <Field label="Reference" size="small">
            <Input
              size="small"
              value={ref}
              onChange={(_, d) =>
                dispatch({
                  type: 'simulation/control-reference',
                  value: d.value,
                })
              }
            />
          </Field>
          {config.kind === 'source' && (
            <>
              <Field label="Source type" size="small">
                <Select
                  size="small"
                  value={config.type}
                  onChange={(_, d) =>
                    change({ type: d.value as SourceConfig['type'] })
                  }
                >
                  <option value="voltage">Voltage (V)</option>
                  <option value="current">Current (A)</option>
                </Select>
              </Field>
              <Field label="Signal type" size="small">
                <Select
                  size="small"
                  value={config.waveform}
                  onChange={(_, d) =>
                    change({ waveform: d.value as SourceConfig['waveform'] })
                  }
                >
                  <option value="dc">DC / constant</option>
                  <option value="sine">Sine</option>
                  <option value="pulse">Square / pulse</option>
                  <option value="triangle">Triangle</option>
                  <option value="pwl">Piecewise linear</option>
                  <option value="exponential">Exponential</option>
                  <option value="fm">Frequency modulation</option>
                </Select>
              </Field>
              {field(
                'dc',
                `DC operating point (${config.type === 'voltage' ? 'V' : 'A'})`,
              )}
              {(sourceFields[config.waveform] || []).map(([key, label]) =>
                field(key, label),
              )}
              {config.waveform === 'pwl' && (
                <Field
                  label={`Time (s) / level (${
                    config.type === 'voltage' ? 'V' : 'A'
                  }), one pair per line`}
                  size="small"
                  style={{ gridColumn: '1 / -1' }}
                >
                  <Textarea
                    size="small"
                    rows={3}
                    value={config.points}
                    onChange={(_, d) => change({ points: d.value })}
                  />
                </Field>
              )}
              {field('acMagnitude', 'AC amplitude')}
              {field('acPhase', 'AC phase (°)')}
            </>
          )}
          {config.kind === 'controlled' && (
            <>
              <Field label="Type" size="small">
                <Select
                  size="small"
                  value={config.type}
                  onChange={(_, d) =>
                    change({ type: d.value as 'voltage' | 'current' })
                  }
                >
                  <option value="voltage">
                    Voltage-controlled voltage (E)
                  </option>
                  <option value="current">
                    Voltage-controlled current (G)
                  </option>
                </Select>
              </Field>
              <Field
                label={
                  config.type === 'voltage'
                    ? 'Gain (V/V)'
                    : 'Transconductance (A/V)'
                }
                size="small"
              >
                <Input
                  size="small"
                  value={config.gain}
                  onChange={(_, d) => change({ gain: d.value })}
                />
              </Field>
            </>
          )}
          {config.kind === 'probe' && (
            <>
              <Field label="Measure" size="small">
                <Select
                  size="small"
                  value={config.mode}
                  onChange={(_, d) =>
                    change({
                      mode: d.value as 'voltage' | 'differential' | 'current',
                    })
                  }
                >
                  <option value="voltage">Voltage to ground</option>
                  <option value="differential">Differential voltage</option>
                  <option value="current">Series current</option>
                </Select>
              </Field>
              <Checkbox
                label="Reverse polarity"
                checked={config.invert}
                onChange={(_, d) => change({ invert: !!d.checked })}
              />
              <Field
                label="Simulation result"
                size="small"
                style={{ gridColumn: '1 / -1' }}
              >
                <Select
                  size="small"
                  value={chosen?.run.id || ''}
                  onChange={(_, d) => setSelectedRun(d.value)}
                >
                  {!available.length && (
                    <option value="">Run a simulation first</option>
                  )}
                  {available.map(({ sheet, run }) => (
                    <option key={run.id} value={run.id}>
                      {sheet.name} / {run.analysis.kind} /{' '}
                      {new Date(run.created).toLocaleString()}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
        <p style={{ margin: '8px 0', fontSize: 12 }}>
          {config.kind === 'source'
            ? `Levels are in ${
                config.type === 'voltage' ? 'volts' : 'amps'
              }. Prefixes such as m, u and k are accepted. AC settings apply to frequency response; the preview shows the transient waveform.`
            : config.kind === 'controlled'
            ? 'Output + / −: pins 1 / 2. Control C+ / C−: pins 3 / 4. Connect all four pins.'
            : config.mode === 'current'
            ? 'Insert in series. Positive current flows from + to −. This probe is an ideal 0 V sensing source.'
            : config.mode === 'differential'
            ? 'Connect + and − to the two nets to compare. This probe draws no current.'
            : 'Connect the probe tip to the net to measure. The reference is node 0. This probe draws no current.'}
        </p>
      </section>
      <section style={{ flex: '1.5 1 360px', minWidth: 280 }}>
        {preview && (
          <>
            <strong>Source waveform preview</strong>
            <Waveform data={preview} signals={['Source']} compact />
          </>
        )}
        {config.kind === 'controlled' && !error && (
          <>
            <strong>Transfer characteristic</strong>
            <Waveform
              compact
              data={{
                scale: 'Control voltage',
                log: '',
                vectors: [
                  { name: 'Control voltage', unit: 'V', real: [-1, 0, 1] },
                  {
                    name: 'Output',
                    unit: config.type === 'voltage' ? 'V' : 'A',
                    real: [
                      -parseQuantity(config.gain),
                      0,
                      parseQuantity(config.gain),
                    ],
                  },
                ],
              }}
              signals={['Output']}
            />
          </>
        )}
        {config.kind === 'probe' && (
          <>
            {data ? (
              <>
                <strong>Probe output</strong>
                {!data.scale && (
                  <p>
                    {data.vectors.at(-1)?.real[0]?.toPrecision(7)}{' '}
                    {data.vectors.at(-1)?.unit}
                  </p>
                )}
                <Waveform
                  key={chosen.run.id + symbol._id}
                  data={data}
                  signals={[]}
                  compact
                />
              </>
            ) : (
              <p role="status">
                {!chosen
                  ? 'Run a simulation to see the probe output here.'
                  : checking
                  ? 'Checking result…'
                  : !fresh
                  ? 'The circuit has changed since this result. Run the simulation again.'
                  : 'No matching signal. Check probe connections and select a result containing the measured voltage or current.'}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
