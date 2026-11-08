import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Button,
  Checkbox,
  Field,
  Input,
  Select,
  tokens,
} from '@fluentui/react-components';
import {
  AddRegular,
  DismissRegular,
  OpenRegular,
  PlayRegular,
  StopRegular,
} from '@fluentui/react-icons';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { docDrawing } from '../../state/undo/undo';
import {
  drawingProbes,
  reconcileCharts,
  WorkspaceChart,
  workspaceChartData,
  ChartProbe,
} from '../../simulation/chartWorkspace';
import { getResult } from '../../simulation/resultStore';
import {
  getSession,
  subscribeSession,
  runSimulation,
  stopSimulation,
} from '../../simulation/session';
import { NetlistWorkerState } from '../../web-worker/netlistState';
import { NetlistData } from '../../io/netlists/netlistGenerator';
import { dsnDrawing } from '../../model/dsnDrawing';
import { ResultData, SimulationSetup } from '../../simulation/contracts';
import { hasSimulation } from '../../io/drawingSaveFormat';
import { buildDeck } from '../../simulation/deck';
import { digest } from '../../io/dsnContainer';
import { Waveform } from './Waveform';
import { ChartPopup, ChartPopupPortal, openChartPopup } from './ChartPopup';
import { ResizeHandle } from '../panel/ResizeHandle';
import {
  actionSelectPanel,
  Panels,
} from '../../state/dispatcher/AppDispatcher';

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 6,
};

function WorkspaceChartView({
  chart,
  probes,
  net,
  data,
  traces,
  fresh,
  message,
  update,
  remove,
}: {
  chart: WorkspaceChart;
  probes: ChartProbe[];
  net: NetlistData;
  data?: ResultData;
  traces: SimulationSetup['traces'];
  fresh: boolean;
  message: string;
  update: (chart: WorkspaceChart) => void;
  remove: () => void;
}) {
  const [popup, setPopup] = useState<ChartPopup>();
  const [error, setError] = useState('');
  const activePopup = useRef<ChartPopup>();
  activePopup.current = popup;
  useEffect(
    () => () => {
      activePopup.current?.child.close();
    },
    [],
  );
  useEffect(() => {
    if (popup && !popup.child.closed) popup.child.document.title = chart.title;
  }, [popup, chart.title]);
  const returnToPanel = () => {
    const prior = activePopup.current;
    activePopup.current = undefined;
    setPopup(undefined);
    if (prior && !prior.child.closed) prior.child.close();
  };
  const result = useMemo(
    () => workspaceChartData(chart, probes, net, data, traces, fresh),
    [chart, probes, net, data, traces, fresh],
  );
  const available =
    result?.vectors.filter((v) => v.name !== result.scale) || [];
  const content = (
    <>
      <div style={row}>
        <strong style={{ flex: 1 }}>{chart.title}</strong>
        {popup && (
          <Button size="small" onClick={returnToPanel}>
            Return to panel
          </Button>
        )}
      </div>
      {result && available.length ? (
        <>
          <Waveform data={result} signals={chart.signals} compact={!popup} />
          {!result.scale && (
            <div>
              {available
                .filter(
                  (v) =>
                    !chart.signals.length || chart.signals.includes(v.name),
                )
                .map((v) => (
                  <div key={v.name}>
                    {v.name}: {v.real[0]?.toPrecision(7)} {v.unit}
                  </div>
                ))}
            </div>
          )}
        </>
      ) : (
        <p role="status">
          {message ||
            'No matching signal. Check the probe connections and selected acquisition.'}
        </p>
      )}
    </>
  );
  return (
    <section
      style={{
        padding: 12,
        borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
      }}
    >
      <div style={row}>
        <Input
          size="small"
          aria-label="Chart title"
          value={chart.title}
          style={{ flex: 1, minWidth: 0 }}
          onChange={(_, d) => update({ ...chart, title: d.value })}
        />
        {process.env.TARGET_SYSTEM === 'electron' && (
          <Button
            size="small"
            appearance="subtle"
            icon={<OpenRegular />}
            title={popup ? 'Focus chart window' : 'Open chart in a new window'}
            aria-label={
              popup ? 'Focus chart window' : 'Open chart in a new window'
            }
            onClick={() => {
              if (popup && !popup.child.closed) {
                popup.child.focus();
                return;
              }
              const opened = openChartPopup(chart.title);
              if (!opened) setError('The chart window could not be opened.');
              else {
                setError('');
                setPopup(opened);
              }
            }}
          />
        )}
        <Button
          size="small"
          appearance="subtle"
          icon={<DismissRegular />}
          aria-label="Remove chart"
          title="Remove chart"
          onClick={remove}
        />
      </div>
      {!chart.probeId && (
        <details style={{ marginTop: 6 }}>
          <summary>Choose signals</summary>
          <p style={{ fontSize: 12, margin: '4px 0' }}>
            No selection shows all signals. Different units use separate axes.
          </p>
          <div style={row}>
            {available.map((v) => (
              <Checkbox
                key={v.name}
                label={`${v.name} (${v.unit})`}
                checked={chart.signals.includes(v.name)}
                onChange={(_, d) =>
                  update({
                    ...chart,
                    signals: d.checked
                      ? [...chart.signals, v.name]
                      : chart.signals.filter((s) => s !== v.name),
                  })
                }
              />
            ))}
          </div>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
      {popup ? (
        <>
          <p>Displayed in a separate window.</p>
          <Button size="small" onClick={returnToPanel}>
            Return to panel
          </Button>
          <ChartPopupPortal popup={popup} onClose={returnToPanel}>
            {content}
          </ChartPopupPortal>
        </>
      ) : (
        <div style={{ marginTop: 8 }}>{content}</div>
      )}
    </section>
  );
}

export function ChartWorkspace() {
  const drawing = useSelector(
    (state: docDrawing) => state.docStore.present.drawing,
  );
  return <DocumentCharts key={drawing.documentId} drawing={drawing} />;
}
function DocumentCharts({ drawing }: { drawing: dsnDrawing }) {
  const dispatch = useDispatch(),
    store = useStore<docDrawing>();
  const [visible, setVisible] = useState(true),
    [forced, setForced] = useState(false);
  const [width, setWidth] = useState(430);
  const [charts, setCharts] = useState<WorkspaceChart[]>([]);
  const hidden = useRef(new Set<string>());
  const [revision, setRevision] = useState(0);
  const [simulationId, setSimulationId] = useState(''),
    [runId, setRunId] = useState('latest');
  const [plotIndex, setPlotIndex] = useState(0),
    [addChoice, setAddChoice] = useState('custom');
  const [error, setError] = useState('');
  const [verified, setVerified] = useState<{
    drawing: dsnDrawing;
    key: string;
    matches: boolean;
  }>();
  const probes = useMemo(() => drawingProbes(drawing), [drawing]);
  const simulations = drawing.sheets.filter((s) => s.kind === 'simulation');
  const selected =
    simulations.find((s) => s.id === simulationId) || simulations[0];
  const session = getSession();
  const running = !!session && !!selected && session.sheetId === selected.id;
  const runs =
    selected?.simulation.runs.filter(
      (r) => r.dataState === 'available' && getResult(r.id),
    ) || [];
  const run = runs.find((r) => r.id === runId) || runs.at(-1);
  const raw = running ? session.data : run ? getResult(run.id) : undefined;
  const data = useMemo(
    () =>
      raw
        ? {
            ...(plotIndex ? raw.plots?.[plotIndex - 1] || raw : raw),
            log: raw.log,
          }
        : undefined,
    [raw, plotIndex, revision],
  );
  const plots = raw ? [raw, ...(raw.plots || [])] : [];
  const net = useMemo(() => {
    try {
      return new NetlistWorkerState().init({
        ...drawing,
        sheets: drawing.sheets.filter((s) => s.kind !== 'simulation'),
      });
    } catch {
      // An unfinished symbol must not prevent the schematic from rendering.
      return undefined;
    }
  }, [drawing]);
  const acquisitionKey = running ? session.circuitHash : run?.id;
  const expectedHash = running ? session.circuitHash : run?.circuitHash;
  const setup = running ? session.requestSetup : selected?.simulation;
  useEffect(() => subscribeSession(() => setRevision((n) => n + 1)), []);
  useEffect(() => {
    const show = () => {
      setVisible(true);
      setForced(true);
    };
    window.addEventListener('tinycad:show-charts', show);
    return () => window.removeEventListener('tinycad:show-charts', show);
  }, []);
  useEffect(
    () =>
      setCharts((previous) =>
        reconcileCharts(previous, probes, hidden.current, !!selected),
      ),
    [probes, !!selected],
  );
  useEffect(() => {
    setRunId('latest');
    setPlotIndex(0);
  }, [selected?.id]);
  useEffect(() => {
    let valid = true;
    if (net && setup && expectedHash) {
      try {
        const captured = running
          ? setup
          : { ...setup, analysis: run.analysis, parameters: run.parameters };
        digest(
          new TextEncoder().encode(
            buildDeck(net, captured) + JSON.stringify(captured.models),
          ),
        )
          .then((hash) => {
            if (valid)
              setVerified({
                drawing,
                key: acquisitionKey,
                matches: hash === expectedHash,
              });
          })
          .catch(() => {
            if (valid)
              setVerified({ drawing, key: acquisitionKey, matches: false });
          });
      } catch {
        setVerified({ drawing, key: acquisitionKey, matches: false });
      }
    }
    return () => {
      valid = false;
    };
  }, [net, acquisitionKey, expectedHash, setup]);
  const fresh =
    !!expectedHash &&
    verified?.drawing === drawing &&
    verified.key === acquisitionKey &&
    verified.matches;
  const message = !net
    ? 'Check schematic component references and pin definitions before plotting.'
    : !selected
    ? 'Add a Simulation sheet to configure an analysis.'
    : !raw?.vectors.length
    ? running
      ? session.status
      : 'Run a simulation to see results alongside the drawing.'
    : verified?.drawing !== drawing || verified.key !== acquisitionKey
    ? 'Checking acquisition…'
    : !fresh
    ? 'The circuit has changed since this acquisition. Run again to update the charts.'
    : '';
  const execute = async () => {
    if (!selected) return;
    setError('');
    try {
      await runSimulation(
        drawing,
        selected.id,
        selected.simulation,
        (run) => {
          const current = store.getState().docStore.present.drawing;
          const target = current.sheets.find((s) => s.id === selected.id);
          if (current.documentId !== drawing.documentId || !target?.simulation)
            return;
          dispatch({
            type: 'simulation/update',
            sheetId: target.id,
            setup: {
              ...target.simulation,
              runs: [...target.simulation.runs, run],
            },
          });
          setRunId('latest');
        },
        (errors) => {
          if (
            store.getState().docStore.present.drawing.documentId ===
            drawing.documentId
          ) {
            dispatch({
              type: 'simulation/diagnostics',
              documentId: drawing.documentId,
              errors,
            });
            if (errors.length) dispatch(actionSelectPanel(Panels.DrcPanel));
          }
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const resize = useCallback(
    (delta: number) => setWidth((w) => Math.max(320, Math.min(900, w - delta))),
    [],
  );
  if (!forced && !hasSimulation(drawing)) return null;
  return (
    <aside
      aria-label="Simulation charts"
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        width: visible ? width : 40,
        maxWidth: '60vw',
        flexShrink: 0,
        minHeight: 0,
        overflow: 'hidden',
        background: tokens.colorNeutralBackground1,
        borderLeft: `1px solid ${tokens.colorNeutralStroke1}`,
      }}
    >
      {visible ? (
        <>
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 4,
              zIndex: 20,
            }}
          >
            <ResizeHandle direction="horizontal" onResize={resize} />
          </div>
          <header
            style={{
              padding: '8px 12px',
              borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
            }}
          >
            <div style={row}>
              <strong style={{ flex: 1 }}>Simulation charts</strong>
              <Button
                size="small"
                appearance="subtle"
                icon={<DismissRegular />}
                title="Hide chart panel"
                aria-label="Hide chart panel"
                onClick={() => setVisible(false)}
              />
            </div>
            <div style={{ ...row, marginTop: 8 }}>
              <Select
                size="small"
                aria-label="Simulation setup"
                value={selected?.id || ''}
                disabled={!!session}
                style={{ flex: 1, minWidth: 0 }}
                onChange={(_, d) => setSimulationId(d.value)}
              >
                {!selected && <option value="">No simulation setup</option>}
                {simulations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Button
                size="small"
                icon={<PlayRegular />}
                disabled={!selected || !!session}
                onClick={execute}
              >
                Run
              </Button>
              <Button
                size="small"
                icon={<StopRegular />}
                disabled={!session}
                onClick={stopSimulation}
              >
                Stop
              </Button>
            </div>
            {!selected && (
              <Button
                size="small"
                style={{ marginTop: 8 }}
                onClick={() =>
                  dispatch({ type: 'simulation/add', name: 'Simulation' })
                }
              >
                Add simulation setup
              </Button>
            )}
            <Field label="Acquisition" size="small" style={{ marginTop: 8 }}>
              <Select
                size="small"
                value={runId}
                disabled={running}
                onChange={(_, d) => {
                  setRunId(d.value);
                  setPlotIndex(0);
                }}
              >
                <option value="latest">
                  {running ? 'Live acquisition' : 'Latest available'}
                </option>
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {new Date(r.created).toLocaleString()} / {r.analysis.kind}
                  </option>
                ))}
              </Select>
            </Field>
            {plots.length > 1 && (
              <Select
                size="small"
                aria-label="Result plot"
                value={String(plotIndex)}
                onChange={(_, d) => setPlotIndex(Number(d.value))}
              >
                {plots.map((p, i) => (
                  <option key={i} value={i}>
                    {p.scale ? 'Spectrum / sweep' : 'Integrated / scalar'} (
                    {i + 1})
                  </option>
                ))}
              </Select>
            )}
            <div style={{ ...row, marginTop: 8 }}>
              <Select
                size="small"
                aria-label="Chart to add"
                value={addChoice}
                style={{ flex: 1, minWidth: 0 }}
                onChange={(_, d) => setAddChoice(d.value)}
              >
                <option value="custom">Custom signal chart</option>
                {probes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
              <Button
                size="small"
                icon={<AddRegular />}
                onClick={() => {
                  const probe = probes.find((p) => p.id === addChoice);
                  setCharts((current) => [
                    ...current,
                    {
                      id: crypto.randomUUID(),
                      title: probe?.title || 'Signal chart',
                      probeId: probe?.id,
                      signals: probe
                        ? []
                        : [...(selected?.simulation.signals || [])],
                    },
                  ]);
                }}
              >
                Add chart
              </Button>
            </div>
            {error && <p role="alert">{error}</p>}
          </header>
        </>
      ) : (
        <Button
          appearance="subtle"
          aria-label="Show chart panel"
          title="Show chart panel"
          style={{ writingMode: 'vertical-rl', height: 100 }}
          onClick={() => setVisible(true)}
        >
          Charts
        </Button>
      )}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: visible ? undefined : 'none',
        }}
      >
        {!charts.length && (
          <p style={{ padding: 12 }}>
            Add a chart or place a probe to see results here.
          </p>
        )}
        {charts.map((chart) => (
          <WorkspaceChartView
            key={chart.id}
            chart={chart}
            probes={probes}
            net={net}
            data={data}
            traces={selected?.simulation.traces}
            fresh={fresh}
            message={message}
            update={(next) =>
              setCharts((current) =>
                current.map((c) => (c.id === chart.id ? next : c)),
              )
            }
            remove={() => {
              hidden.current.add(chart.probeId || chart.id);
              setCharts((current) => current.filter((c) => c.id !== chart.id));
            }}
          />
        ))}
      </div>
    </aside>
  );
}
