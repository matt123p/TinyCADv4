import React, { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);
export function StudyHistogram({
  values,
  unit,
}: {
  values: number[];
  unit: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current || !values.length) return;
    const min = Math.min(...values),
      max = Math.max(...values),
      bins = Math.min(12, Math.max(1, Math.ceil(Math.sqrt(values.length)))),
      width = (max - min || Math.max(Math.abs(min) * 0.01, 1)) / bins,
      counts = Array(bins).fill(0);
    values.forEach(
      (value) =>
        counts[Math.min(bins - 1, Math.floor((value - min) / width))]++,
    );
    const chart = new Chart(canvas.current, {
      type: 'bar',
      data: {
        labels: counts.map(
          (_, i) =>
            `${Number((min + i * width).toPrecision(4))}–${Number(
              (min + (i + 1) * width).toPrecision(4),
            )}`,
        ),
        datasets: [
          {
            label: `Samples (${unit})`,
            data: counts,
            backgroundColor: '#0078d4',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
          x: { title: { display: true, text: unit } },
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
            title: { display: true, text: 'Sample count' },
          },
        },
      },
    });
    return () => chart.destroy();
  }, [values, unit]);
  return (
    <div style={{ height: 230 }}>
      <canvas ref={canvas} aria-label="Metric distribution histogram" />
    </div>
  );
}
