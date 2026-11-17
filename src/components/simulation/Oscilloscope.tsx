import React, { useEffect, useRef, useState } from 'react';
import { Button, Field } from '@fluentui/react-components';
import { InstrumentConfig, scopeDisplay } from '../../simulation/instruments';
import { parseQuantity, positiveQuantity } from '../../simulation/numbers';
import {
  scopeNextStep,
  scopePosition,
  scopePositionPatch,
  scopeQuantity,
  scopeScalePatch,
  scopeStepIndex,
  scopeTimeSteps,
  scopeVoltageSteps,
} from '../../simulation/scopeControls';
import { measure } from '../../simulation/metrics';
import { Waveform } from './Waveform';

const colors = { A: '#f2cc4d', B: '#5bd5f4' };
const flex: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  flexWrap: 'wrap',
};
const panel: React.CSSProperties = {
  padding: 12,
  background: '#26313d',
  border: '1px solid #526170',
  borderRadius: 8,
  minWidth: 0,
};
const knob: React.CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: '50%',
  border: '2px solid #9daab8',
  background: 'radial-gradient(circle at 35% 30%,#788594,#151c25)',
  flexShrink: 0,
};

function ScaleDial({
  label,
  value,
  steps,
  unit,
  change,
}: {
  label: string;
  value: string;
  steps: string[];
  unit: string;
  change: (value: string) => void;
}) {
  const index = scopeStepIndex(value, steps, unit);
  const actual = positiveQuantity(value, unit);
  const custom =
    Math.abs(positiveQuantity(steps[index], unit) / actual - 1) > 1e-8;
  const step = (direction: number) => {
    // Imported arbitrary scales stay intact until the first turn of the dial.
    change(scopeNextStep(value, steps, unit, direction));
  };
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...flex, flexWrap: 'nowrap', gap: 4 }}>
        <span style={{ fontSize: 11, width: 48, flexShrink: 0 }} title={label}>
          {unit === 's' ? 'Time/div' : 'V/div'}
        </span>
        <Button
          size="small"
          style={{ minWidth: 22, width: 22, padding: 0 }}
          aria-label={`Decrease ${label}`}
          disabled={!custom && index === 0}
          onClick={() => step(-1)}
        >
          −
        </Button>
        <div
          aria-hidden
          style={{
            ...knob,
            transform: `rotate(${
              -130 + (index / (steps.length - 1)) * 260
            }deg)`,
          }}
        >
          <div
            style={{
              width: 2,
              height: 8,
              background: '#f2cc4d',
              margin: '2px auto',
            }}
          />
        </div>
        <Button
          size="small"
          style={{ minWidth: 22, width: 22, padding: 0 }}
          aria-label={`Increase ${label}`}
          disabled={!custom && index === steps.length - 1}
          onClick={() => step(1)}
        >
          +
        </Button>
        <output
          style={{ font: 'bold 11px Consolas,monospace', whiteSpace: 'nowrap' }}
          title={
            custom
              ? 'Imported custom scale; turn the dial to select a standard step'
              : undefined
          }
        >
          {scopeQuantity(actual, unit)}/div{custom ? '*' : ''}
        </output>
      </div>
      <input
        aria-label={`${label} dial`}
        type="range"
        min={0}
        max={steps.length - 1}
        step={1}
        value={index}
        style={{
          display: 'block',
          width: '100%',
          height: 14,
          margin: '2px 0 0',
          accentColor: '#a8c6e4',
        }}
        onChange={(event) => change(steps[Number(event.target.value)])}
      />
    </div>
  );
}

export function Oscilloscope({
  config: c,
  scope: incoming,
  busy,
  checking,
  fresh,
  change,
}: {
  config: InstrumentConfig;
  scope?: ReturnType<typeof scopeDisplay>;
  busy: boolean;
  checking: boolean;
  fresh: boolean;
  change: (patch: Partial<InstrumentConfig>) => void;
}) {
  const [menu, setMenu] = useState('Trigger');
  const [measurements, setMeasurements] = useState(true);
  const held = useRef<ReturnType<typeof scopeDisplay>>();
  const triggered =
    incoming && (incoming.triggered || c.acquisition === 'auto');
  useEffect(() => {
    if (fresh && triggered) held.current = incoming;
    else if (!fresh && !checking) held.current = undefined;
  }, [fresh, checking, triggered, incoming]);
  const holding = fresh && !triggered && !!held.current;
  const scope = triggered
    ? incoming
    : holding
    ? {
        ...held.current,
        stop: held.current.start + positiveQuantity(c.timebase, 's') * 10,
      }
    : undefined;
  const modeLabel = { auto: 'Auto', normal: 'Normal', single: 'Single' }[
    c.acquisition
  ];
  const visible = !!scope;
  const cycleMode = () =>
    change({
      acquisition:
        c.acquisition === 'auto'
          ? 'normal'
          : c.acquisition === 'normal'
          ? 'single'
          : 'auto',
    });
  const status = busy
    ? 'ACQUIRING'
    : checking
    ? 'CHECKING'
    : !fresh
    ? 'NO ACQUISITION'
    : holding
    ? 'WAIT · HOLDING LAST TRACE'
    : !visible
    ? 'WAITING FOR TRIGGER'
    : scope.triggered
    ? c.acquisition === 'single'
      ? 'SINGLE · STOPPED'
      : 'TRIGGERED'
    : 'AUTO · UNTRIGGERED';
  const softKey = (label: string, value: string, click: () => void) => (
    <Button
      size="small"
      aria-label={`${label}: ${value}`}
      onClick={click}
      style={{
        width: '100%',
        minHeight: 30,
        padding: '2px 6px',
        fontSize: 11,
        justifyContent: 'space-between',
        textAlign: 'left',
        whiteSpace: 'normal',
      }}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </Button>
  );
  const channel = menu === 'Channel B' ? 'B' : 'A';
  const coupling = channel === 'A' ? c.couplingA : c.couplingB;
  const position = (ch: 'A' | 'B') => scopePosition(c, ch);
  const setPosition = (ch: 'A' | 'B', divisions: number) =>
    change(scopePositionPatch(c, ch, divisions));
  return (
    <section
      aria-label="Oscilloscope front panel"
      style={{ width: '100%', minWidth: 0 }}
    >
      <div
        style={{ ...flex, justifyContent: 'space-between', marginBottom: 4 }}
      >
        <div role="group" aria-label="Scope menus" style={flex}>
          {['Channel A', 'Channel B', 'Horizontal', 'Trigger', 'Measure'].map(
            (item) => (
              <Button
                key={item}
                size="small"
                appearance={menu === item ? 'primary' : 'secondary'}
                aria-pressed={menu === item}
                onClick={() => setMenu(item)}
              >
                {item}
              </Button>
            ),
          )}
        </div>
        <Button
          size="small"
          aria-label={`Trigger mode: ${modeLabel}`}
          onClick={cycleMode}
        >
          Trigger: {modeLabel} ↻
        </Button>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          alignItems: 'start',
        }}
      >
        <div style={{ flex: '3 1 400px', minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
            <div
              role="region"
              aria-label="Oscilloscope screen"
              style={{
                flex: '1 1 240px',
                minWidth: 0,
                background: '#06171e',
                border: '3px inset #526170',
                borderRadius: 6,
                padding: '4px 6px',
                fontFamily: 'Consolas,monospace',
              }}
            >
              <div
                style={{
                  ...flex,
                  justifyContent: 'space-between',
                  fontSize: 12,
                  color: '#9de5cf',
                  minHeight: 18,
                }}
              >
                <strong role="status">● {status}</strong>
                <span>
                  T {c.trigger} {c.edge === 'rising' ? '↗' : '↘'}{' '}
                  {scopeQuantity(parseQuantity(c.level, 'V'), 'V')}
                </span>
                <span>
                  H {scopeQuantity(positiveQuantity(c.timebase, 's'), 's')}/div
                </span>
              </div>
              {visible ? (
                <Waveform
                  compact
                  scopeView
                  data={scope.data}
                  signals={['A', 'B']}
                  evidence={{ from: scope.start, to: scope.stop }}
                  scopeTrigger={{
                    source: c.trigger,
                    level: parseQuantity(c.level, 'V'),
                  }}
                  channelScales={{
                    A: {
                      scale: positiveQuantity(c.scaleA, 'V'),
                      offset: parseQuantity(c.offsetA, 'V'),
                      color: colors.A,
                    },
                    B: {
                      scale: positiveQuantity(c.scaleB, 'V'),
                      offset: parseQuantity(c.offsetB, 'V'),
                      color: colors.B,
                    },
                  }}
                />
              ) : (
                <div
                  style={{
                    height: 170,
                    display: 'grid',
                    placeItems: 'center',
                    color: '#8faab5',
                    backgroundImage:
                      'linear-gradient(#27404966 1px,transparent 1px),linear-gradient(90deg,#27404966 1px,transparent 1px)',
                    backgroundSize: '10% 12.5%',
                  }}
                >
                  <span>
                    {checking
                      ? 'Checking recorded acquisition…'
                      : !fresh
                      ? 'Connect inputs, then press Acquire'
                      : 'No matching edge in this record'}
                  </span>
                </div>
              )}
              <div style={{ borderTop: '1px solid #30464c', paddingTop: 3 }}>
                {(['A', 'B'] as const).map((ch) => (
                  <div
                    key={ch}
                    aria-label={`Channel ${ch} measurements`}
                    style={{
                      ...flex,
                      color: colors[ch],
                      fontSize: 10,
                      lineHeight: '15px',
                      gap: '0 10px',
                    }}
                  >
                    <strong
                      title={`Position ${Number(
                        position(ch).toFixed(2),
                      )} divisions`}
                    >
                      {ch}{' '}
                      {scopeQuantity(
                        positiveQuantity(ch === 'A' ? c.scaleA : c.scaleB, 'V'),
                        'V',
                      )}
                      /div {ch === 'A' ? c.couplingA : c.couplingB}
                    </strong>
                    {measurements &&
                      (
                        ['peakToPeak', 'frequency', 'period', 'rms'] as const
                      ).map((kind) => {
                        const result = visible
                          ? measure(
                              {
                                id: kind,
                                name: kind,
                                kind,
                                source: ch,
                                from: String(scope.start),
                                to: String(
                                  Math.min(
                                    scope.stop,
                                    scope.data.vectors
                                      .find((v) => v.name === 'time')
                                      .real.at(-1),
                                  ),
                                ),
                              },
                              scope.data,
                            )
                          : undefined;
                        return (
                          <span key={kind}>
                            {
                              {
                                peakToPeak: 'Vpp',
                                frequency: 'Freq',
                                period: 'Period',
                                rms: 'RMS',
                              }[kind]
                            }{' '}
                            {result?.state === 'valid'
                              ? scopeQuantity(result.value, result.unit)
                              : '—'}
                          </span>
                        );
                      })}
                  </div>
                ))}
              </div>
              <div style={{ color: '#8faab5', fontSize: 10, marginTop: 2 }}>
                10 × 8 divisions · Recorded · Acquire to refresh
              </div>
            </div>
            <aside
              aria-label={`${menu} menu`}
              title={
                menu === 'Trigger'
                  ? 'Auto displays untriggered records; Normal holds the last trace; Single captures once. Press Acquire for a new record.'
                  : menu.startsWith('Channel')
                  ? 'Position moves the trace without changing voltage measurements. AC coupling removes the DC mean.'
                  : menu === 'Horizontal'
                  ? 'Ten time divisions across. Acquire records a new time span.'
                  : 'Measurements use the visible time window.'
              }
              style={{
                ...panel,
                padding: 6,
                flex: '0 0 110px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <strong
                style={{
                  fontSize: 12,
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                }}
              >
                {menu}
              </strong>
              {menu === 'Trigger' && (
                <>
                  {softKey('Mode', modeLabel, cycleMode)}
                  {softKey('Source', c.trigger, () =>
                    change({ trigger: c.trigger === 'A' ? 'B' : 'A' }),
                  )}
                  {softKey(
                    'Edge',
                    c.edge === 'rising' ? 'Rising ↗' : 'Falling ↘',
                    () =>
                      change({
                        edge: c.edge === 'rising' ? 'falling' : 'rising',
                      }),
                  )}
                  <Field
                    label="Level (V)"
                    size="small"
                    orientation="horizontal"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                    }}
                  >
                    <input
                      aria-label="Trigger level (V)"
                      type="number"
                      step={
                        positiveQuantity(
                          c.trigger === 'A' ? c.scaleA : c.scaleB,
                          'V',
                        ) / 10
                      }
                      value={parseQuantity(c.level, 'V')}
                      style={{
                        width: 54,
                        minWidth: 0,
                        boxSizing: 'border-box',
                      }}
                      onChange={(event) => {
                        if (
                          event.target.value !== '' &&
                          Number.isFinite(event.target.valueAsNumber)
                        )
                          change({ level: event.target.value });
                      }}
                    />
                  </Field>
                  {softKey('Level', 'Set to 0 V', () =>
                    change({ level: '0V' }),
                  )}
                </>
              )}
              {menu.startsWith('Channel') && (
                <>
                  {softKey('Coupling', coupling, () =>
                    change(
                      channel === 'A'
                        ? {
                            couplingA:
                              coupling === 'DC'
                                ? 'AC'
                                : coupling === 'AC'
                                ? 'GND'
                                : 'DC',
                          }
                        : {
                            couplingB:
                              coupling === 'DC'
                                ? 'AC'
                                : coupling === 'AC'
                                ? 'GND'
                                : 'DC',
                          },
                    ),
                  )}
                  {softKey('Position', '↑ 0.5 div', () =>
                    setPosition(channel, Math.min(4, position(channel) + 0.5)),
                  )}
                  {softKey('Position', '↓ 0.5 div', () =>
                    setPosition(channel, Math.max(-4, position(channel) - 0.5)),
                  )}
                  {softKey('Position', 'Set to zero', () =>
                    setPosition(channel, 0),
                  )}
                </>
              )}
              {menu === 'Horizontal' && (
                <>
                  {softKey('Timebase', 'Faster', () =>
                    change({
                      timebase: scopeNextStep(
                        c.timebase,
                        scopeTimeSteps,
                        's',
                        -1,
                      ),
                    }),
                  )}
                  {softKey('Timebase', 'Slower', () =>
                    change({
                      timebase: scopeNextStep(
                        c.timebase,
                        scopeTimeSteps,
                        's',
                        1,
                      ),
                    }),
                  )}
                </>
              )}
              {menu === 'Measure' && (
                <>
                  {softKey('Readouts', measurements ? 'On' : 'Off', () =>
                    setMeasurements((value) => !value),
                  )}
                </>
              )}
            </aside>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: '1 1 220px',
            minWidth: 0,
            gap: 4,
          }}
        >
          {(['A', 'B'] as const).map((ch) => (
            <section
              key={ch}
              aria-label={`Channel ${ch} vertical controls`}
              style={{
                ...panel,
                padding: 6,
                borderTop: `3px solid ${colors[ch]}`,
              }}
            >
              <strong
                style={{
                  color: colors[ch],
                  display: 'block',
                  marginBottom: 2,
                  fontSize: 11,
                }}
              >
                CHANNEL {ch} · VERTICAL
              </strong>
              <ScaleDial
                label={`${ch} volts / division`}
                value={ch === 'A' ? c.scaleA : c.scaleB}
                steps={scopeVoltageSteps}
                unit="V"
                change={(value) => change(scopeScalePatch(c, ch, value))}
              />
              <div
                style={{ ...flex, flexWrap: 'nowrap', gap: 4, marginTop: 2 }}
              >
                <span style={{ fontSize: 11, width: 48, flexShrink: 0 }}>
                  Position
                </span>
                <input
                  aria-label={`${ch} Position (div)`}
                  type="range"
                  min={Math.min(-4, position(ch))}
                  max={Math.max(4, position(ch))}
                  step={0.1}
                  value={position(ch)}
                  style={{ minWidth: 0, flex: 1, accentColor: colors[ch] }}
                  onChange={(event) =>
                    setPosition(ch, Number(event.target.value))
                  }
                />
                <output
                  style={{ font: '11px Consolas,monospace', minWidth: 28 }}
                >
                  {position(ch) >= 0 ? '+' : ''}
                  {Number(position(ch).toFixed(1))}
                </output>
                <Button
                  size="small"
                  style={{ minWidth: 24, width: 24, padding: 0 }}
                  aria-label={`Zero ${ch} position`}
                  onClick={() => setPosition(ch, 0)}
                >
                  0
                </Button>
              </div>
            </section>
          ))}
          <section
            aria-label="Horizontal controls"
            style={{ ...panel, padding: 6, borderTop: '3px solid #c7d6e2' }}
          >
            <strong style={{ display: 'block', marginBottom: 2, fontSize: 11 }}>
              HORIZONTAL
            </strong>
            <ScaleDial
              label="Time / division (s)"
              value={c.timebase}
              steps={scopeTimeSteps}
              unit="s"
              change={(timebase) => change({ timebase })}
            />
          </section>
        </div>
      </div>
    </section>
  );
}
