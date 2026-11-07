import React, { useState } from 'react';
import { TraceDefinition } from '../../simulation/traces';
export function DerivedTraces({
  signals,
  traces,
  change,
}: {
  signals: string[];
  traces: TraceDefinition[];
  change: (traces: TraceDefinition[]) => void;
}) {
  const [name, setName] = useState('Differential voltage'),
    [left, setLeft] = useState(''),
    [right, setRight] = useState('0'),
    [operation, setOperation] =
      useState<TraceDefinition['operation']>('subtract');
  return (
    <details>
      <summary>Differential voltage, gain and power traces</summary>
      <p>
        Subtract two node voltages for a differential probe; divide output by
        input for gain; multiply voltage by branch current for signed device
        power. Current direction follows SPICE pin order.
      </p>
      {traces.map((trace, index) => (
        <div key={index}>
          {trace.name}: {trace.left}{' '}
          {trace.operation === 'subtract'
            ? '−'
            : trace.operation === 'divide'
            ? '÷'
            : '×'}{' '}
          {trace.right}{' '}
          <button onClick={() => change(traces.filter((_, i) => i !== index))}>
            Remove trace
          </button>
        </div>
      ))}
      <div
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}
      >
        <label>
          Name <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Left{' '}
          <select value={left} onChange={(e) => setLeft(e.target.value)}>
            <option value="">Choose signal</option>
            {signals.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Operation{' '}
          <select
            value={operation}
            onChange={(e) =>
              setOperation(e.target.value as TraceDefinition['operation'])
            }
          >
            <option value="subtract">Subtract</option>
            <option value="divide">Divide (gain)</option>
            <option value="multiply">Multiply (power)</option>
          </select>
        </label>
        <label>
          Right{' '}
          <select value={right} onChange={(e) => setRight(e.target.value)}>
            {['0', ...signals].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <button
          disabled={!name || !left || traces.length >= 16}
          onClick={() => change([...traces, { name, left, right, operation }])}
        >
          Add trace
        </button>
      </div>
    </details>
  );
}
