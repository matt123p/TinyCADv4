import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Checkbox,
  Field,
  Input,
  Select,
  Tab,
  TabList,
  tokens,
} from '@fluentui/react-components';
import { useDispatch, useStore, useSelector } from 'react-redux';
import { docDrawing } from '../../state/undo/undo';
import { dsnDrawing, dsnSheet } from '../../model/dsnDrawing';
import { DocItemTypes } from '../../model/dsnItem';
import { NetlistData } from '../../io/netlists/netlistGenerator';
import { ResultData, SimulationRun } from '../../simulation/contracts';
import {
  MeasurementDefinition,
  ParameterBinding,
  RequirementDefinition,
  SweepRun,
  metricKinds,
} from '../../simulation/explorerTypes';
import { measure, checkRequirement } from '../../simulation/metrics';
import {
  bindingValue,
  applyBindings,
  sourceFields,
  preferredValue,
  sweepValues,
  symbolReference,
} from '../../simulation/bindings';
import { parseQuantity } from '../../simulation/numbers';
import {
  resolvedSignals,
  deviceSignal,
  measurementLocation,
} from '../../simulation/signals';
import { deriveTraces } from '../../simulation/traces';
import { readControl, SourceConfig } from '../../simulation/controls';
import { getResult } from '../../simulation/resultStore';
import {
  exploreOnce,
  ExplorationPoint,
  runSweep,
  restoredSweep,
} from '../../simulation/exploration';
import { getSession } from '../../simulation/session';
import { download } from '../../simulation/export';
import { Waveform } from './Waveform';
import { setOverlayMode, overlayMode } from '../../simulation/operatingPoint';
import {
  actionFindSelection,
  actionSelectPanel,
  Panels,
} from '../../state/dispatcher/AppDispatcher';
import { DrcError } from '../../model/dsnDrawing';

const row: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  alignItems: 'end',
  margin: '8px 0',
};
const section: React.CSSProperties = {
  padding: 12,
  borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
};
const format = (n?: number) =>
  n === undefined ? '—' : Number(n.toPrecision(6)).toString();
const uid = () => crypto.randomUUID();
function Text({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field
      label={label}
      size="small"
      style={{ flex: '1 1 130px', minWidth: 80 }}
    >
      <Input
        size="small"
        value={value}
        onChange={(_, d) => onChange(d.value)}
      />
    </Field>
  );
}
export function CircuitExplorer({
  drawing,
  sheet,
  net,
  data,
  run,
  fresh,
  onAcquisition,
}: {
  drawing: dsnDrawing;
  sheet: dsnSheet;
  net?: NetlistData;
  data?: ResultData;
  run?: SimulationRun;
  fresh: boolean;
  onAcquisition?: (id: string) => void;
}) {
  const dispatch = useDispatch(),
    store = useStore<docDrawing>(),
    setup = sheet.simulation;
  const [tab, setTab] = useState('measure'),
    [error, setError] = useState(''),
    [target, setTarget] = useState(''),
    [property, setProperty] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({}),
    [undo, setUndo] = useState<Record<string, string>[]>([]),
    [auto, setAuto] = useState(true),
    [compare, setCompare] = useState(true);
  const [points, setPoints] = useState<ExplorationPoint[]>(() =>
      restoredSweep(setup.sweeps?.at(-1), setup),
    ),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(''),
    [metricId, setMetricId] = useState('');
  const [batchId, setBatchId] = useState(setup.sweeps?.at(-1)?.id || '');
  const [batchBinding, setBatchBinding] = useState(
    setup.sweeps?.at(-1)?.binding,
  );
  const [batchDefinitions, setBatchDefinitions] = useState(
    setup.sweeps?.at(-1)?.measurements || setup.measurements || [],
  );
  const [overlaySignal, setOverlaySignal] = useState('');
  const selection = useSelector((s: docDrawing) => {
    const active =
      s.docStore.present.drawing.sheets[s.docStore.present.view.selected_sheet];
    const ids = s.docStore.present.view._selected_array;
    const symbol =
      ids.length === 1 && active?.items.find((i) => i._id === ids[0]);
    return symbol && symbol.NodeName === DocItemTypes.Symbol
      ? JSON.stringify([active.id || active.name, symbolReference(symbol)])
      : '';
  });
  useEffect(() => {
    if (selection) {
      setTarget(selection);
      setProperty('');
    }
  }, [selection]);
  const [mode, setMode] = useState(overlayMode(drawing.documentId));
  const [evidence, setEvidence] = useState<MeasurementDefinition>();
  const schematicRefs = useRef(
    drawing.sheets.filter((s) => s.kind !== 'simulation').map((s) => s.items),
  );
  const abort = useRef<AbortController>(),
    queue = useRef<Promise<unknown>>(Promise.resolve());
  const alive = useRef(true),
    current = useRef({ drawing, setup });
  current.current = { drawing, setup };
  const update = (changes: Partial<typeof setup>) =>
    dispatch({
      type: 'simulation/update',
      sheetId: sheet.id,
      setup: { ...setup, ...changes },
    });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abort.current?.abort();
    };
  }, []);
  useEffect(() => {
    const items = drawing.sheets
      .filter((s) => s.kind !== 'simulation')
      .map((s) => s.items);
    if (
      items.length !== schematicRefs.current.length ||
      items.some((value, i) => value !== schematicRefs.current[i])
    ) {
      abort.current?.abort();
      setPoints([]);
    }
    schematicRefs.current = items;
  }, [drawing]);
  const definitions = setup.measurements || [],
    rules = setup.requirements || [],
    bindings = setup.bindings || [];
  const sources = useMemo(() => {
    const options = new Map<string, string>();
    data?.vectors
      .filter((v) => v.name !== data.scale)
      .forEach((v) => options.set(v.name, `${v.name} (${v.unit})`));
    setup.traces?.forEach((t) => options.set(t.name, t.name));
    for (const s of drawing.sheets.filter((s) => s.kind !== 'simulation'))
      for (const item of s.items) {
        if (item.NodeName !== DocItemTypes.Symbol) continue;
        const ref = symbolReference(item),
          control = readControl(item);
        if (control?.kind === 'probe')
          options.set(
            deviceSignal(s.id || s.name, ref, 'probe'),
            `${ref} probe`,
          );
        else
          for (const kind of ['voltage', 'current', 'power'])
            options.set(
              deviceSignal(s.id || s.name, ref, kind),
              `${ref} ${kind}`,
            );
      }
    return options;
  }, [drawing, data, setup.traces]);
  const resolved = useMemo(() => {
    if (!data || !fresh || !net) return;
    try {
      const capturedDrawing = run?.explorer
        ? applyBindings(
            drawing,
            { ...setup, bindings: run.explorer.bindings },
            run.explorer.overrides,
          ).drawing
        : drawing;
      return deriveTraces(
        resolvedSignals(
          capturedDrawing,
          net,
          data,
          (setup.measurements || []).flatMap((d) =>
            [d.source, d.reference].filter(Boolean),
          ),
        ),
        JSON.stringify(run?.explorer?.definitions) ===
          JSON.stringify(definitions)
          ? run.explorer.traces || setup.traces || []
          : setup.traces || [],
      ).data;
    } catch {
      return;
    }
  }, [drawing, net, data, fresh, setup.traces, setup.measurements, run]);
  const captured = run?.explorer;
  const sameDefinitions =
    JSON.stringify(captured?.definitions) === JSON.stringify(definitions);
  const results =
    sameDefinitions && captured
      ? captured.measurements
      : definitions.map((def) => measure(def, resolved));
  const checks = rules.map((rule) => checkRequirement(rule, results));
  const evidenceData =
    resolved ||
    (data && evidence && !evidence.source.startsWith('device|')
      ? deriveTraces(data, run?.explorer?.traces || setup.traces || []).data
      : undefined);
  const editMetric = (next: MeasurementDefinition) =>
    update({
      measurements: definitions.map((d) => (d.id === next.id ? next : d)),
    });
  const editRule = (next: RequirementDefinition) =>
    update({ requirements: rules.map((d) => (d.id === next.id ? next : d)) });
  const openEvidence = (definition?: MeasurementDefinition) => {
    setEvidence(definition);
    const location =
      definition &&
      net &&
      measurementLocation(drawing, net, definition, setup.traces);
    if (location) {
      dispatch(actionFindSelection(3, location));
      requestAnimationFrame(() => {
        if (alive.current) dispatch(actionFindSelection(3, location));
      });
    }
  };
  const reportDiagnostics = (errors: DrcError[]) => {
    if (
      store.getState().docStore.present.drawing.documentId !==
      drawing.documentId
    )
      return;
    dispatch({
      type: 'simulation/diagnostics',
      documentId: drawing.documentId,
      errors,
    });
    if (errors.length) dispatch(actionSelectPanel(Panels.DrcPanel));
  };
  const commit = (completed: SimulationRun) => {
    const document = store.getState().docStore.present.drawing,
      target = document.sheets.find((s) => s.id === sheet.id);
    if (document.documentId !== drawing.documentId || !target?.simulation)
      return;
    dispatch({
      type: 'simulation/update',
      sheetId: target.id,
      setup: {
        ...target.simulation,
        runs: [...target.simulation.runs, completed],
      },
    });
  };
  const persistSweep = (batch: SweepRun) => {
    const current = store.getState().docStore.present.drawing,
      target = current.sheets.find((s) => s.id === sheet.id);
    if (current.documentId !== drawing.documentId || !target?.simulation)
      return;
    dispatch({
      type: 'simulation/update',
      sheetId: sheet.id,
      setup: {
        ...target.simulation,
        sweeps: [
          ...(target.simulation.sweeps || [])
            .filter((s) => s.id !== batch.id)
            .slice(-99),
          batch,
        ],
      },
    });
  };
  const execute = async (
    values: Record<string, string>,
    controller: AbortController,
  ) => {
    const snapshot = current.current;
    const completed = await exploreOnce(
      snapshot.drawing,
      sheet.id,
      snapshot.setup,
      values,
      commit,
      controller.signal,
      reportDiagnostics,
    );
    if (alive.current && !controller.signal.aborted)
      onAcquisition?.(completed.id);
    return completed;
  };
  const start = (task: (controller: AbortController) => Promise<void>) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setError('');
    setBusy(true);
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        if (controller.signal.aborted) {
          if (alive.current && abort.current === controller) setBusy(false);
          return;
        }
        try {
          await task(controller);
        } catch (e) {
          if (alive.current && !controller.signal.aborted)
            setError(e instanceof Error ? e.message : String(e));
        } finally {
          if (alive.current && abort.current === controller) {
            setBusy(false);
            setProgress('');
          }
        }
      });
  };
  const overrideKey = JSON.stringify(overrides);
  useEffect(() => {
    if (!auto || !Object.keys(overrides).length) return;
    const timeout = setTimeout(
      () =>
        start(async (controller) => {
          const completed = await execute(overrides, controller);
          if (completed.state === 'failed')
            throw new Error(completed.error || 'Tuning run failed.');
        }),
      500,
    );
    return () => clearTimeout(timeout);
  }, [overrideKey, auto]);
  const changeOverride = (id: string, value: string) => {
    setUndo((previous) => [...previous.slice(-49), overrides]);
    setOverrides({ ...overrides, [id]: value });
  };
  const reset = () => {
    abort.current?.abort();
    setUndo((previous) => [...previous.slice(-49), overrides]);
    setOverrides({});
    start(async (controller) => {
      await execute({}, controller);
    });
  };
  const previousRun = setup.runs
    .filter(
      (r) =>
        r.id !== run?.id &&
        r.analysis.kind === setup.analysis.kind &&
        r.state === 'complete' &&
        getResult(r.id),
    )
    .at(-1);
  const baseline = previousRun
    ? deriveTraces(getResult(previousRun.id), setup.traces || []).data
    : undefined;
  const targets = drawing.sheets
    .filter((s) => s.kind !== 'simulation')
    .flatMap((s) =>
      s.items
        .filter((i) => i.NodeName === DocItemTypes.Symbol)
        .map((i) => ({
          key: JSON.stringify([s.id || s.name, symbolReference(i)]),
          label: `${symbolReference(i)} — ${s.name}`,
          symbol: i,
          sheet: s.id || s.name,
        })),
    );
  const selectedTarget = targets.find((t) => t.key === target);
  const properties: { key: string; unit: string; value: string }[] = [];
  if (selectedTarget) {
    const c = readControl(selectedTarget.symbol);
    if (c?.kind === 'source')
      for (const [key, unit] of Object.entries(sourceFields))
        properties.push({
          key: `source:${key}`,
          unit:
            unit ||
            ([
              'dc',
              'acMagnitude',
              'offset',
              'amplitude',
              'low',
              'high',
            ].includes(key)
              ? c.type === 'voltage'
                ? 'V'
                : 'A'
              : ''),
          value: c[key as keyof SourceConfig],
        });
    else
      for (const f of selectedTarget.symbol.text) {
        if (
          f.description.startsWith('$$') ||
          f.description.toLowerCase() === 'ref'
        )
          continue;
        const unit = !/^(?:Value|Name)$/i.test(f.description)
          ? ''
          : /^r/i.test(symbolReference(selectedTarget.symbol))
          ? 'Ohm'
          : /^c/i.test(symbolReference(selectedTarget.symbol))
          ? 'F'
          : /^l/i.test(symbolReference(selectedTarget.symbol))
          ? 'H'
          : '';
        try {
          parseQuantity(f.value, unit);
          properties.push({ key: f.description, unit, value: f.value });
        } catch {
          /* Text and expressions cannot be tuned numerically. */
        }
      }
  } else if (target === '$parameter')
    for (const [key, value] of Object.entries(setup.parameters))
      properties.push({ key, unit: '', value });
  const addBinding = () => {
    try {
      const chosen =
        properties.find((p) => p.key === property) || properties[0];
      if (!chosen) throw new Error('Choose a numeric property.');
      const n = parseQuantity(chosen.value, chosen.unit);
      update({
        bindings: [
          ...bindings,
          {
            id: uid(),
            name: `${
              selectedTarget
                ? symbolReference(selectedTarget.symbol)
                : 'Parameter'
            } ${chosen.key}`,
            sheet: selectedTarget?.sheet || '$parameter',
            reference: selectedTarget
              ? symbolReference(selectedTarget.symbol)
              : '',
            property: chosen.key,
            unit: chosen.unit,
            minimum: String(n > 0 ? n / 10 : n - 1),
            maximum: String(n > 0 ? n * 10 : n + 1),
            logarithmic: n > 0,
            series: 'continuous',
          },
        ],
      });
    } catch (e) {
      setError(String(e));
    }
  };
  const selectedBinding =
    bindings.find((b) => b.id === setup.sweep?.binding) || bindings[0];
  const sweep = setup.sweep || {
    binding: selectedBinding?.id || '',
    mode: 'list' as const,
    start: '1k',
    stop: '10k',
    count: 5,
    values: '1k 2.2k 4.7k 6.8k 10k',
  };
  const sweepMetric =
    batchDefinitions.find((d) => d.id === metricId) || batchDefinitions[0];
  const resultBinding = batchBinding || selectedBinding;
  const plotPoints = points.filter((p) => p.data && p.run.state === 'complete');
  const sweepTraces = plotPoints[0]?.run.explorer?.traces || setup.traces || [];
  const trend: ResultData = sweepMetric
    ? {
        scale: 'parameter',
        log: '',
        vectors: [
          {
            name: 'parameter',
            unit: resultBinding?.unit || '',
            real: points
              .filter(
                (p) =>
                  p.run.explorer?.measurements.find(
                    (m) => m.id === sweepMetric.id,
                  )?.state === 'valid',
              )
              .map((p) => p.value),
          },
          {
            name: sweepMetric.name,
            unit:
              points
                .find(
                  (p) =>
                    p.run.explorer?.measurements.find(
                      (m) => m.id === sweepMetric.id,
                    )?.state === 'valid',
                )
                ?.run.explorer.measurements.find((m) => m.id === sweepMetric.id)
                ?.unit || '',
            real: points.flatMap((p) => {
              const r = p.run.explorer?.measurements.find(
                (m) => m.id === sweepMetric.id,
              );
              return r?.state === 'valid' ? [r.value] : [];
            }),
          },
        ],
      }
    : undefined;
  const selectSource = (
    value: string,
    change: (v: string) => void,
    optional = false,
  ) => (
    <Select
      size="small"
      value={value}
      onChange={(_, d) => change(d.value)}
      style={{ maxWidth: '100%' }}
    >
      {optional && <option value="">None</option>}
      {!optional && !sources.has(value) && (
        <option value={value}>{value || 'Choose signal'}</option>
      )}
      {[...sources].map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </Select>
  );
  return (
    <section style={section} aria-label="Circuit Explorer">
      <strong>Circuit Explorer</strong>
      <TabList
        size="small"
        selectedValue={tab}
        onTabSelect={(_, d) => setTab(String(d.value))}
      >
        <Tab value="measure">Measurements</Tab>
        <Tab value="tune">Tune / sweep</Tab>
        <Tab value="checks">Requirements</Tab>
        <Tab value="op">DC overlay</Tab>
      </TabList>
      {tab === 'measure' && (
        <>
          <p style={{ fontSize: 12 }}>
            {captured && sameDefinitions
              ? `Captured results · ${new Date(
                  run.created,
                ).toLocaleString()} · ${run.analysis.kind} · ${run.state}${
                  fresh ? '' : ' · circuit changed'
                }`
              : 'Current definitions; run again to capture reproducible results.'}
          </p>
          {definitions.map((def) => {
            const result = results.find((r) => r.id === def.id);
            return (
              <details key={def.id} style={{ margin: '10px 0' }}>
                <summary>
                  <b>{def.name}</b> —{' '}
                  <Button
                    size="small"
                    appearance="transparent"
                    onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                      e.preventDefault();
                      openEvidence(def);
                    }}
                  >
                    {result?.state === 'valid'
                      ? `${format(result.value)} ${result.unit}`
                      : result?.state || 'unavailable'}
                  </Button>
                </summary>
                <div style={row}>
                  <Text
                    label="Name"
                    value={def.name}
                    onChange={(name) => editMetric({ ...def, name })}
                  />
                  <Field label="Measurement" size="small">
                    <Select
                      size="small"
                      value={def.kind}
                      onChange={(_, d) =>
                        editMetric({
                          ...def,
                          kind: d.value as MeasurementDefinition['kind'],
                        })
                      }
                    >
                      {metricKinds.map((kind) => (
                        <option key={kind}>{kind}</option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Field label="Signal / component" size="small">
                  {selectSource(def.source, (source) =>
                    editMetric({ ...def, source }),
                  )}
                </Field>
                {[
                  'gain',
                  'phase',
                  'cutoff',
                  'bandwidth',
                  'resonance',
                  'delay',
                ].includes(def.kind) && (
                  <Field label="Input reference" size="small">
                    {selectSource(
                      def.reference || '',
                      (reference) => editMetric({ ...def, reference }),
                      true,
                    )}
                  </Field>
                )}
                <div style={row}>
                  {(['from', 'to'] as const).map((key) => (
                    <Text
                      key={key}
                      label={`${key} (s or Hz; blank = full range)`}
                      value={def[key] || ''}
                      onChange={(value) => editMetric({ ...def, [key]: value })}
                    />
                  ))}
                </div>
                {['value', 'gain', 'phase'].includes(def.kind) && (
                  <Text
                    label="At (s or Hz; blank = start)"
                    value={def.at || ''}
                    onChange={(at) => editMetric({ ...def, at })}
                  />
                )}
                {['cutoff', 'bandwidth'].includes(def.kind) && (
                  <Text
                    label="Reference gain (ratio, or peak)"
                    value={def.referenceGain || '1'}
                    onChange={(referenceGain) =>
                      editMetric({ ...def, referenceGain })
                    }
                  />
                )}
                {[
                  'riseTime',
                  'fallTime',
                  'overshoot',
                  'undershoot',
                  'settlingTime',
                  'timeConstant',
                ].includes(def.kind) && (
                  <div style={row}>
                    <Text
                      label="Initial / low level"
                      value={def.initial || ''}
                      onChange={(initial) => editMetric({ ...def, initial })}
                    />
                    <Text
                      label="Final / high level"
                      value={def.final || ''}
                      onChange={(final) => editMetric({ ...def, final })}
                    />
                  </div>
                )}
                {[
                  'period',
                  'frequency',
                  'dutyCycle',
                  'pulseWidth',
                  'delay',
                ].includes(def.kind) && (
                  <Text
                    label="Crossing level (blank = midpoint)"
                    value={def.threshold || ''}
                    onChange={(threshold) => editMetric({ ...def, threshold })}
                  />
                )}
                {def.kind === 'settlingTime' && (
                  <Text
                    label="Settling tolerance (%)"
                    value={def.tolerance || '2'}
                    onChange={(tolerance) => editMetric({ ...def, tolerance })}
                  />
                )}
                <p style={{ fontSize: 12 }}>
                  {result?.explanation} Timing uses the first complete
                  transition in the window.
                </p>
                <Button
                  size="small"
                  onClick={() =>
                    update({
                      measurements: definitions.filter((d) => d.id !== def.id),
                    })
                  }
                >
                  Remove measurement
                </Button>
              </details>
            );
          })}
          <Button
            size="small"
            disabled={definitions.length >= 100}
            onClick={() =>
              update({
                measurements: [
                  ...definitions,
                  {
                    id: uid(),
                    name: `Measurement ${definitions.length + 1}`,
                    kind: 'value',
                    source: sources.keys().next().value || '',
                  },
                ],
              })
            }
          >
            Add measurement
          </Button>
        </>
      )}
      {tab === 'checks' && (
        <>
          {rules.map((rule) => {
            const result = checks.find((c) => c.id === rule.id);
            return (
              <details key={rule.id} style={{ margin: '10px 0' }}>
                <summary>
                  {rule.name} —{' '}
                  <Button
                    size="small"
                    appearance="transparent"
                    onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                      e.preventDefault();
                      openEvidence(
                        definitions.find((d) => d.id === rule.measurement),
                      );
                    }}
                  >
                    {result?.state}
                  </Button>
                </summary>
                <Text
                  label="Requirement name"
                  value={rule.name}
                  onChange={(name) => editRule({ ...rule, name })}
                />
                <Field label="Named measurement" size="small">
                  <Select
                    size="small"
                    value={rule.measurement}
                    onChange={(_, d) =>
                      editRule({ ...rule, measurement: d.value })
                    }
                  >
                    {!definitions.some((d) => d.id === rule.measurement) && (
                      <option value={rule.measurement}>
                        Missing measurement
                      </option>
                    )}
                    {definitions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Select
                  size="small"
                  aria-label="Requirement comparison"
                  value={rule.comparison}
                  onChange={(_, d) =>
                    editRule({
                      ...rule,
                      comparison:
                        d.value as RequirementDefinition['comparison'],
                    })
                  }
                >
                  <option value="between">Between (inclusive)</option>
                  <option value="atLeast">At least</option>
                  <option value="atMost">At most</option>
                </Select>
                <div style={row}>
                  {rule.comparison !== 'atMost' && (
                    <Text
                      label="Lower limit"
                      value={rule.lower}
                      onChange={(lower) => editRule({ ...rule, lower })}
                    />
                  )}{' '}
                  {rule.comparison !== 'atLeast' && (
                    <Text
                      label="Upper limit"
                      value={rule.upper}
                      onChange={(upper) => editRule({ ...rule, upper })}
                    />
                  )}
                  <Text
                    label="Unit (must match metric)"
                    value={rule.unit}
                    onChange={(unit) => editRule({ ...rule, unit })}
                  />
                </div>
                <p>{result?.explanation}</p>
                <Button
                  size="small"
                  onClick={() =>
                    update({
                      requirements: rules.filter((r) => r.id !== rule.id),
                    })
                  }
                >
                  Remove requirement
                </Button>
              </details>
            );
          })}
          <Button
            size="small"
            disabled={!definitions.length || rules.length >= 100}
            onClick={() =>
              update({
                requirements: [
                  ...rules,
                  {
                    id: uid(),
                    name: `Requirement ${rules.length + 1}`,
                    measurement: definitions[0].id,
                    comparison: 'between',
                    lower: '0',
                    upper: '1',
                    unit: results[0]?.unit || '',
                  },
                ],
              })
            }
          >
            Add requirement
          </Button>
          <Button
            size="small"
            onClick={() =>
              download(
                'circuit-requirements.json',
                JSON.stringify(
                  {
                    schema: 1,
                    documentId: drawing.documentId,
                    currentDefinitions: {
                      measurements: definitions,
                      requirements: rules,
                    },
                    evaluation: checks,
                    run,
                  },
                  null,
                  2,
                ),
                'application/json',
              )
            }
          >
            Export report
          </Button>
        </>
      )}
      {tab === 'tune' && (
        <>
          <p style={{ fontSize: 12 }}>
            Tuning values are temporary until Apply. Select a component and its
            numeric property, source setting or named parameter.
          </p>
          <Field label="Component" size="small">
            <Select
              size="small"
              value={target}
              onChange={(_, d) => {
                setTarget(d.value);
                setProperty('');
              }}
            >
              <option value="">Choose component</option>
              {targets.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
              <option value="$parameter">Setup parameter</option>
            </Select>
          </Field>
          <div style={row}>
            <Field label="Property" size="small">
              <Select
                size="small"
                value={property || properties[0]?.key || ''}
                onChange={(_, d) => setProperty(d.value)}
              >
                {properties.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.key} ({p.unit})
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              size="small"
              disabled={!properties.length || bindings.length >= 100}
              onClick={addBinding}
            >
              Add tuning control
            </Button>
          </div>
          {bindings.map((binding) => {
            let original = '',
              issue = '',
              value = 0,
              min = 0,
              max = 1;
            try {
              original = bindingValue(drawing, setup, binding);
              value = parseQuantity(
                overrides[binding.id] ?? original,
                binding.unit,
              );
              min = parseQuantity(binding.minimum, binding.unit);
              max = parseQuantity(binding.maximum, binding.unit);
              if (min >= max || (binding.logarithmic && min <= 0))
                throw new Error(
                  'Choose increasing bounds; log bounds must be positive.',
                );
            } catch (e) {
              issue = String(e);
            }
            const edit = (changes: Partial<ParameterBinding>) =>
              update({
                bindings: bindings.map((b) =>
                  b.id === binding.id ? { ...b, ...changes } : b,
                ),
              });
            const position = binding.logarithmic
              ? (Math.log(value) - Math.log(min)) /
                (Math.log(max) - Math.log(min))
              : (value - min) / (max - min);
            return (
              <details key={binding.id} open style={{ margin: '12px 0' }}>
                <summary>
                  {binding.name} ({binding.unit}) · saved {original}
                </summary>
                <div style={row}>
                  <Text
                    label="Control name"
                    value={binding.name}
                    onChange={(name) => edit({ name })}
                  />
                  <Text
                    label="Unit"
                    value={binding.unit}
                    onChange={(unit) => edit({ unit })}
                  />
                </div>
                <Input
                  size="small"
                  aria-label={`${binding.name} temporary value`}
                  value={overrides[binding.id] ?? original}
                  onChange={(_, d) => changeOverride(binding.id, d.value)}
                />
                <input
                  type="range"
                  aria-label={`${binding.name} slider`}
                  disabled={!!issue}
                  min={0}
                  max={1000}
                  value={Math.min(1000, Math.max(0, position * 1000)) || 0}
                  style={{ width: '100%' }}
                  onChange={(e) => {
                    try {
                      const fraction = Number(e.target.value) / 1000,
                        n = binding.logarithmic
                          ? Math.exp(
                              Math.log(min) +
                                (Math.log(max) - Math.log(min)) * fraction,
                            )
                          : min + (max - min) * fraction;
                      changeOverride(
                        binding.id,
                        String(preferredValue(n, binding.series)),
                      );
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                />
                <div style={row}>
                  <Text
                    label="Minimum"
                    value={binding.minimum}
                    onChange={(minimum) => edit({ minimum })}
                  />
                  <Text
                    label="Maximum"
                    value={binding.maximum}
                    onChange={(maximum) => edit({ maximum })}
                  />
                </div>
                <div style={row}>
                  <Checkbox
                    label="Log slider"
                    checked={binding.logarithmic}
                    onChange={(_, d) => edit({ logarithmic: !!d.checked })}
                  />
                  <Select
                    size="small"
                    aria-label={`${binding.name} preferred values`}
                    value={binding.series}
                    onChange={(_, d) =>
                      edit({ series: d.value as ParameterBinding['series'] })
                    }
                  >
                    {['continuous', 'E12', 'E24', 'E96'].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </Select>
                  <Button
                    size="small"
                    onClick={() => {
                      const next = { ...overrides };
                      delete next[binding.id];
                      setOverrides(next);
                      update({
                        bindings: bindings.filter((b) => b.id !== binding.id),
                      });
                    }}
                  >
                    Remove
                  </Button>
                </div>
                {issue && <p role="alert">{issue}</p>}
              </details>
            );
          })}
          <div style={row}>
            <Checkbox
              label="Automatically rerun"
              checked={auto}
              onChange={(_, d) => setAuto(!!d.checked)}
            />
            <Checkbox
              label="Compare curves"
              checked={compare}
              onChange={(_, d) => setCompare(!!d.checked)}
            />
          </div>
          <div style={row}>
            <Button
              size="small"
              onClick={() =>
                start(async (c) => {
                  await execute(overrides, c);
                })
              }
              disabled={busy}
            >
              Run tuning
            </Button>
            <Button size="small" onClick={reset}>
              Reset
            </Button>
            <Button
              size="small"
              disabled={!undo.length}
              onClick={() => {
                abort.current?.abort();
                const restored = undo.at(-1);
                setOverrides(restored);
                setUndo(undo.slice(0, -1));
                if (!auto || !Object.keys(restored).length)
                  start(async (controller) => {
                    await execute(restored, controller);
                  });
              }}
            >
              Undo tuning
            </Button>
            <Button
              size="small"
              disabled={!Object.keys(overrides).length || busy}
              onClick={() => {
                try {
                  applyBindings(drawing, setup, overrides);
                  dispatch({
                    type: 'simulation/apply-tuning',
                    sheetId: sheet.id,
                    overrides,
                  });
                  setOverrides({});
                  setUndo([]);
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              Apply
            </Button>
          </div>
          {compare && resolved && baseline && !points.length && (
            <>
              <p style={{ fontSize: 12 }}>
                Previous acquisition: {previousRun.created}. Dashed curves are
                the previous values.
              </p>
              <Waveform
                compact
                data={resolved}
                signals={setup.signals}
                baseline={baseline}
              />
            </>
          )}
          {!!bindings.length && (
            <details>
              <summary>One-variable sweep</summary>
              <Field label="Variable" size="small">
                <Select
                  size="small"
                  value={selectedBinding?.id || ''}
                  onChange={(_, d) =>
                    update({ sweep: { ...sweep, binding: d.value } })
                  }
                >
                  {bindings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Select
                size="small"
                aria-label="Sweep spacing"
                value={sweep.mode}
                onChange={(_, d) =>
                  update({
                    sweep: {
                      ...sweep,
                      binding: selectedBinding.id,
                      mode: d.value as typeof sweep.mode,
                    },
                  })
                }
              >
                <option value="list">Explicit values</option>
                <option value="linear">Linear</option>
                <option value="log">Logarithmic</option>
              </Select>
              {sweep.mode === 'list' ? (
                <Text
                  label="Values (space or semicolon separated)"
                  value={sweep.values}
                  onChange={(values) =>
                    update({
                      sweep: { ...sweep, binding: selectedBinding.id, values },
                    })
                  }
                />
              ) : (
                <div style={row}>
                  <Text
                    label="Start"
                    value={sweep.start}
                    onChange={(start) =>
                      update({
                        sweep: { ...sweep, binding: selectedBinding.id, start },
                      })
                    }
                  />
                  <Text
                    label="Stop"
                    value={sweep.stop}
                    onChange={(stop) =>
                      update({
                        sweep: { ...sweep, binding: selectedBinding.id, stop },
                      })
                    }
                  />
                  <Field label="Points (2–100)" size="small">
                    <Input
                      size="small"
                      type="number"
                      min={2}
                      max={100}
                      value={String(sweep.count)}
                      onChange={(_, d) => {
                        const count = Number(d.value);
                        if (
                          Number.isInteger(count) &&
                          count >= 2 &&
                          count <= 100
                        )
                          update({
                            sweep: {
                              ...sweep,
                              binding: selectedBinding.id,
                              count,
                            },
                          });
                      }}
                    />
                  </Field>
                </div>
              )}
              <Button
                size="small"
                disabled={busy || !!getSession()}
                onClick={() => {
                  try {
                    const values = sweepValues(sweep, selectedBinding);
                    setPoints([]);
                    const capturedDrawing = drawing,
                      capturedSetup = setup;
                    let batch: SweepRun = {
                      id: uid(),
                      created: new Date().toISOString(),
                      state: 'running',
                      binding: structuredClone(selectedBinding),
                      definition: { ...sweep, binding: selectedBinding.id },
                      measurements: structuredClone(definitions),
                      points: [],
                    };
                    setBatchId(batch.id);
                    setBatchBinding(batch.binding);
                    setBatchDefinitions(batch.measurements);
                    start(async (controller) => {
                      persistSweep(batch);
                      try {
                        await runSweep(
                          values,
                          (value) =>
                            exploreOnce(
                              capturedDrawing,
                              sheet.id,
                              {
                                ...capturedSetup,
                                runs:
                                  store
                                    .getState()
                                    .docStore.present.drawing.sheets.find(
                                      (s) => s.id === sheet.id,
                                    )?.simulation.runs || [],
                              },
                              {
                                ...overrides,
                                [selectedBinding.id]: String(value),
                              },
                              commit,
                              controller.signal,
                              reportDiagnostics,
                            ),
                          (point, index) => {
                            batch = {
                              ...batch,
                              state:
                                point.run.state === 'complete'
                                  ? batch.state
                                  : point.run.state === 'stopped'
                                  ? 'stopped'
                                  : 'failed',
                              points: [
                                ...batch.points,
                                { value: point.value, runId: point.run.id },
                              ],
                            };
                            persistSweep(batch);
                            if (alive.current) {
                              onAcquisition?.(point.run.id);
                              setPoints((previous) => [...previous, point]);
                              setProgress(`${index + 1} / ${values.length}`);
                            }
                          },
                          controller.signal,
                        );
                        batch = {
                          ...batch,
                          state:
                            batch.state === 'running'
                              ? 'complete'
                              : batch.state,
                        };
                      } catch (error) {
                        batch = {
                          ...batch,
                          state: controller.signal.aborted
                            ? 'stopped'
                            : 'failed',
                        };
                        throw error;
                      } finally {
                        persistSweep(batch);
                      }
                    });
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                Run sweep
              </Button>
            </details>
          )}
          {busy && (
            <div style={row}>
              <span role="status">Running {progress}</span>
              <Button size="small" onClick={() => abort.current?.abort()}>
                Cancel
              </Button>
            </div>
          )}
          {!!setup.sweeps?.length && (
            <Field label="Saved sweep" size="small">
              <Select
                size="small"
                value={batchId}
                disabled={busy}
                onChange={(_, d) => {
                  const batch = setup.sweeps.find((b) => b.id === d.value);
                  if (!batch) return;
                  setBatchId(batch.id);
                  setBatchBinding(batch.binding);
                  setBatchDefinitions(batch.measurements);
                  setPoints(restoredSweep(batch, setup));
                }}
              >
                {setup.sweeps.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {new Date(batch.created).toLocaleString()} ·{' '}
                    {batch.binding.name} ·{' '}
                    {batch.state === 'running' && !busy
                      ? 'interrupted'
                      : batch.state}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {!!points.length && (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>
                        {resultBinding?.name} ({resultBinding?.unit})
                      </th>
                      <th>Run</th>
                      {batchDefinitions.map((d) => (
                        <th key={d.id}>{d.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((p, i) => (
                      <tr key={i}>
                        <td>{format(p.value)}</td>
                        <td title={`${p.run.id} ${p.run.buildId}`}>
                          {p.run.state}
                        </td>
                        {batchDefinitions.map((d) => {
                          const r = p.run.explorer?.measurements.find(
                            (m) => m.id === d.id,
                          );
                          return (
                            <td key={d.id} title={r?.explanation}>
                              {r?.state === 'valid'
                                ? `${format(r.value)} ${r.unit}`
                                : r?.state || 'unavailable'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button
                size="small"
                onClick={() =>
                  download(
                    'parameter-sweep.json',
                    JSON.stringify(
                      points.map(({ value, run }) => ({ value, run })),
                      null,
                      2,
                    ),
                    'application/json',
                  )
                }
              >
                Export sweep report
              </Button>
              {compare && plotPoints.length > 0 && (
                <>
                  <Field label="Overlay signal" size="small">
                    {selectSource(
                      overlaySignal ||
                        sweepTraces[0]?.name ||
                        setup.signals[0] ||
                        '',
                      setOverlaySignal,
                    )}
                  </Field>
                  <p style={{ fontSize: 12 }}>
                    First curve: {resultBinding?.name} = {plotPoints[0].value}{' '}
                    {resultBinding?.unit}
                  </p>
                  <Waveform
                    compact
                    initialMode={setup.analysis.kind === 'ac' ? 'db' : 'real'}
                    data={deriveTraces(plotPoints[0].data, sweepTraces).data}
                    signals={[
                      overlaySignal ||
                        sweepTraces[0]?.name ||
                        setup.signals[0] ||
                        '',
                    ]}
                    overlays={plotPoints.slice(1).map((p) => ({
                      label: `${resultBinding?.name}=${p.value}`,
                      data: deriveTraces(
                        p.data,
                        p.run.explorer?.traces || sweepTraces,
                      ).data,
                    }))}
                  />
                </>
              )}
              {sweepMetric && (
                <>
                  <Field label="Metric versus parameter" size="small">
                    <Select
                      size="small"
                      value={sweepMetric.id}
                      onChange={(_, d) => setMetricId(d.value)}
                    >
                      {batchDefinitions.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {trend.vectors[0].real.length > 0 && (
                    <Waveform
                      compact
                      data={trend}
                      signals={[sweepMetric.name]}
                    />
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
      {tab === 'op' && (
        <>
          <p style={{ fontSize: 12 }}>
            Fresh, completed operating-point acquisitions only. Currents and
            signed consumed power use solver branch currents or an ideal
            resistor’s V/R. Other device information is shown only when supplied
            by the solver.
          </p>
          <Select
            size="small"
            aria-label="Schematic DC annotations"
            value={mode}
            onChange={(_, d) => {
              const next = d.value as typeof mode;
              setMode(next);
              setOverlayMode(drawing.documentId, next);
            }}
          >
            {['off', 'voltages', 'currents', 'power', 'diagnostics'].map(
              (m) => (
                <option key={m}>{m}</option>
              ),
            )}
          </Select>
          <p role="status">
            {run?.analysis.kind !== 'op'
              ? 'Run Operating Point to annotate the drawing.'
              : !fresh
              ? 'Acquisition is stale; run again.'
              : Object.keys(run.explorer?.overrides || {}).length
              ? 'Run the saved circuit without temporary tuning to annotate the drawing.'
              : `${run.analysis.temperature} °C · ${run.created} · ${run.backend} ${run.buildId}`}
          </p>
          {mode === 'diagnostics' &&
            data?.vectors
              .filter((v) => /^@/.test(v.name))
              .map((v) => (
                <div key={v.name}>
                  {v.name}: {format(v.real[0])} {v.unit}
                </div>
              ))}
          {mode === 'diagnostics' &&
            !data?.vectors.some((v) => /^@/.test(v.name)) && (
              <p>
                No device operating-point vectors were supplied for this
                acquisition.
              </p>
            )}
        </>
      )}
      {evidence && (
        <div style={{ marginTop: 12 }}>
          <b>{evidence.name} — evidence</b>
          <p>{results.find((r) => r.id === evidence.id)?.explanation}</p>
          {evidenceData ? (
            <Waveform
              compact
              data={evidenceData}
              signals={[
                evidence.source,
                ...(evidence.reference ? [evidence.reference] : []),
              ]}
              evidence={results.find((r) => r.id === evidence.id)?.evidence}
            />
          ) : (
            <p>
              The captured value is retained; waveform evidence is unavailable
              for this circuit or the numerical results were removed.
            </p>
          )}
          <Button size="small" onClick={() => setEvidence(undefined)}>
            Close evidence
          </Button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
