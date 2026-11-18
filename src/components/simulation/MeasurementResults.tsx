import React, { useMemo } from 'react';
import { dsnDrawing } from '../../model/dsnDrawing';
import { NetlistData } from '../../io/netlists/netlistGenerator';
import {
  ResultData,
  SimulationRun,
  SimulationSetup,
} from '../../simulation/contracts';
import { evaluateMeasurements } from '../../simulation/measurementResults';
import {
  measurementTitle,
  measurementValue,
} from '../../simulation/measurementPresentation';

export function MeasurementResults(props: {
  drawing: dsnDrawing;
  net?: NetlistData;
  data?: ResultData;
  setup?: SimulationSetup;
  run?: SimulationRun;
  fresh: boolean;
  checking: boolean;
  running: boolean;
}) {
  const evaluation = useMemo(
    () =>
      props.setup
        ? evaluateMeasurements({ ...props, setup: props.setup })
        : undefined,
    [
      props.drawing,
      props.net,
      props.data,
      props.setup,
      props.run,
      props.fresh,
      props.checking,
      props.running,
    ],
  );
  const definitions = props.setup?.measurements || [];
  if (!definitions.length) return null;
  return (
    <section
      aria-label="Measurement results"
      style={{ padding: '10px 12px', borderBottom: '1px solid #dde3e9' }}
    >
      <strong style={{ fontSize: 12 }}>Measurements</strong>
      <dl style={{ margin: '4px 0 0', fontSize: 12 }}>
        {definitions.map((def) => {
          const result = evaluation?.results.find((r) => r.id === def.id);
          return (
            <div
              key={def.id}
              title={
                result?.state === 'valid' ? undefined : result?.explanation
              }
              style={{
                display: 'flex',
                alignItems: 'baseline',
                flexWrap: result?.state === 'valid' ? 'nowrap' : 'wrap',
                justifyContent: 'space-between',
                gap: 12,
                padding: '4px 0',
              }}
            >
              <dt style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                {measurementTitle(def)}
              </dt>
              <dd
                aria-label={
                  result?.state === 'valid' ? undefined : result?.explanation
                }
                style={{
                  margin: 0,
                  whiteSpace: result?.state === 'valid' ? 'nowrap' : 'normal',
                  overflowWrap: 'anywhere',
                  color: result?.state === 'valid' ? undefined : '#a4262c',
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 600,
                }}
              >
                {result?.state === 'valid'
                  ? measurementValue(result)
                  : result?.explanation ||
                    'No measurement result is available.'}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
