import React, { Dispatch, useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  Field,
  FluentProvider,
  Input,
  Select,
  Switch,
  webDarkTheme,
} from '@fluentui/react-components';
import { useStore } from 'react-redux';
import { dsnDrawing } from '../../model/dsnDrawing';
import { dsnSymbol } from '../../model/dsnItem';
import { docDrawing } from '../../state/undo/undo';
import { readControl, sourcePreview } from '../../simulation/controls';
import {
  InstrumentConfig,
  generatorSource,
  instrumentNames,
  instrumentSignals,
  instrumentTemplate,
  meterReading,
  meterDisplay,
  scopeDisplay,
} from '../../simulation/instruments';
import { parseQuantity, positiveQuantity } from '../../simulation/numbers';
import {
  defaultSetup,
  SimulationRun,
  ResultData,
} from '../../simulation/contracts';
import {
  runSimulation,
  getSession,
  stopSimulation,
  subscribeSession,
} from '../../simulation/session';
import { useInstrumentAcquisition } from '../simulation/useInstrumentAcquisition';
import { Waveform } from '../simulation/Waveform';
import { openInstrumentWindow } from '../simulation/instrumentWindowState';
import { Oscilloscope } from '../simulation/Oscilloscope';
import { symbolReference } from '../../simulation/bindings';
import {
  resistanceCircuit,
  ResistanceTest,
} from '../../simulation/resistanceTest';
import { digest } from '../../io/dsnContainer';
import { buildDeck } from '../../simulation/deck';
import { NetlistWorkerState } from '../../web-worker/netlistState';
import {
  actionSelectPanel,
  Panels,
} from '../../state/dispatcher/AppDispatcher';

const row: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  flexWrap: 'wrap',
  alignItems: 'end',
};
const group: React.CSSProperties = {
  background: '#26313d',
  border: '1px solid #526170',
  borderRadius: 8,
  padding: 12,
};
function Knob({
  label,
  value,
  unit,
  minimum,
  maximum,
  change,
}: {
  label: string;
  value: string;
  unit: string;
  minimum: number;
  maximum: number;
  change: (value: string) => void;
}) {
  let n = minimum;
  try {
    n = parseQuantity(value, unit);
  } catch {
    /* Numeric editor retains incomplete input. */
  }
  const position = Math.max(
    0,
    Math.min(1, (n - minimum) / (maximum - minimum)),
  );
  return (
    <Field label={label} size="small" style={{ width: 145 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <div
          aria-hidden
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            background: 'radial-gradient(circle,#788594,#151c25)',
            border: '2px solid #9daab8',
            transform: `rotate(${-130 + position * 260}deg)`,
          }}
        >
          <div
            style={{
              height: 13,
              width: 3,
              margin: '2px auto',
              background: '#f9d46a',
            }}
          />
        </div>
        <Input
          size="small"
          value={value}
          onChange={(_, d) => change(d.value)}
          style={{ minWidth: 0, width: 95 }}
        />
      </div>
      <input
        aria-label={`${label} dial`}
        type="range"
        min={0}
        max={1000}
        value={position * 1000}
        onChange={(e) =>
          change(
            String(
              minimum + ((maximum - minimum) * Number(e.target.value)) / 1000,
            ),
          )
        }
      />
    </Field>
  );
}
export const InstrumentPanel = React.memo(function InstrumentPanel({
  symbol,
  drawing,
  dispatch,
  windowClose,
}: {
  symbol: dsnSymbol;
  drawing: dsnDrawing;
  dispatch: Dispatch<any>;
  windowClose?: () => void;
}) {
  const store = useStore<docDrawing>(),
    read = readControl(symbol),
    config = read?.kind === 'instrument' ? read : undefined;
  const [selected, setSelected] = useState(''),
    [error, setError] = useState('');
  const [, refresh] = useState(0);
  useEffect(() => subscribeSession(() => refresh((n) => n + 1)), []);
  const acq = useInstrumentAcquisition(drawing, selected);
  useEffect(() => {
    if (config?.acquisition !== 'single') setSelected('');
  }, [acq.available[0]?.run.id]);
  if (!config) return null;
  const c = config,
    ref = symbolReference(symbol),
    change = (patch: Partial<InstrumentConfig>) => {
      const sheet = drawing.sheets.find((s) => s.items.includes(symbol));
      dispatch({
        type: 'simulation/configure-control',
        config: { ...c, ...patch },
        ...(sheet ? { sheetId: sheet.id, symbolId: symbol._id } : {}),
      });
    };
  const sourceChange = (patch: Partial<InstrumentConfig['source']>) =>
    change({ source: { ...c.source, ...patch } });
  let invalid = '';
  let signals: ResultData,
    scope: ReturnType<typeof scopeDisplay>,
    preview: ResultData;
  try {
    instrumentTemplate(c);
    if (acq.net && acq.data)
      signals = instrumentSignals(acq.net, symbol, acq.data, c);
    if (c.type === 'scope' && signals) scope = scopeDisplay(signals, c);
    if (c.type === 'generator') preview = sourcePreview(generatorSource(c));
  } catch (e) {
    invalid = e instanceof Error ? e.message : String(e);
  }
  const busy = !!getSession();
  const acquire = async (resistance = false) => {
    setError('');
    try {
      if (!drawing.sheets.some((s) => s.items.includes(symbol)))
        throw new Error(
          'Place the instrument on the diagram before acquiring.',
        );
      if (!drawing.sheets.some((s) => s.kind === 'simulation'))
        dispatch({
          type: 'simulation/add',
          name: 'Laboratory',
          preserveSelection: true,
        });
      const current = store.getState().docStore.present.drawing,
        target =
          current.sheets.find((s) => s.id === acq.chosen?.sheet.id) ||
          current.sheets.find((s) => s.kind === 'simulation');
      const setup = {
        ...(target?.simulation || defaultSetup()),
        analysis: { ...(target?.simulation || defaultSetup()).analysis },
      };
      if (
        c.type === 'scope' ||
        (c.type === 'meter' && c.mode.startsWith('ac'))
      ) {
        setup.analysis.kind = 'tran';
        setup.analysis.duration = String(
          positiveQuantity(c.timebase, 's') * 10,
        );
        setup.analysis.maxStep = String(
          positiveQuantity(c.timebase, 's') / 100,
        );
      } else if (c.type === 'meter' || c.type === 'supply')
        setup.analysis.kind = 'op';
      let circuit = current,
        test: ResistanceTest;
      if (resistance) {
        setup.analysis.kind = 'op';
        const sheet = current.sheets.find((s) =>
          s.items.some((i) => i._id === symbol._id),
        );
        const net = new NetlistWorkerState().init({
          ...current,
          sheets: current.sheets.filter((s) => s.kind !== 'simulation'),
        });
        const baseHash = await digest(
          new TextEncoder().encode(
            buildDeck(net, setup) + JSON.stringify(setup.models),
          ),
        );
        test = {
          sheet: sheet.id || sheet.name,
          reference: ref,
          current: c.testCurrent,
          baseHash,
        };
        circuit = resistanceCircuit(current, test);
      }
      await runSimulation(
        circuit,
        target.id,
        setup,
        (run: SimulationRun) => {
          const live = store.getState().docStore.present.drawing,
            slot = live.sheets.find((s) => s.id === target.id);
          if (live.documentId !== current.documentId || !slot?.simulation)
            return;
          dispatch({
            type: 'simulation/update',
            sheetId: target.id,
            setup: {
              ...slot.simulation,
              analysis: setup.analysis,
              runs: [...slot.simulation.runs, run],
            },
          });
          setSelected(run.id);
        },
        (errors) => {
          dispatch({
            type: 'simulation/diagnostics',
            documentId: current.documentId,
            errors,
          });
          if (errors.length) dispatch(actionSelectPanel(Panels.DrcPanel));
        },
        { overrides: {}, resistanceTest: test },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const choose = (
    label: string,
    value: string,
    values: string[],
    change: (v: string) => void,
  ) => (
    <Field label={label} size="small">
      <Select size="small" value={value} onChange={(_, d) => change(d.value)}>
        {values.map((v) => (
          <option key={v} value={v}>
            {(
              {
                dcV: 'DC V',
                acV: 'AC V ~',
                dcA: 'DC A',
                acA: 'AC A ~',
                ohm: 'Ω',
                auto: 'Auto',
                normal: 'Normal',
                single: 'Single',
                sine: 'Sine',
                pulse: 'Pulse / square',
                triangle: 'Triangle',
                pwl: 'Arbitrary PWL',
              } as Record<string, string>
            )[v] || v}
          </option>
        ))}
      </Select>
    </Field>
  );
  let reading = signals ? meterReading(signals, c) : undefined;
  if (c.type === 'meter' && c.mode === 'ohm' && signals) {
    const test = acq.chosen?.run.resistanceTest,
      voltage = signals.vectors.find((v) => v.name === 'Reading')?.real[0];
    const sheet = drawing.sheets.find((s) => s.items.includes(symbol));
    if (
      test &&
      test.reference === ref &&
      test.sheet === (sheet?.id || sheet?.name) &&
      Number.isFinite(voltage)
    ) {
      const value = voltage / positiveQuantity(test.current, 'A');
      reading = {
        ...meterDisplay(value, 'Ohm', c.range),
        explanation: `Unpowered passive-network test at ${test.current}; independent sources suppressed, other instruments disconnected. Not an energised-circuit reading.`,
      };
    }
  }
  const compatible =
    !acq.chosen?.run.resistanceTest || (c.type === 'meter' && c.mode === 'ohm');
  const display = (
    <FluentProvider
      aria-label={`${c.type} instrument`}
      theme={webDarkTheme}
      style={{
        height: '100%',
        overflow: 'auto',
        boxSizing: 'border-box',
        background: '#161e28',
        color: '#e5eef7',
        padding: c.type === 'scope' ? 6 : 14,
        border: '3px solid #566575',
        borderRadius: 12,
        minWidth: 0,
      }}
    >
      <header
        style={{
          ...row,
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: c.type === 'scope' ? 4 : 12,
        }}
      >
        <strong style={{ letterSpacing: 1 }}>
          TinyCAD LAB · {ref} · {instrumentNames[c.type]}
        </strong>
        <div style={row}>
          {(c.type === 'generator' || c.type === 'supply') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontWeight: c.student ? 600 : 400 }}>Basic</span>
              <Switch
                aria-label="Basic - Advanced"
                checked={!c.student}
                onChange={(_, d) => change({ student: !d.checked })}
              />
              <span style={{ fontWeight: c.student ? 400 : 600 }}>Advanced</span>
            </div>
          )}
          <Button
            size="small"
            disabled={busy || !!invalid}
            onClick={() => acquire(c.type === 'meter' && c.mode === 'ohm')}
          >
            {c.type === 'scope'
              ? 'Acquire'
              : c.type === 'meter' && c.mode === 'ohm'
              ? 'Run unpowered Ω test'
              : 'Measure / Run'}
          </Button>
          <Button size="small" disabled={!busy} onClick={stopSimulation}>
            Stop
          </Button>
        </div>
      </header>
      <div style={{ ...row, alignItems: 'start' }}>
        {c.type === 'scope' ? (
          invalid ? (
            <p role="alert">{invalid}</p>
          ) : (
            <Oscilloscope
              config={c}
              scope={compatible ? scope : undefined}
              busy={busy}
              checking={acq.checking}
              fresh={acq.fresh && compatible}
              change={change}
            />
          )
        ) : (
          <>
            <section style={{ ...group, flex: '2 1 360px', minWidth: 300 }}>
              {c.type === 'meter' ? (
                <>
                  <div
                    aria-label="Multimeter display"
                    style={{
                      background: '#071c18',
                      color: '#aef9c5',
                      border: '4px inset #61786b',
                      padding: 16,
                      font: 'bold 44px Consolas,monospace',
                      minHeight: 65,
                    }}
                  >
                    {compatible && acq.fresh ? reading?.text || '—' : '—'}{' '}
                    <small style={{ fontSize: 20 }}>
                      {reading?.displayUnit ||
                        reading?.unit ||
                        (c.mode === 'ohm'
                          ? 'Ω'
                          : c.mode.endsWith('A')
                          ? 'A'
                          : 'V')}
                    </small>
                  </div>
                  <p>
                    {compatible && acq.fresh
                      ? reading?.explanation
                      : 'No current acquisition. Wire both terminals and Measure / Run.'}
                  </p>
                </>
              ) : c.type === 'generator' ? (
                <>
                  {preview && (
                    <Waveform compact data={preview} signals={['Source']} />
                  )}
                  <small>
                    Preview is the programmed open-circuit stimulus. Actual
                    terminal amplitude depends on the load and output
                    resistance.
                  </small>
                </>
              ) : (
                <>
                  <div
                    style={{
                      background: '#071c18',
                      color: '#b5f8ce',
                      padding: 16,
                      font: 'bold 32px Consolas,monospace',
                    }}
                  >
                    {signals?.vectors
                      .find((v) => v.name === 'Voltage')
                      ?.real.at(-1)
                      ?.toPrecision(5) || '—'}{' '}
                    V ·{' '}
                    {signals?.vectors
                      .find((v) => v.name === 'Current')
                      ?.real.at(-1)
                      ?.toPrecision(5) || '—'}{' '}
                    A
                  </div>
                  <p>
                    Output {c.enabled ? 'ON' : 'OFF'} ·{' '}
                    {signals &&
                    Math.abs(
                      signals.vectors
                        .find((v) => v.name === 'Current')
                        ?.real.at(-1) || 0,
                    ) >
                      0.95 * positiveQuantity(c.currentLimit, 'A')
                      ? 'CC · limiting'
                      : 'CV / no acquisition'}{' '}
                    · Soft symmetric current limit; finite output resistance.
                    This models electrical regulation, not thermal or switching
                    behaviour.
                  </p>
                </>
              )}
            </section>
            <section style={{ ...group, flex: '1 1 280px', minWidth: 260 }}>
              {c.type === 'meter' ? (
                <>
                  <div style={row}>
                    {choose(
                      'Function',
                      c.mode,
                      ['dcV', 'acV', 'dcA', 'acA', 'ohm'],
                      (mode) => change({ mode: mode as any, range: 'auto' }),
                    )}
                    {choose(
                      'Range',
                      c.range,
                      [
                        'auto',
                        ...(c.mode === 'ohm'
                          ? ['200Ohm', '2kOhm', '20kOhm', '200kOhm', '2megOhm']
                          : c.mode.endsWith('A')
                          ? ['2mA', '20mA', '200mA', '2A']
                          : ['200mV', '2V', '20V', '200V']),
                      ],
                      (range) => change({ range }),
                    )}
                  </div>
                  <p>
                    V Ω / COM: voltage and resistance in parallel. A / COM:
                    current in series. Move the lead when changing input type.
                    Mode changes alter the electrical loading and require a new
                    run.
                  </p>
                  {c.mode === 'ohm' ? (
                    <Field label="Resistance test current">
                      <Input
                        value={c.testCurrent}
                        onChange={(_, d) => change({ testCurrent: d.value })}
                      />
                    </Field>
                  ) : c.mode.endsWith('A') ? (
                    <Field label="Burden resistance (Ohm)">
                      <Input
                        value={c.burden}
                        onChange={(_, d) => change({ burden: d.value })}
                      />
                    </Field>
                  ) : (
                    <Field label="Input resistance (Ohm)">
                      <Input
                        value={c.inputResistance}
                        onChange={(_, d) =>
                          change({ inputResistance: d.value })
                        }
                      />
                    </Field>
                  )}
                  {c.mode.startsWith('ac') && (
                    <Knob
                      label="Window / division (s)"
                      value={c.timebase}
                      unit="s"
                      minimum={0.000001}
                      maximum={0.1}
                      change={(timebase) => change({ timebase })}
                    />
                  )}
                </>
              ) : c.type === 'generator' ? (
                <>
                  <div style={row}>
                    {choose(
                      'Waveform',
                      c.source.waveform,
                      ['sine', 'pulse', 'triangle', 'pwl'],
                      (waveform) => sourceChange({ waveform: waveform as any }),
                    )}
                    <Checkbox
                      label="Output enabled"
                      checked={c.enabled}
                      onChange={(_, d) => change({ enabled: !!d.checked })}
                    />
                  </div>
                  <div style={row}>
                    <Knob
                      label="Frequency (Hz)"
                      value={c.source.frequency}
                      unit="Hz"
                      minimum={1}
                      maximum={10000}
                      change={(frequency) => sourceChange({ frequency })}
                    />
                    <Knob
                      label="Amplitude (V peak)"
                      value={c.source.amplitude}
                      unit="V"
                      minimum={0.001}
                      maximum={10}
                      change={(amplitude) => sourceChange({ amplitude })}
                    />
                    <Knob
                      label="Offset (V)"
                      value={c.source.offset}
                      unit="V"
                      minimum={-10}
                      maximum={10}
                      change={(offset) => sourceChange({ offset })}
                    />
                    <Knob
                      label="Duty (%)"
                      value={c.duty}
                      unit=""
                      minimum={1}
                      maximum={99}
                      change={(duty) => change({ duty })}
                    />
                    {!c.student && (
                      <Knob
                        label="Phase (degrees)"
                        value={c.source.phase}
                        unit=""
                        minimum={-180}
                        maximum={180}
                        change={(phase) => sourceChange({ phase })}
                      />
                    )}
                  </div>
                  {c.source.waveform === 'pwl' && (
                    <Field label="Arbitrary waveform points: time voltage">
                      <Input
                        value={c.source.points}
                        onChange={(_, d) => sourceChange({ points: d.value })}
                      />
                    </Field>
                  )}
                  <Field label="Output resistance (Ohm)">
                    <Input
                      value={c.outputResistance}
                      onChange={(_, d) => change({ outputResistance: d.value })}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <div style={row}>
                    <Knob
                      label="Set voltage (V)"
                      value={c.voltage}
                      unit="V"
                      minimum={0}
                      maximum={30}
                      change={(voltage) => change({ voltage })}
                    />
                    <Knob
                      label="Current limit (A)"
                      value={c.currentLimit}
                      unit="A"
                      minimum={0.001}
                      maximum={1}
                      change={(currentLimit) => change({ currentLimit })}
                    />
                    <Checkbox
                      label="Output enabled"
                      checked={c.enabled}
                      onChange={(_, d) => change({ enabled: !!d.checked })}
                    />
                  </div>
                  {!c.student && (
                    <div style={row}>
                      <Field label="Output resistance (Ohm)">
                        <Input
                          value={c.outputResistance}
                          onChange={(_, d) =>
                            change({ outputResistance: d.value })
                          }
                        />
                      </Field>
                      <Field label="Ramp time (s)">
                        <Input
                          value={c.ramp}
                          onChange={(_, d) => change({ ramp: d.value })}
                        />
                      </Field>
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        )}
      </div>
      <footer
        style={{
          ...row,
          gap: c.type === 'scope' ? 6 : 12,
          marginTop: c.type === 'scope' ? 4 : 10,
          fontSize: c.type === 'scope' ? 11 : undefined,
        }}
      >
        <Field
          label="Acquisition"
          size="small"
          orientation={c.type === 'scope' ? 'horizontal' : 'vertical'}
          style={
            c.type === 'scope'
              ? { display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }
              : undefined
          }
        >
          <Select
            size="small"
            aria-label="Recorded acquisition"
            style={
              c.type === 'scope' ? { maxWidth: 250, minWidth: 0 } : undefined
            }
            value={acq.chosen?.run.id || ''}
            onChange={(_, d) => setSelected(d.value)}
          >
            <option value="">Latest available</option>
            {acq.available.map((a) => (
              <option key={a.run.id} value={a.run.id}>
                {a.sheet.name} · {a.run.analysis.kind} · {a.run.created}
              </option>
            ))}
          </Select>
        </Field>
        <span>
          {acq.fresh
            ? 'Acquisition matches circuit'
            : 'No current result / circuit changed'}
        </span>
        {(c.type === 'scope' || c.type === 'meter') &&
          process.env.TARGET_SYSTEM === 'electron' &&
          !windowClose && (
            <Button
              size="small"
              onClick={() => {
                const sheet = drawing.sheets.find((s) =>
                  s.items.includes(symbol),
                );
                if (!sheet) setError('Place the instrument first.');
                else if (
                  !openInstrumentWindow(
                    drawing.documentId,
                    sheet.id,
                    symbol._id,
                    ref,
                  )
                )
                  setError('Instrument window could not be opened.');
              }}
            >
              Pop out instrument
            </Button>
          )}
        {windowClose && (
          <Button size="small" onClick={windowClose}>
            Dock instrument
          </Button>
        )}
      </footer>
      {(c.type !== 'scope' ||
        Object.keys(acq.chosen?.run.explorer?.overrides || {}).length > 0) && (
        <p style={{ fontSize: 12, margin: '8px 0 0' }}>
          Recorded acquisition; Acquire / Measure captures new data.{' '}
          {Object.entries(acq.chosen?.run.explorer?.overrides || {})
            .map(
              ([id, value]) =>
                `${
                  acq.chosen.run.explorer.bindings.find((b) => b.id === id)
                    ?.name || id
                } = ${value}`,
            )
            .join(' · ')}
        </p>
      )}
      {(error || invalid) && <p role="alert">{error || invalid}</p>}
    </FluentProvider>
  );
  return display;
});
