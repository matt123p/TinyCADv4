import { digest } from '../../io/dsnContainer';
import { deriveTraces } from '../../simulation/traces';
import { DerivedTraces } from './DerivedTraces';
import './simulation.scss';
import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { docDrawing } from '../../state/undo/undo';
import {
  SimulationSetup,
  AnalysisDefinition,
  AnalysisKind,
  newIdentity,
} from '../../simulation/contracts';
import { getResult } from '../../simulation/resultStore';
import {
  getSession,
  subscribeSession,
  runSimulation,
  stopSimulation,
} from '../../simulation/session';
import { exportResult, download, measurements } from '../../simulation/export';
import { buildDeck } from '../../simulation/deck';
import { withoutResults, storedResultBytes } from '../../simulation/document';
import { encodeDrawing } from '../../io/dsnCodec';
import { NetlistWorkerState } from '../../web-worker/netlistState';
import { Waveform } from './Waveform';

const analyses: [AnalysisKind, string][] = [
  ['op', 'Measure DC — Operating Point'],
  ['tran', 'Over time — Transient'],
  ['ac', 'Frequency response — AC'],
  ['dc', 'DC sweep'],
  ['noise', 'Noise'],
  ['tf', 'Transfer function'],
  ['pz', 'Pole-zero'],
];
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  flexDirection: 'column',
  minWidth: 160,
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 16,
  flexWrap: 'wrap',
  margin: '12px 0',
  alignItems: 'end',
};

export function SimulationSheet() {
  const dispatch = useDispatch(),
    store = useStore<docDrawing>();
  const { drawing, selected } = useSelector((state: docDrawing) => ({
    drawing: state.docStore.present.drawing,
    selected: state.docStore.present.view.selected_sheet,
  }));
  const sheet = drawing.sheets[selected],
    setup = sheet.simulation;
  const [, refresh] = useState(0),
    [tab, setTab] = useState('setup'),
    [error, setError] = useState(''),
    [selectedRun, setSelectedRun] = useState(''),
    [deck, setDeck] = useState('');
  const [currentHash, setCurrentHash] = useState('');
  const [row, setRow] = useState(0),
    [modelName, setModelName] = useState('device.lib'),
    [modelText, setModelText] = useState('');
  const [parameterName, setParameterName] = useState(''),
    [parameterValue, setParameterValue] = useState('');
  useEffect(() => subscribeSession(() => refresh((n) => n + 1)), []);
  useEffect(() => {
    setSelectedRun('');
    setRow(0);
    setDeck('');
    setError('');
  }, [sheet.id]);
  const session = getSession(),
    running = session?.sheetId === sheet.id;
  const run =
    setup.runs.find((r) => r.id === selectedRun) ||
    setup.runs[setup.runs.length - 1];
  const originalData = running
    ? session.data
    : run?.dataState === 'available'
    ? getResult(run.id)
    : undefined;
  const [plotIndex, setPlotIndex] = useState(0);
  const plots = originalData
    ? [originalData, ...(originalData.plots || [])]
    : [];
  const derived = originalData
    ? deriveTraces(
        { ...(plots[plotIndex] || originalData), log: originalData.log },
        setup.traces || [],
      )
    : undefined;
  const data = derived?.data;
  const baselineRun = setup.runs.find(
    (r) =>
      r.pinned &&
      r.id !== run?.id &&
      r.analysis.kind === run?.analysis.kind &&
      r.dataState === 'available',
  );
  const baseline = baselineRun ? getResult(baselineRun.id) : undefined;
  const update = (patch: Partial<SimulationSetup>) =>
    dispatch({
      type: 'simulation/update',
      sheetId: sheet.id,
      setup: { ...setup, ...patch },
    });
  const analysis = (patch: Partial<AnalysisDefinition>) =>
    update({ analysis: { ...setup.analysis, ...patch } });
  const input = (key: keyof AnalysisDefinition, label: string) => (
    <label style={fieldStyle} key={key}>
      {label}
      <input
        value={String(setup.analysis[key])}
        disabled={running}
        onChange={(e) => analysis({ [key]: e.target.value })}
      />
    </label>
  );
  const execute = async () => {
    setError('');
    setTab('plot');
    const id = sheet.id,
      document = drawing;
    try {
      await runSimulation(drawing, id, setup, (result) => {
        const current = store.getState().docStore.present.drawing;
        // A completed run belongs only to the document and sheet it started in.
        if (current.documentId !== document.documentId) return;
        const target = current.sheets.find((s) => s.id === id);
        if (!target?.simulation) return;
        const prior = target.simulation.runs;
        dispatch({
          type: 'simulation/update',
          sheetId: id,
          setup: { ...target.simulation, runs: [...prior, result] },
        });
        setSelectedRun(result.id);
      });
    } catch (e) {
      setError(String(e));
      setTab('setup');
    }
  };
  const showDeck = async () => {
    try {
      const net = new NetlistWorkerState().init({
        ...drawing,
        sheets: drawing.sheets.filter((s) => s.kind !== 'simulation'),
      });
      setDeck(buildDeck(net, setup));
      setTab('diagnostics');
    } catch (e) {
      setError(String(e));
    }
  };
  const addModel = () => {
    if (!/^[A-Za-z0-9_-]+\.(?:lib|cir|mod)$/i.test(modelName)) {
      setError('Use a simple .lib, .cir or .mod filename.');
      return;
    }
    update({ models: { ...setup.models, [modelName]: modelText } });
    setModelText('');
  };
  const selectedVectors =
    data?.vectors.filter(
      (v) =>
        v.name !== data.scale &&
        (!setup.signals.length || setup.signals.includes(v.name)),
    ) || [];
  useEffect(() => {
    let valid = true;
    const timer = setTimeout(() => {
      try {
        const circuit = {
          ...drawing,
          sheets: drawing.sheets.filter((s) => s.kind !== 'simulation'),
        };
        const text =
          buildDeck(new NetlistWorkerState().init(circuit), setup) +
          JSON.stringify(setup.models);
        digest(new TextEncoder().encode(text)).then((hash) => {
          if (valid) setCurrentHash(hash);
        });
      } catch {
        if (valid) setCurrentHash('invalid');
      }
    }, 200);
    return () => {
      valid = false;
      clearTimeout(timer);
    };
  }, [drawing.sheets, setup.analysis, setup.parameters, setup.models]);
  const stale = run && currentHash && currentHash !== run.circuitHash;

  return (
    <section
      className="simulation-sheet"
      aria-label="Simulation sheet"
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: 20,
        background: 'var(--colorNeutralBackground1)',
        color: 'var(--colorNeutralForeground1)',
      }}
    >
      <div
        style={{ ...rowStyle, justifyContent: 'space-between', marginTop: 0 }}
      >
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Simulation · {sheet.name}</h2>
          <span>All schematic sheets share one circuit.</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={!!session} onClick={execute}>
            ▶ Run
          </button>
          <button disabled={!running} onClick={stopSimulation}>
            ■ Stop
          </button>
          <button
            disabled={running}
            onClick={() => {
              dispatch({ type: 'simulation/add', name: `${sheet.name} copy` });
              const target = store
                .getState()
                .docStore.present.drawing.sheets.slice(-1)[0];
              dispatch({
                type: 'simulation/update',
                sheetId: target.id,
                setup: { ...setup, runs: [] },
              });
            }}
          >
            Duplicate setup
          </button>
        </div>
      </div>
      <div role="status" aria-live="polite" style={{ marginBottom: 12 }}>
        {running
          ? session.status
          : run
          ? `${run.state} · ${run.samples.toLocaleString()} samples · ${
              run.backend
            } · ${run.buildId}`
          : 'Ready to configure your first experiment.'}
        {stale ? ' · Circuit or settings changed since this run' : ''}
      </div>
      {error && (
        <div
          role="alert"
          style={{ padding: 12, border: '1px solid #c50f1f', marginBottom: 12 }}
        >
          {error}
          <button onClick={() => setError('')} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
      {run?.error && !running && <p role="alert">{run.error}</p>}
      <nav
        aria-label="Simulation views"
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          borderBottom: '1px solid #aaa',
          paddingBottom: 10,
        }}
      >
        {[
          'setup',
          'plot',
          'measurements',
          'data',
          'history',
          'storage',
          'diagnostics',
        ].map((name) => (
          <button
            key={name}
            aria-pressed={tab === name}
            onClick={() => setTab(name)}
          >
            {name[0].toUpperCase() + name.slice(1)}
          </button>
        ))}
      </nav>
      {tab === 'setup' && (
        <div>
          <p>
            Choose the question you want to answer, configure it, then Run. Use
            placed components’ SPICE properties to configure their models,
            values and source waveforms.
          </p>
          <div style={rowStyle}>
            <label style={fieldStyle}>
              Analysis
              <select
                value={setup.analysis.kind}
                disabled={running}
                onChange={(e) =>
                  analysis({ kind: e.target.value as AnalysisKind })
                }
              >
                {analyses.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {input('temperature', 'Temperature (°C)')}
          </div>
          {setup.analysis.kind === 'tran' && (
            <div style={rowStyle}>
              {input('duration', 'Duration (e.g. 5ms)')}
              {input('maxStep', 'Maximum step (e.g. 10us)')}
              <label>
                <input
                  type="checkbox"
                  checked={setup.analysis.initialConditions}
                  onChange={(e) =>
                    analysis({ initialConditions: e.target.checked })
                  }
                />
                Use initial conditions without bias solve (UIC)
              </label>
            </div>
          )}
          {['ac', 'noise'].includes(setup.analysis.kind) && (
            <div style={rowStyle}>
              {input('startFrequency', 'Start frequency (Hz)')}
              {input('stopFrequency', 'Stop frequency (Hz)')}
              <label style={fieldStyle}>
                Points per decade
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={setup.analysis.pointsPerDecade}
                  onChange={(e) =>
                    analysis({ pointsPerDecade: Number(e.target.value) })
                  }
                />
              </label>
            </div>
          )}
          {setup.analysis.kind === 'dc' && (
            <div style={rowStyle}>
              {input('source', 'Source reference (e.g. V1)')}
              {input('sweepStart', 'Start value')}
              {input('sweepStop', 'Stop value')}
              {input('sweepStep', 'Step')}
            </div>
          )}
          {['noise', 'tf', 'pz'].includes(setup.analysis.kind) && (
            <div style={rowStyle}>
              {input(
                'input',
                setup.analysis.kind === 'pz'
                  ? 'Input node'
                  : 'Input source (e.g. V1)',
              )}
              {input('output', 'Output node')}
              {input('reference', 'Reference node')}
            </div>
          )}
          {setup.analysis.kind === 'ac' && (
            <p>
              AC analysis uses each source’s AC amplitude, not its transient
              sine/pulse settings. Set AC 1 on the input source to read its
              transfer response directly.
            </p>
          )}
          <label style={{ ...fieldStyle, maxWidth: 800 }}>
            Instructions / experiment notes
            <textarea
              rows={3}
              value={setup.instructions}
              onChange={(e) => update({ instructions: e.target.value })}
            />
          </label>
          <details style={{ marginTop: 16 }}>
            <summary>Parameters</summary>
            <p>
              Use numeric parameters in component templates as {'{name}'}.
              Definitions apply to this Simulation sheet.
            </p>
            {Object.entries(setup.parameters).map(([name, value]) => (
              <div key={name}>
                {name} = {value}{' '}
                <button
                  onClick={() => {
                    const next = { ...setup.parameters };
                    delete next[name];
                    update({ parameters: next });
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
            <div style={rowStyle}>
              <label style={fieldStyle}>
                Name
                <input
                  value={parameterName}
                  onChange={(e) => setParameterName(e.target.value)}
                />
              </label>
              <label style={fieldStyle}>
                Value
                <input
                  value={parameterValue}
                  onChange={(e) => setParameterValue(e.target.value)}
                />
              </label>
              <button
                disabled={running || !parameterName || !parameterValue}
                onClick={() =>
                  update({
                    parameters: {
                      ...setup.parameters,
                      [parameterName]: parameterValue,
                    },
                  })
                }
              >
                Set parameter
              </button>
            </div>
          </details>
          <details style={{ marginTop: 16 }}>
            <summary>Attached SPICE models</summary>
            <p>
              Model files are stored inside this drawing. Include them from
              component SPICE attributes with .include filename.lib. External
              paths and executable control scripts are rejected. Browser runs do
              not support XSPICE digital models.
            </p>
            {Object.entries(setup.models).map(([name, text]) => (
              <div key={name}>
                <button
                  onClick={() => {
                    setModelName(name);
                    setModelText(text);
                  }}
                >
                  {name}
                </button>
                <button
                  disabled={running}
                  onClick={() => {
                    const next = { ...setup.models };
                    delete next[name];
                    update({ models: next });
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
            <label style={fieldStyle}>
              Filename
              <input
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
              />
            </label>
            <label style={fieldStyle}>
              Model text
              <textarea
                rows={8}
                value={modelText}
                onChange={(e) => setModelText(e.target.value)}
              />
            </label>
            <input
              aria-label="Attach SPICE model file"
              type="file"
              accept=".lib,.cir,.mod"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 8 * 1024 * 1024) {
                  setError('Model exceeds 8 MiB.');
                  return;
                }
                setModelName(file.name);
                setModelText(await file.text());
              }}
            />
            <button disabled={running || !modelText} onClick={addModel}>
              Save attached model
            </button>
          </details>
        </div>
      )}
      {['plot', 'measurements', 'data'].includes(tab) && (
        <div>
          {plots.length > 1 && (
            <label>
              Result plot{' '}
              <select
                value={plotIndex}
                onChange={(e) => setPlotIndex(Number(e.target.value))}
              >
                {plots.map((plot, i) => (
                  <option key={i} value={i}>
                    {plot.scale
                      ? 'Spectrum / sweep'
                      : 'Integrated / scalar results'}{' '}
                    ({i + 1})
                  </option>
                ))}
              </select>
            </label>
          )}
          {!data?.vectors.length ? (
            <p>No numerical results yet. Configure the circuit and Run.</p>
          ) : (
            <>
              <details open style={{ margin: '12px 0' }}>
                <summary>Signals / probes</summary>
                <p>
                  Select outputs to display. Current direction follows the
                  device’s SPICE pin order. Empty selection shows all signals.
                </p>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {data.vectors
                    .filter((v) => v.name !== data.scale)
                    .map((v) => (
                      <label key={v.name}>
                        <input
                          type="checkbox"
                          checked={setup.signals.includes(v.name)}
                          onChange={(e) =>
                            update({
                              signals: e.target.checked
                                ? [...setup.signals, v.name]
                                : setup.signals.filter((s) => s !== v.name),
                            })
                          }
                        />
                        {v.name} [{v.unit}]
                      </label>
                    ))}
                </div>
              </details>
              <DerivedTraces
                signals={data.vectors
                  .filter((v) => v.name !== data.scale)
                  .map((v) => v.name)}
                traces={setup.traces || []}
                change={(traces) => update({ traces })}
              />
              {derived?.errors.map((message) => (
                <p role="status" key={message}>
                  {message}
                </p>
              ))}
              {tab === 'plot' &&
                (data.scale ? (
                  <>
                    {Object.entries(
                      selectedVectors.reduce((groups, vector) => {
                        (groups[vector.unit] ||= []).push(vector.name);
                        return groups;
                      }, {} as Record<string, string[]>),
                    ).map(([unit, signals]) => (
                      <div key={unit}>
                        <h3>{unit}</h3>
                        <Waveform
                          key={`${sheet.id}-${
                            run?.id || 'running'
                          }-${plotIndex}-${unit}`}
                          data={data}
                          signals={signals}
                          baseline={baseline}
                        />
                      </div>
                    ))}
                  </>
                ) : (
                  <table>
                    <caption>Operating point / scalar values</caption>
                    <thead>
                      <tr>
                        <th>Signal</th>
                        <th>Value</th>
                        <th>Unit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedVectors.map((v) => (
                        <tr key={v.name}>
                          <th>{v.name}</th>
                          <td>
                            {v.real[0]?.toPrecision(8)}
                            {v.imaginary?.[0]
                              ? ` ${v.imaginary[0] < 0 ? '−' : '+'} j${Math.abs(
                                  v.imaginary[0],
                                ).toPrecision(8)}`
                              : ''}
                          </td>
                          <td>{v.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
              {tab === 'measurements' && (
                <>
                  <p>
                    Statistics over the real component of all accepted samples
                    (sample-weighted mean/RMS, not an AC RMS voltage
                    measurement). Transient samples may be nonuniform.
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th>Signal</th>
                        <th>Minimum</th>
                        <th>Maximum</th>
                        <th>Mean</th>
                        <th>RMS</th>
                        <th>Peak–peak</th>
                        <th>Unit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedVectors
                        .filter((v) => v.real.length)
                        .map((v) => {
                          const m = measurements(v.real);
                          return (
                            <tr key={v.name}>
                              <th>{v.name}</th>
                              {Object.values(m).map((value, i) => (
                                <td key={i}>{value.toPrecision(7)}</td>
                              ))}
                              <td>{v.unit}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                  <button
                    onClick={() =>
                      download(
                        'measurements.json',
                        JSON.stringify(
                          selectedVectors
                            .filter((v) => v.real.length)
                            .map((v) => ({
                              signal: v.name,
                              unit: v.unit,
                              interval: 'all accepted samples',
                              weighting: 'sample',
                              ...measurements(v.real),
                            })),
                          null,
                          2,
                        ),
                        'application/json',
                      )
                    }
                  >
                    Export measurements
                  </button>
                </>
              )}
              {tab === 'data' && (
                <>
                  <div style={rowStyle}>
                    <button
                      disabled={row === 0}
                      onClick={() => setRow(Math.max(0, row - 100))}
                    >
                      Previous 100
                    </button>
                    <span>
                      Rows {row + 1}–
                      {Math.min(row + 100, data.vectors[0]?.real.length || 0)}
                    </span>
                    <button
                      disabled={
                        row + 100 >= (data.vectors[0]?.real.length || 0)
                      }
                      onClick={() => setRow(row + 100)}
                    >
                      Next 100
                    </button>
                  </div>
                  <div style={{ overflow: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Sample</th>
                          {data.vectors.map((v) => (
                            <th key={v.name}>
                              {v.name} [{v.unit}]
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from(
                          {
                            length: Math.max(
                              0,
                              Math.min(
                                100,
                                (data.vectors[0]?.real.length || 0) - row,
                              ),
                            ),
                          },
                          (_, i) => (
                            <tr key={i}>
                              <th>{row + i}</th>
                              {data.vectors.map((v) => (
                                <td key={v.name}>
                                  {v.real[row + i]?.toPrecision(8)}
                                  {v.imaginary?.[row + i]
                                    ? ` + j${v.imaginary[row + i].toPrecision(
                                        8,
                                      )}`
                                    : ''}
                                </td>
                              ))}
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {!running && run && (
                <div style={rowStyle}>
                  <button onClick={() => exportResult(run, data, 'csv')}>
                    Export CSV
                  </button>
                  <button
                    onClick={() => exportResult(run, originalData, 'json')}
                  >
                    Export JSON
                  </button>
                  <button
                    onClick={() =>
                      exportResult(
                        { ...run, samples: data.vectors[0]?.real.length || 0 },
                        data,
                        'raw',
                      )
                    }
                  >
                    Export SPICE raw
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {tab === 'history' && (
        <div>
          <p>
            Each run records its own settings and solver identity. Pin a
            compatible run to overlay as a dashed baseline.
          </p>
          {setup.runs.length === 0 ? (
            <p>No runs yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Acquisition</th>
                  <th>Analysis</th>
                  <th>State</th>
                  <th>Data</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {[...setup.runs].reverse().map((r) => (
                  <tr key={r.id}>
                    <th>
                      <button
                        onClick={() => {
                          setSelectedRun(r.id);
                          setRow(0);
                          setTab('plot');
                        }}
                      >
                        {new Date(r.created).toLocaleString()}
                      </button>
                    </th>
                    <td>{r.analysis.kind}</td>
                    <td>
                      {r.state} · {r.samples} samples
                    </td>
                    <td>{r.dataState}</td>
                    <td>
                      <button
                        aria-pressed={r.pinned}
                        onClick={() =>
                          update({
                            runs: setup.runs.map((other) => ({
                              ...other,
                              pinned: other.id === r.id ? !r.pinned : false,
                            })),
                          })
                        }
                      >
                        {r.pinned ? 'Unpin' : 'Pin baseline'}
                      </button>
                      <button
                        disabled={running}
                        onClick={() =>
                          update({
                            analysis: { ...r.analysis },
                            parameters: { ...r.parameters },
                          })
                        }
                      >
                        Restore settings
                      </button>
                      <button
                        disabled={r.dataState !== 'available'}
                        onClick={() =>
                          dispatch({
                            type: 'simulation/remove-results',
                            ids: [r.id],
                          })
                        }
                      >
                        Remove data
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {tab === 'storage' && (
        <div>
          <p>
            Stored numerical results:{' '}
            {(storedResultBytes(drawing) / 1024 / 1024).toFixed(2)} MiB.
            Removing data keeps circuit, setup, signal selection and run
            history. Undo restores removed data during this session.
          </p>
          <label>
            <input
              type="checkbox"
              checked={setup.retainResults}
              onChange={(e) => update({ retainResults: e.target.checked })}
            />
            Include this sheet’s results when saving
          </label>
          <div style={rowStyle}>
            <label style={fieldStyle}>
              Drawing format
              <select
                value={drawing.saveFormat || 'auto'}
                onChange={(e) =>
                  dispatch({
                    type: 'simulation/format',
                    representation: e.target.value,
                  })
                }
              >
                <option value="auto">Automatic (.dsn; .dzn for results ≥ 1 MiB)</option>
                <option value="zip-v1">Compressed drawing (.dzn)</option>
                <option value="xml">XML drawing (.dsn, with inline results)</option>
              </select>
            </label>
            <button
              disabled={!!session}
              onClick={() => dispatch({ type: 'simulation/remove-results' })}
            >
              Remove all stored results
            </button>
            <button
              onClick={async () => {
                try {
                  download(
                    'drawing-compact.dzn',
                    await encodeDrawing(withoutResults(drawing), 'zip-v1'),
                    'application/octet-stream',
                  );
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              Save compact copy
            </button>
          </div>
          <p>
            A compact copy has no numerical results and does not replace the
            open drawing. Format is detected from the file header, regardless of
            filename.
          </p>
          {drawing.saveFormat === 'xml' && (
            <p>
              XML drawings still contain new simulation records. Older TinyCAD
              versions may discard those records; keep the complete original
              when sharing with an older version.
            </p>
          )}
        </div>
      )}
      {tab === 'diagnostics' && (
        <div>
          <p>
            Browser: isolated WebAssembly worker, analogue models. Electron:
            isolated native process with bundled XSPICE modules. Stop terminates
            the isolated solver and preserves accepted samples; pause and live
            controls are not exposed by these builds.
          </p>
          <button onClick={showDeck}>Generate circuit text</button>
          {deck && (
            <>
              <button
                onClick={() => download('simulation.cir', deck, 'text/plain')}
              >
                Export circuit
              </button>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{deck}</pre>
            </>
          )}
          <h3>Solver log</h3>
          <pre style={{ whiteSpace: 'pre-wrap' }}>
            {data?.log || 'No solver log for this acquisition.'}
          </pre>
        </div>
      )}
    </section>
  );
}
