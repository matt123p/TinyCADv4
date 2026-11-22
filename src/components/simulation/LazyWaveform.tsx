import React from 'react';

export type { WaveformPreferences } from './Waveform';

const Chart = React.lazy(() =>
  import('./Waveform').then(({ Waveform }) => ({ default: Waveform })),
);

export function Waveform(props: React.ComponentProps<typeof Chart>) {
  return (
    <React.Suspense fallback={<p role="status">Loading waveform…</p>}>
      <Chart {...props} />
    </React.Suspense>
  );
}
