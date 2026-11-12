import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Button,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItemCheckbox,
  Field,
  Select,
  tokens,
} from '@fluentui/react-components';
import {
  AddRegular,
  DismissRegular,
  OpenRegular,
  PlayRegular,
  StopRegular,
  DataLineRegular,
} from '@fluentui/react-icons';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { docDrawing } from '../../state/undo/undo';
import {
  drawingProbes,
  reconcileCharts,
  suggestedCharts,
  chartSignalLabel,
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
import { Waveform, WaveformPreferences } from './Waveform';
import { MeasurementResults } from './MeasurementResults';
import { ChartPopup, ChartPopupPortal, openChartPopup } from './ChartPopup';
import { ResizeHandle } from '../panel/ResizeHandle';
import { applyBindings } from '../../simulation/bindings';
import { setOperatingPoint } from '../../simulation/operatingPoint';
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
  baseline,
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
  baseline?: ResultData;
  traces: SimulationSetup['traces'];
  fresh: boolean;
  message: string;
  update: (chart: WorkspaceChart) => void;
  remove: () => void;
}) {
  const [popup, setPopup] = useState<ChartPopup>();
  const [error, setError] = useState('');
  const [preferences, setPreferences] = useState<Partial<WaveformPreferences>>(
    {},
  );
  const viewport = useRef<{ min: number; max: number }>();
  const activePopup = useRef<ChartPopup>();
  activePopup.current = popup;
  useEffect(
    () => () => {
      activePopup.current?.child.close();
    },
    [],
  );
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
  const choices = [
    ...available,
    ...chart.signals
      .filter((name) => !available.some((v) => v.name === name))
      .map((name) => ({ name, unit: 'unavailable' })),
  ];
  const baselineResult = useMemo(
    () => workspaceChartData(chart, probes, net, baseline, traces, fresh),
    [chart, probes, net, baseline, traces, fresh],
  );
  const signalLabels = useMemo(
    () =>
      Object.fromEntries(
        choices.map((v) => [
          v.name,
          chartSignalLabel(v.name, v.unit, probes, net),
        ]),
      ),
    [result, chart.signals, probes, net],
  );
  const content = (
    <section
      aria-label="Chart"
      style={{
        padding: 12,
        borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
        ...(popup
          ? ({
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              minHeight: 0,
              boxSizing: 'border-box',
            } as React.CSSProperties)
          : {}),
      }}
    >
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <Menu
          checkedValues={{ signals: chart.signals }}
          onCheckedValueChange={(_, d) =>
            update({ ...chart, signals: d.checkedItems })
          }
        >
          <MenuTrigger disableButtonEnhancement>
            <Button
              size="small"
              appearance="subtle"
              icon={<DataLineRegular />}
              aria-label="Signals"
            >
              Signals
            </Button>
          </MenuTrigger>
          <MenuPopover
            style={{ minWidth: 260, maxWidth: 'calc(100vw - 48px)' }}
          >
            <MenuList
              aria-label="Chart signals"
              style={{ maxHeight: 300, overflowY: 'auto', overflowX: 'hidden' }}
            >
              {choices.map((v) => (
                <MenuItemCheckbox
                  key={v.name}
                  name="signals"
                  value={v.name}
                  persistOnClick
                >
                  {signalLabels[v.name]} ({v.unit})
                </MenuItemCheckbox>
              ))}
              {!available.length && <p>Run a simulation to choose signals.</p>}
            </MenuList>
          </MenuPopover>
        </Menu>
        <div style={row}>
          {popup ? (
            <Button size="small" onClick={returnToPanel}>
              Return to panel
            </Button>
          ) : (
            process.env.TARGET_SYSTEM === 'electron' && (
              <Button
                size="small"
                appearance="subtle"
                icon={<OpenRegular />}
                aria-label="Open chart in a new window"
                title="Open chart in a new window"
                onClick={() => {
                  const opened = openChartPopup('Simulation chart');
                  if (!opened)
                    setError('The chart window could not be opened.');
                  else {
                    setError('');
                    setPopup(opened);
                  }
                }}
              />
            )
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
      </div>
      {error && <p role="alert">{error}</p>}
      {result && available.length ? (
        <>
          <Waveform
            data={result}
            signalLabels={signalLabels}
            signals={chart.signals}
            emptyMeansAll={false}
            baseline={baselineResult}
            preferences={preferences}
            onPreferencesChange={setPreferences}
            viewportRef={viewport}
            compact
            fillHeight={!!popup}
          />
          {!chart.signals.length && (
            <p>Choose signals to display on this chart.</p>
          )}
          {!result.scale &&
            available
              .filter((v) => chart.signals.includes(v.name))
              .map((v) => (
                <div key={v.name}>
                  {signalLabels[v.name]}: {v.real[0]?.toPrecision(7)} {v.unit}
                </div>
              ))}
        </>
      ) : (
        <p role="status">
          {message || 'No matching signals in this acquisition.'}
        </p>
      )}
    </section>
  );
  return popup ? (
    <ChartPopupPortal popup={popup} onClose={returnToPanel}>
      {content}
    </ChartPopupPortal>
  ) : (
    content
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
  const visible = useSelector(
    (state: docDrawing) => state.altStore?.simulationPanelVisible ?? true,
  );
  const activated = useSelector(
    (state: docDrawing) => state.altStore?.simulationPanelActivated ?? false,
  );
  const setVisible = (visible: boolean) =>
    dispatch({ type: 'simulation/panel', visible });
  const [width, setWidth] = useState(430);
  const [charts, setCharts] = useState<WorkspaceChart[]>([]);
  const hidden = useRef(new Set<string>());
  const [revision, setRevision] = useState(0);
  const [simulationId, setSimulationId] = useState(''),
    [runId, setRunId] = useState('latest');
  const [plotIndex, setPlotIndex] = useState(0);
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
  const baselineRun = runs.find(
    (r) =>
      r.pinned &&
      r.id !== run?.id &&
      r.analysis.kind === run?.analysis.kind &&
      r.circuitHash === run?.circuitHash,
  );
  const baselineRaw = baselineRun ? getResult(baselineRun.id) : undefined;
  const baseline = useMemo(
    () =>
      baselineRaw
        ? {
            ...(plotIndex
              ? baselineRaw.plots?.[plotIndex - 1] || baselineRaw
              : baselineRaw),
            log: baselineRaw.log,
          }
        : undefined,
    [baselineRaw, plotIndex],
  );
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
    };
    window.addEventListener('tinycad:show-charts', show);
    return () => window.removeEventListener('tinycad:show-charts', show);
  }, []);
  useEffect(() => {
    setRunId('latest');
    setPlotIndex(0);
  }, [selected?.id, runs.at(-1)?.id]);
  useEffect(() => {
    if (session?.sheetId) {
      setSimulationId(session.sheetId);
      setRunId('latest');
      setPlotIndex(0);
    }
  }, [session?.sheetId]);
  useEffect(() => {
    let valid = true;
    if (net && setup && expectedHash) {
      try {
        let captured = running
          ? setup
          : {
              ...setup,
              analysis: run.analysis,
              parameters: run.parameters,
              measurements: run.explorer?.definitions || setup.measurements,
            };
        let capturedNet = net;
        if (
          !running &&
          run.explorer &&
          Object.keys(run.explorer.overrides).length
        ) {
          const changed = applyBindings(
            drawing,
            { ...captured, bindings: run.explorer.bindings },
            run.explorer.overrides,
          );
          captured = { ...changed.setup, parameters: run.parameters };
          capturedNet = new NetlistWorkerState().init({
            ...changed.drawing,
            sheets: changed.drawing.sheets.filter(
              (s) => s.kind !== 'simulation',
            ),
          });
        }
        digest(
          new TextEncoder().encode(
            buildDeck(capturedNet, captured) + JSON.stringify(captured.models),
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
  const suggestedData = useMemo(
    () =>
      workspaceChartData(
        { id: 'suggestions', signals: [] },
        probes,
        net,
        data,
        selected?.simulation.traces,
        fresh,
      ),
    [probes, net, data, selected?.simulation.traces, fresh],
  );
  const suggestions = useMemo(
    () => suggestedCharts(probes, suggestedData, selected?.simulation.signals),
    [probes, suggestedData, selected?.simulation.signals],
  );
  useEffect(
    () =>
      setCharts((previous) =>
        reconcileCharts(
          previous,
          probes,
          hidden.current,
          !!selected,
          suggestedData,
          selected?.simulation.signals,
        ),
      ),
    [probes, !!selected, suggestedData, selected?.simulation.signals],
  );
  useEffect(() => {
    setOperatingPoint(
      net && data && run
        ? {
            drawing,
            net,
            data,
            run,
            fresh:
              fresh &&
              !running &&
              !Object.keys(run.explorer?.overrides || {}).length &&
              !run.resistanceTest,
          }
        : undefined,
    );
    return () => setOperatingPoint(undefined);
  }, [drawing, net, data, run, fresh, running]);
  const message = !net
    ? 'Check schematic component references and pin definitions before plotting.'
    : !selected
    ? 'Add a Simulation sheet to configure an analysis.'
    : !raw?.vectors.length
    ? running
      ? session.status
      : 'Run a simulation to see results'
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
  if (
    !activated &&
    drawing.representation !== 'zip-v1' &&
    !hasSimulation(drawing)
  )
    return null;
  return (
    <aside
      aria-label="Simulation charts"
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        width: visible ? width : 40,
        maxWidth: '60vw',
        minWidth: visible ? 0 : 40,
        flexShrink: visible ? 1 : 0,
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
              <Button
                size="small"
                icon={<AddRegular />}
                onClick={() => {
                  setCharts((current) => {
                    const suggested =
                      suggestions.find((c) =>
                        c.signals.some(
                          (s) =>
                            !current.some((existing) =>
                              existing.signals.includes(s),
                            ),
                        ),
                      ) || suggestions[0];
                    return [
                      ...current,
                      {
                        id: crypto.randomUUID(),
                        signals: suggested ? [...suggested.signals] : [],
                        awaitingSignals: !suggested,
                      },
                    ];
                  });
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
        <MeasurementResults
          drawing={drawing}
          net={net}
          data={data}
          setup={selected?.simulation}
          run={run}
          fresh={fresh}
          running={running}
          checking={
            !!expectedHash &&
            (verified?.drawing !== drawing || verified.key !== acquisitionKey)
          }
        />
        {!charts.length && (
          <p style={{ padding: 12 }}>Add a chart, then choose its signals.</p>
        )}
        {charts.map((chart) => (
          <WorkspaceChartView
            key={chart.id}
            chart={chart}
            probes={probes}
            net={net}
            data={data}
            baseline={baseline}
            traces={selected?.simulation.traces}
            fresh={fresh}
            message={message}
            update={(next) =>
              setCharts((current) =>
                current.map((c) =>
                  c.id === chart.id
                    ? { ...next, awaitingSignals: undefined }
                    : c,
                ),
              )
            }
            remove={() => {
              hidden.current.add('outputs');
              setCharts((current) => current.filter((c) => c.id !== chart.id));
            }}
          />
        ))}
      </div>
    </aside>
  );
}
