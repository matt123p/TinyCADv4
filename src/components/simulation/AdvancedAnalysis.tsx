import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Checkbox,
  Field,
  Input,
  Select,
} from '@fluentui/react-components';
import { useDispatch, useStore } from 'react-redux';
import { docDrawing } from '../../state/undo/undo';
import { dsnDrawing, dsnSheet } from '../../model/dsnDrawing';
import { DocItemTypes } from '../../model/dsnItem';
import {
  ResultData,
  SimulationRun,
  SimulationSetup,
} from '../../simulation/contracts';
import {
  StudyDefinition,
  StudyPoint,
  StudyRecord,
  TestCase,
  studyPlan,
  studyStatistics,
} from '../../simulation/studies';
import { exploreOnce } from '../../simulation/exploration';
import { getSession } from '../../simulation/session';
import { getResult } from '../../simulation/resultStore';
import { deriveTraces } from '../../simulation/traces';
import { deviceSignal } from '../../simulation/signals';
import { symbolReference } from '../../simulation/bindings';
import { download } from '../../simulation/export';
import { MeasurementDefinition } from '../../simulation/explorerTypes';
import { Waveform } from './Waveform';
import { StudyHistogram } from './StudyHistogram';
import {
  actionSelectPanel,
  Panels,
} from '../../state/dispatcher/AppDispatcher';
import { validateSetup } from '../../simulation/document';
import { readControl } from '../../simulation/controls';

const row: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  alignItems: 'end',
  margin: '10px 0',
};
const uid = () => crypto.randomUUID();
const show = (n?: number) =>
  n === undefined ? '—' : Number(n.toPrecision(6)).toString();
const newStudy = (kind: StudyDefinition['kind']): StudyDefinition => ({
  id: uid(),
  name:
    kind === 'monteCarlo'
      ? 'Tolerance study'
      : kind === 'corners'
      ? 'Corner search'
      : 'Test suite',
  kind,
  seed: 1,
  count: 20,
  variations: [],
});
function Text({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: (v: string) => void;
}) {
  return (
    <Field
      label={label}
      size="small"
      style={{ flex: '1 1 100px', minWidth: 80 }}
    >
      <Input size="small" value={value} onChange={(_, d) => change(d.value)} />
    </Field>
  );
}
export function AdvancedAnalysis({
  drawing,
  sheet,
  data,
  run,
  fresh,
  onAcquisition,
}: {
  drawing: dsnDrawing;
  sheet: dsnSheet;
  data?: ResultData;
  run?: SimulationRun;
  fresh: boolean;
  onAcquisition?: (id: string) => void;
}) {
  const setup = sheet.simulation,
    dispatch = useDispatch(),
    store = useStore<docDrawing>();
  const [workflow, setWorkflow] = useState('frequency'),
    [study, setStudy] = useState<StudyDefinition>(
      () => setup.studies?.[0] || newStudy('monteCarlo'),
    );
  const [selectedRecord, setSelectedRecord] = useState(''),
    [metricId, setMetricId] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [input, setInput] = useState('in'),
    [output, setOutput] = useState('out'),
    [source, setSource] = useState(() => {
      for (const s of drawing.sheets)
        for (const item of s.items) {
          if (item.NodeName !== DocItemTypes.Symbol) continue;
          const c = readControl(item);
          if (c?.kind === 'instrument' && c.type === 'generator')
            return `V_${symbolReference(item)}`;
          if (c?.kind === 'source') return symbolReference(item);
        }
      return 'V1';
    }),
    [start, setStart] = useState('10Hz'),
    [stop, setStop] = useState('100kHz'),
    [frequency, setFrequency] = useState('1kHz'),
    [response, setResponse] = useState('lowpass');
  const [caseName, setCaseName] = useState('Test case'),
    [binding, setBinding] = useState(''),
    [component, setComponent] = useState(''),
    [boundary, setBoundary] = useState(''),
    [rating, setRating] = useState('power'),
    [limit, setLimit] = useState('.25W');
  const controller = useRef<AbortController>(),
    alive = useRef(true),
    itemsRef = useRef(
      drawing.sheets.filter((s) => s.kind !== 'simulation').map((s) => s.items),
    );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    const items = drawing.sheets
      .filter((s) => s.kind !== 'simulation')
      .map((s) => s.items);
    if (
      items.length !== itemsRef.current.length ||
      items.some((v, i) => v !== itemsRef.current[i])
    )
      controller.current?.abort();
    itemsRef.current = items;
  }, [drawing]);
  const update = (patch: Partial<SimulationSetup>) => {
    try {
      const next = validateSetup({ ...setup, ...patch });
      dispatch({ type: 'simulation/update', sheetId: sheet.id, setup: next });
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  };
  const liveTarget = () => {
    const doc = store.getState().docStore.present.drawing;
    return doc.documentId === drawing.documentId
      ? doc.sheets.find((s) => s.id === sheet.id)
      : undefined;
  };
  const commit = (completed: SimulationRun) => {
    const target = liveTarget();
    if (target?.simulation)
      dispatch({
        type: 'simulation/update',
        sheetId: sheet.id,
        setup: {
          ...target.simulation,
          runs: [...target.simulation.runs, completed],
        },
      });
  };
  const persist = (record: StudyRecord) => {
    const target = liveTarget();
    if (target?.simulation)
      dispatch({
        type: 'simulation/update',
        sheetId: sheet.id,
        setup: {
          ...target.simulation,
          studyRuns: [
            ...(target.simulation.studyRuns || [])
              .filter((r) => r.id !== record.id)
              .slice(-99),
            record,
          ],
        },
      });
  };
  const report = (errors: any[]) => {
    dispatch({
      type: 'simulation/diagnostics',
      documentId: drawing.documentId,
      errors,
    });
    if (errors.length) dispatch(actionSelectPanel(Panels.DrcPanel));
  };
  const execute = async (next: SimulationSetup) => {
    controller.current?.abort();
    const token = new AbortController();
    controller.current = token;
    setBusy(true);
    setError('');
    try {
      const completed = await exploreOnce(
        drawing,
        sheet.id,
        next,
        {},
        commit,
        token.signal,
        report,
      );
      if (alive.current) onAcquisition?.(completed.id);
      if (completed.state !== 'complete')
        throw new Error(completed.error || completed.state);
    } catch (e) {
      if (alive.current && !token.signal.aborted) setError(String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const runStudy = async () => {
    setError('');
    let plan: ReturnType<typeof studyPlan>;
    try {
      plan = studyPlan(study, drawing, setup);
    } catch (e) {
      setError(String(e));
      return;
    }
    if (
      !update({
        studies: [
          ...(setup.studies || []).filter((s) => s.id !== study.id).slice(-99),
          structuredClone(study),
        ],
      })
    )
      return;
    controller.current?.abort();
    const token = new AbortController();
    controller.current = token;
    setBusy(true);
    let record: StudyRecord = {
      id: uid(),
      created: new Date().toISOString(),
      definition: structuredClone(study),
      bindings: structuredClone(setup.bindings || []),
      tests: structuredClone(setup.testCases || []),
      state: 'running',
      points: [],
    };
    setSelectedRecord(record.id);
    persist(record);
    try {
      for (const point of plan) {
        if (token.signal.aborted) break;
        const test =
          point.testId && record.tests.find((t) => t.id === point.testId);
        const configured = {
          ...setup,
          ...(test
            ? {
                analysis: test.analysis,
                parameters: test.parameters,
                measurements: test.measurements,
                requirements: test.requirements,
                traces: test.traces,
                bindings: test.bindings,
              }
            : {}),
          runs: liveTarget()?.simulation.runs || [],
        };
        let result: StudyPoint;
        try {
          if (point.error) throw new Error(point.error);
          const completed = await exploreOnce(
            drawing,
            sheet.id,
            configured,
            point.overrides,
            commit,
            token.signal,
            report,
          );
          result = {
            ...point,
            runId: completed.id,
            state: completed.state,
            error: completed.error,
          };
          if (alive.current) onAcquisition?.(completed.id);
        } catch (e) {
          result = {
            ...point,
            state: token.signal.aborted ? 'stopped' : 'failed',
            error: String(e),
          };
        }
        record = { ...record, points: [...record.points, result] };
        persist(record);
        if (token.signal.aborted || result.state === 'stopped') break;
      }
      record = {
        ...record,
        state:
          token.signal.aborted ||
          record.points.some((p) => p.state === 'stopped')
            ? 'stopped'
            : record.points.some((p) => p.state !== 'complete')
            ? 'failed'
            : 'complete',
      };
    } catch (e) {
      record = {
        ...record,
        state: token.signal.aborted ? 'stopped' : 'failed',
      };
      if (alive.current) setError(String(e));
    } finally {
      persist(record);
      if (alive.current) setBusy(false);
    }
  };
  const components = drawing.sheets
    .filter((s) => s.kind !== 'simulation')
    .flatMap((s) =>
      s.items
        .filter((i) => i.NodeName === DocItemTypes.Symbol)
        .map((symbol) => ({
          key: JSON.stringify([s.id || s.name, symbolReference(symbol)]),
          sheet: s.id || s.name,
          reference: symbolReference(symbol),
          name: `${symbolReference(symbol)} — ${s.name}`,
        })),
    );
  const chosenComponent =
      components.find((c) => c.key === component) || components[0],
    chosenBoundary =
      components.find((c) => c.key === boundary) || components[0];
  const select = (
    label: string,
    value: string,
    options: { value: string; label: string }[],
    change: (v: string) => void,
  ) => (
    <Field label={label} size="small">
      <Select size="small" value={value} onChange={(_, d) => change(d.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  );
  const configureFrequency = (tf = false) => {
    const definitions: MeasurementDefinition[] = tf
      ? [
          {
            id: 'guided_gain',
            name: 'Small-signal gain',
            kind: 'value',
            source: 'Transfer_function',
          },
          {
            id: 'guided_rin',
            name: 'Input resistance',
            kind: 'value',
            source: 'Input_impedance',
          },
          {
            id: 'guided_rout',
            name: 'Output resistance',
            kind: 'value',
            source: 'output_impedance',
          },
        ]
      : [
          {
            id: 'guided_gain',
            name: 'Gain at frequency',
            kind: 'gain',
            source: output,
            reference: input,
            at: frequency,
          },
          {
            id: 'guided_phase',
            name: 'Phase at frequency',
            kind: 'phase',
            source: output,
            reference: input,
            at: frequency,
          },
          {
            id: 'guided_corner',
            name: response === 'bandpass' ? 'Half-power bandwidth' : 'Cutoff',
            kind: response === 'bandpass' ? 'bandwidth' : 'cutoff',
            source: output,
            reference: input,
            referenceGain: response === 'bandpass' ? 'peak' : '1',
          },
          {
            id: 'guided_delay',
            name: 'Group delay',
            kind: 'groupDelay',
            source: output,
            reference: input,
            at: frequency,
          },
          ...(response === 'bandpass'
            ? [
                {
                  id: 'guided_resonance',
                  name: 'Resonance',
                  kind: 'resonance' as const,
                  source: output,
                  reference: input,
                },
                {
                  id: 'guided_q',
                  name: 'Band-pass Q (f0/BW)',
                  kind: 'bandpassQ' as const,
                  source: output,
                  reference: input,
                },
              ]
            : []),
        ];
    const next = {
      ...setup,
      analysis: {
        ...setup.analysis,
        kind: tf ? ('tf' as const) : ('ac' as const),
        input: source,
        output,
        reference: '0',
        startFrequency: start,
        stopFrequency: stop,
      },
      measurements: [
        ...(setup.measurements || []).filter(
          (m) => !m.id.startsWith('guided_'),
        ),
        ...definitions,
      ],
      traces: tf
        ? setup.traces
        : [
            ...(setup.traces || []).filter((t) => t.name !== 'Lab gain'),
            {
              name: 'Lab gain',
              operation: 'divide' as const,
              left: output,
              right: input,
            },
          ],
      signals: tf ? ['Transfer_function'] : ['Lab gain'],
    };
    if (update(next)) void execute(next);
  };
  const records = setup.studyRuns || [],
    record = records.find((r) => r.id === selectedRecord) || records.at(-1),
    firstRun = setup.runs.find(
      (r) => r.id === record?.points.find((p) => p.runId)?.runId,
    ),
    definitions = firstRun?.explorer?.definitions || setup.measurements || [],
    selectedMetric =
      definitions.find((m) => m.id === metricId) || definitions[0];
  const stats = record
    ? studyStatistics(record, setup.runs, selectedMetric?.id || '')
    : undefined;
  const curves =
    record?.points.flatMap((p) => {
      const r = setup.runs.find((r) => r.id === p.runId),
        data = r?.dataState === 'available' && getResult(r.id);
      return r?.state === 'complete' && data
        ? [
            {
              label: p.label,
              data: deriveTraces(data, r.explorer?.traces || []).data,
            },
          ]
        : [];
    }) || [];
  return (
    <div>
      {select(
        'Workflow',
        workflow,
        [
          { value: 'frequency', label: 'Frequency / amplifier response' },
          { value: 'variation', label: 'Tolerance / Monte Carlo / corners' },
          { value: 'tests', label: 'Test cases and conditions' },
          { value: 'power', label: 'Power / efficiency / stress' },
        ],
        (value) => {
          setWorkflow(value);
          if (value === 'tests') setStudy(newStudy('tests'));
        },
      )}
      {workflow === 'frequency' && (
        <>
          <div style={row}>
            <Text
              label="Input voltage signal"
              value={input}
              change={setInput}
            />
            <Text
              label="Output voltage signal"
              value={output}
              change={setOutput}
            />
          </div>
          <div style={row}>
            <Text label="Start frequency" value={start} change={setStart} />
            <Text label="Stop frequency" value={stop} change={setStop} />
            <Text
              label="Readout frequency"
              value={frequency}
              change={setFrequency}
            />
          </div>
          {select(
            'Response assumption',
            response,
            ['lowpass', 'highpass', 'bandpass'].map((value) => ({
              value,
              label: value,
            })),
            setResponse,
          )}
          <p>
            AC is a small-signal linearisation. Cutoff uses unity reference
            gain; edit the named metric for another reference. Q is provided
            only for the explicitly chosen band-pass definition.
          </p>
          <Button
            size="small"
            disabled={busy || !!getSession()}
            onClick={() => configureFrequency()}
          >
            Configure and run AC
          </Button>
          <Text
            label="Independent input source for .tf"
            value={source}
            change={setSource}
          />
          <Button
            size="small"
            disabled={busy || !!getSession()}
            onClick={() => configureFrequency(true)}
          >
            Run amplifier gain / input / output resistance
          </Button>
          <p>
            Port impedance needs a dedicated stimulus and current into the port.
            Add an impedance metric using port voltage and a series current
            probe. Arbitrary net ratios do not establish input impedance or
            stability margins.
          </p>
          {fresh &&
            data?.scale === 'frequency' &&
            (() => {
              const gain = deriveTraces(data, [
                {
                  name: 'Lab gain',
                  operation: 'divide',
                  left: output,
                  right: input,
                },
              ]).data;
              return (
                <>
                  <Waveform
                    compact
                    data={gain}
                    signals={['Lab gain']}
                    initialMode="db"
                  />
                  <Waveform
                    compact
                    data={gain}
                    signals={['Lab gain']}
                    initialMode="phase"
                  />
                </>
              );
            })()}
          {run?.explorer?.measurements
            .filter((m) => m.id.startsWith('guided_'))
            .map((m) => (
              <div key={m.id}>
                {run.explorer.definitions.find((d) => d.id === m.id)?.name}:{' '}
                {m.state === 'valid'
                  ? `${show(m.value)} ${m.unit}`
                  : m.explanation}
              </div>
            ))}
        </>
      )}
      {workflow === 'variation' && (
        <>
          {select(
            'Study kind',
            study.kind,
            [
              { value: 'monteCarlo', label: 'Seeded Monte Carlo' },
              { value: 'corners', label: 'Bounded corner search' },
            ],
            (kind) => setStudy({ ...study, kind: kind as any }),
          )}
          <div style={row}>
            <Text
              label="Study name"
              value={study.name}
              change={(name) => setStudy({ ...study, name })}
            />
            <Field label="Seed" size="small">
              <Input
                type="number"
                value={String(study.seed)}
                onChange={(_, d) => {
                  const seed = Number(d.value);
                  if (Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff)
                    setStudy({ ...study, seed });
                }}
              />
            </Field>
            <Field label="Samples (2–100)" size="small">
              <Input
                type="number"
                value={String(study.count)}
                onChange={(_, d) => {
                  const count = Number(d.value);
                  if (Number.isInteger(count) && count >= 2 && count <= 100)
                    setStudy({ ...study, count });
                }}
              />
            </Field>
          </div>
          {study.variations.map((v, i) => (
            <div
              key={i}
              style={{ borderBottom: '1px solid #ccc', padding: '8px 0' }}
            >
              <b>
                {setup.bindings?.find((b) => b.id === v.binding)?.name ||
                  'Missing binding'}
              </b>
              <div style={row}>
                <Text
                  label={
                    v.distribution === 'normal'
                      ? 'Standard deviation (%)'
                      : '± tolerance (%)'
                  }
                  value={v.percent}
                  change={(percent) =>
                    setStudy({
                      ...study,
                      variations: study.variations.map((a, j) =>
                        j === i ? { ...a, percent } : a,
                      ),
                    })
                  }
                />
                {select(
                  'Distribution',
                  v.distribution,
                  ['uniform', 'normal'].map((value) => ({
                    value,
                    label: value,
                  })),
                  (distribution) =>
                    setStudy({
                      ...study,
                      variations: study.variations.map((a, j) =>
                        j === i
                          ? { ...a, distribution: distribution as any }
                          : a,
                      ),
                    }),
                )}
                <Text
                  label="Correlated group (blank = independent)"
                  value={v.group}
                  change={(group) =>
                    setStudy({
                      ...study,
                      variations: study.variations.map((a, j) =>
                        j === i ? { ...a, group } : a,
                      ),
                    })
                  }
                />
                <Button
                  size="small"
                  onClick={() =>
                    setStudy({
                      ...study,
                      variations: study.variations.filter((_, j) => j !== i),
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
          <div style={row}>
            {select(
              'Parameter binding',
              binding || setup.bindings?.[0]?.id || '',
              (setup.bindings || []).map((b) => ({
                value: b.id,
                label: b.name,
              })),
              setBinding,
            )}
            <Button
              size="small"
              disabled={!setup.bindings?.length}
              onClick={() => {
                const id = binding || setup.bindings[0].id;
                if (!study.variations.some((v) => v.binding === id))
                  setStudy({
                    ...study,
                    variations: [
                      ...study.variations,
                      {
                        binding: id,
                        percent: '5',
                        distribution: 'uniform',
                        group: '',
                      },
                    ],
                  });
              }}
            >
              Add variation
            </Button>
          </div>
          <p>
            Create parameter bindings in Tune / sweep. Uniform means bounded ±
            tolerance; normal means unbounded standard deviation. A named group
            shares the same standardised random draw (full positive
            correlation). Corner search uses independent ± bounds and reports
            worst observed, not a proven global worst case.
          </p>
        </>
      )}
      {workflow === 'tests' && (
        <>
          <div style={row}>
            <Text
              label="New test case name"
              value={caseName}
              change={setCaseName}
            />
            <Button
              size="small"
              disabled={(setup.testCases?.length || 0) >= 100}
              onClick={() =>
                update({
                  testCases: [
                    ...(setup.testCases || []),
                    {
                      id: uid(),
                      name: caseName,
                      analysis: structuredClone(setup.analysis),
                      parameters: { ...setup.parameters },
                      overrides: {},
                      bindings: structuredClone(setup.bindings || []),
                      measurements: structuredClone(setup.measurements || []),
                      requirements: structuredClone(setup.requirements || []),
                      traces: structuredClone(setup.traces || []),
                    },
                  ],
                })
              }
            >
              Capture current setup
            </Button>
          </div>
          {(setup.testCases || []).map((test) => {
            const edit = (patch: Partial<TestCase>) =>
              update({
                testCases: setup.testCases.map((t) =>
                  t.id === test.id ? { ...t, ...patch } : t,
                ),
              });
            return (
              <details key={test.id}>
                <summary>
                  {test.name} · {test.analysis.kind} ·{' '}
                  {test.analysis.temperature} °C
                </summary>
                <Text
                  label="Name"
                  value={test.name}
                  change={(name) => edit({ name })}
                />
                <Text
                  label="Temperature (°C)"
                  value={test.analysis.temperature}
                  change={(temperature) =>
                    edit({ analysis: { ...test.analysis, temperature } })
                  }
                />
                {Object.entries(test.parameters).map(([name, value]) => (
                  <Text
                    key={name}
                    label={`Parameter ${name}`}
                    value={value}
                    change={(value) =>
                      edit({
                        parameters: { ...test.parameters, [name]: value },
                      })
                    }
                  />
                ))}
                {(test.bindings || []).map((b) => (
                  <Text
                    key={b.id}
                    label={`${b.name} override (blank = document)`}
                    value={test.overrides[b.id] || ''}
                    change={(value) => {
                      const overrides = { ...test.overrides };
                      if (value) overrides[b.id] = value;
                      else delete overrides[b.id];
                      edit({ overrides });
                    }}
                  />
                ))}
                <p>
                  {test.measurements.length} captured metrics ·{' '}
                  {test.requirements.length} requirements. Configure another
                  analysis on the Simulation sheet before capturing another
                  case.
                </p>
                <Button
                  size="small"
                  onClick={() =>
                    update({
                      testCases: setup.testCases.filter(
                        (t) => t.id !== test.id,
                      ),
                    })
                  }
                >
                  Remove test case
                </Button>
              </details>
            );
          })}
          <p>
            Run all captured cases with their own conditions and metric
            definitions. Models and schematic come from the current drawing;
            each run records its exact input hash. Reports include prior study
            history for comparison.
          </p>
        </>
      )}
      {workflow === 'power' && (
        <>
          <div style={row}>
            {select(
              'Rated component / useful load',
              chosenComponent?.key || '',
              components.map((c) => ({ value: c.key, label: c.name })),
              setComponent,
            )}
            {select(
              'Rating',
              rating,
              ['power', 'voltage', 'current'].map((value) => ({
                value,
                label: value,
              })),
              setRating,
            )}
            <Text
              label="Absolute peak limit (with units)"
              value={limit}
              change={setLimit}
            />
          </div>
          <Button
            size="small"
            disabled={!chosenComponent}
            onClick={() => {
              const id = `stress_${uid()}`,
                unit =
                  rating === 'power' ? 'W' : rating === 'current' ? 'A' : 'V';
              update({
                measurements: [
                  ...(setup.measurements || []),
                  {
                    id,
                    name: `${chosenComponent.reference} peak ${rating}`,
                    kind: 'absolutePeak',
                    source: deviceSignal(
                      chosenComponent.sheet,
                      chosenComponent.reference,
                      rating,
                    ),
                  },
                ],
                requirements: [
                  ...(setup.requirements || []),
                  {
                    id: `rating_${id}`,
                    name: `${chosenComponent.reference} ${rating} rating`,
                    measurement: id,
                    comparison: 'atMost',
                    lower: '0',
                    upper: limit,
                    unit,
                  },
                ],
              });
            }}
          >
            Add stress measurement / limit
          </Button>
          <div style={row}>
            {select(
              'Supplying input power boundary',
              chosenBoundary?.key || '',
              components.map((c) => ({ value: c.key, label: c.name })),
              setBoundary,
            )}
            <Button
              size="small"
              disabled={!chosenComponent || !chosenBoundary}
              onClick={() =>
                update({
                  measurements: [
                    ...(setup.measurements || []),
                    ...(['efficiency', 'loss'] as const).map((kind) => ({
                      id: `power_${uid()}`,
                      name: `${kind}: ${chosenBoundary.reference} → ${chosenComponent.reference}`,
                      kind,
                      source: deviceSignal(
                        chosenComponent.sheet,
                        chosenComponent.reference,
                        'power',
                      ),
                      reference: deviceSignal(
                        chosenBoundary.sheet,
                        chosenBoundary.reference,
                        'power',
                      ),
                    })),
                  ],
                })
              }
            >
              Add efficiency / loss
            </Button>
          </div>
          <p>
            Use explicit signed power boundaries: the input supplies power
            (negative consumed W); the useful load consumes it. Mean powers are
            time weighted. Limits are user supplied and do not prove thermal or
            pulse-rating compliance. Missing device current vectors produce
            unavailable readings. Use named Mean/RMS/Integral metrics for
            average power, current RMS or energy.
          </p>
          <Button
            size="small"
            disabled={busy || !!getSession()}
            onClick={() => execute(setup)}
          >
            Run current analysis
          </Button>
        </>
      )}
      {['variation', 'tests'].includes(workflow) && (
        <>
          <div style={row}>
            {select(
              'Saved study',
              study.id,
              (setup.studies || []).map((s) => ({
                value: s.id,
                label: s.name,
              })),
              (id) => {
                const s = setup.studies.find((s) => s.id === id);
                if (s) setStudy(structuredClone(s));
              },
            )}
            <Button
              size="small"
              disabled={busy || !!getSession()}
              onClick={runStudy}
            >
              Run study
            </Button>
            <Button
              size="small"
              onClick={() =>
                update({
                  studies: [
                    ...(setup.studies || [])
                      .filter((s) => s.id !== study.id)
                      .slice(-99),
                    structuredClone(study),
                  ],
                })
              }
            >
              Save study
            </Button>
          </div>
          {select(
            'Study acquisition',
            record?.id || '',
            records.map((r) => ({
              value: r.id,
              label: `${r.created} · ${r.definition.name} · ${
                r.state === 'running' && !busy ? 'interrupted' : r.state
              }`,
            })),
            setSelectedRecord,
          )}
          {record && (
            <>
              <p>
                {record.state} · {record.points.length} recorded cases · seed{' '}
                {record.definition.seed}
              </p>
              {select(
                'Summary metric',
                selectedMetric?.id || '',
                definitions.map((d) => ({ value: d.id, label: d.name })),
                setMetricId,
              )}
              <p>
                Observed range: {show(stats.minimum)} to {show(stats.maximum)} ·
                mean {show(stats.mean)} · sample σ{' '}
                {show(stats.standardDeviation)}
              </p>
              <p>
                {stats.passed} pass · {stats.failed} fail · {stats.unavailable}{' '}
                unavailable/solver failures.{' '}
                {record.state === 'complete' && stats.yield !== undefined
                  ? `Illustrative yield: ${show(
                      100 * stats.yield,
                    )}% of all cases.`
                  : 'No yield estimate: incomplete study or no evaluable requirements.'}{' '}
                Distribution/model assumptions apply; this is not manufacturing
                assurance.
              </p>
              {stats.values.length > 0 && (
                <StudyHistogram
                  values={stats.values}
                  unit={
                    firstRun?.explorer?.measurements.find(
                      (m) => m.id === selectedMetric?.id,
                    )?.unit || ''
                  }
                />
              )}
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Case</th>
                      <th>Result</th>
                      <th>Metric</th>
                      <th>Values / error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.points.map((p, i) => {
                      const r = setup.runs.find((r) => r.id === p.runId),
                        m = r?.explorer?.measurements.find(
                          (m) => m.id === selectedMetric?.id,
                        );
                      return (
                        <tr key={i}>
                          <td>
                            <Button
                              size="small"
                              appearance="transparent"
                              disabled={!p.runId}
                              onClick={() => onAcquisition?.(p.runId)}
                            >
                              {p.label}
                            </Button>
                          </td>
                          <td>{p.state}</td>
                          <td>
                            {m?.state === 'valid'
                              ? `${show(m.value)} ${m.unit}`
                              : m?.explanation || 'unavailable'}
                          </td>
                          <td>
                            {p.error ||
                              Object.entries(p.overrides)
                                .map(
                                  ([id, v]) =>
                                    `${
                                      record.bindings.find((b) => b.id === id)
                                        ?.name || id
                                    }=${v}`,
                                )
                                .join(', ')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {curves.length > 0 && (
                <Waveform
                  compact
                  data={curves[0].data}
                  signals={setup.signals}
                  overlays={curves.slice(1)}
                />
              )}
              <Button
                size="small"
                onClick={() =>
                  download(
                    'circuit-study.json',
                    JSON.stringify(
                      {
                        schema: 1,
                        documentId: drawing.documentId,
                        record,
                        statistics: stats,
                        runs: setup.runs.filter((r) =>
                          record.points.some((p) => p.runId === r.id),
                        ),
                        history: setup.studyRuns,
                      },
                      null,
                      2,
                    ),
                    'application/json',
                  )
                }
              >
                Export study / test report
              </Button>
            </>
          )}
        </>
      )}
      {busy && (
        <Button size="small" onClick={() => controller.current?.abort()}>
          Cancel acquisition
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
