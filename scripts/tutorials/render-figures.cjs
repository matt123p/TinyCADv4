// Render solver results with Chart.js using TinyCAD's installed Electron runtime.
const fs = require('node:fs/promises'),
  path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', path.resolve('build/tutorials/figure-profile'));
app.disableHardwareAcceleration();
const ids = [
  'divider',
  'dc-sweep',
  'rc-step',
  'rc-ac',
  'rectifier',
  'amp-ac',
  'amp-small-signal',
  'amp-clipping',
  'rc-noise',
  'logic-buffer',
  'logic-nand',
  'logic-hazard',
  'logic-dff',
  'logic-counter',
  'logic-filter',
  'logic-unknown',
];
const colors = [
  '#176ba0',
  '#d06423',
  '#25937c',
  '#9a4caa',
  '#b88900',
  '#c04661',
];
const vector = (d, n) =>
  d.vectors.find((v) => v.name.toLowerCase() === n.toLowerCase());
const points = (x, y) => x.map((v, i) => ({ x: v, y: y[i] }));
function config(title, xLabel, yLabel, sets, log = false) {
  return {
    type: 'line',
    data: {
      datasets: sets.map((s, i) => ({
        label: s.name,
        data: points(s.x, s.y),
        borderColor: colors[i % colors.length],
        backgroundColor: colors[i % colors.length],
        borderWidth: 1.8,
        pointRadius: 0,
        tension: 0,
      })),
    },
    options: {
      animation: false,
      responsive: false,
      normalized: true,
      parsing: false,
      plugins: {
        title: { display: true, text: title, font: { size: 20 } },
        legend: { labels: { font: { size: 14 } } },
      },
      scales: {
        x: {
          type: log ? 'logarithmic' : 'linear',
          title: { display: true, text: xLabel, font: { size: 15 } },
          ticks: { maxTicksLimit: 10 },
        },
        y: { title: { display: true, text: yLabel, font: { size: 15 } } },
      },
    },
  };
}
async function data(id) {
  return JSON.parse(
    await fs.readFile('build/tutorials/results/' + id + '.json', 'utf8'),
  );
}
async function main() {
  await app.whenReady();
  const w = new BrowserWindow({
    width: 1440,
    height: 1000,
    show: false,
    useContentSize: true,
    enableLargerThanScreen: true,
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: true },
  });
  async function render(file, configs) {
    const height = configs.length * 350 + 50;
    w.setMinimumSize(1440, height + 100);
    w.setContentSize(1440, height);
    const html = `<html><head><meta charset="utf-8"><style>body{margin:0;background:#fff;font-family:Arial;color:#26364a}canvas{margin:10px 30px}p{margin:10px 40px;font-size:14px}</style></head><body>${configs
      .map(
        (_, i) => `<canvas id="plot${i}" width="1380" height="330"></canvas>`,
      )
      .join(
        '',
      )}<p>Computed from bundled ngspice 47 results · TinyCAD tutorial reference acquisition</p><script src="${path
      .resolve('node_modules/chart.js/dist/chart.umd.js')
      .replaceAll('\\', '/')}"></script></body></html>`;
    const temp = path.resolve('build/tutorials/figure.html');
    await fs.writeFile(temp, html);
    await w.loadFile(temp);
    await w.webContents.executeJavaScript(
      `Chart.defaults.font.family='Arial';const configs=${JSON.stringify(
        configs,
      )};configs.forEach((c,i)=>new Chart(document.getElementById('plot'+i),c));document.fonts.ready.then(()=>true)`,
    );
    await w.webContents.executeJavaScript(
      'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))',
    );
    await fs.writeFile(
      file,
      (
        await w.webContents.capturePage({ x: 0, y: 0, width: 1440, height })
      ).toPNG(),
    );
    console.log(file);
  }
  for (const id of ids) {
    const d = await data(id),
      course = id.startsWith('logic-') ? 'xspice' : 'spice';
    let configs;
    if (id === 'divider') {
      configs = [
        {
          type: 'bar',
          data: {
            labels: ['IN (V)', 'OUT (V)'],
            datasets: [
              {
                label: 'Operating point',
                data: [5, 2.5],
                backgroundColor: colors.slice(0, 2),
              },
            ],
          },
          options: {
            responsive: false,
            animation: false,
            plugins: {
              title: {
                display: true,
                text: 'Voltage divider: 5 V input, 2.5 V output; source current −2.5 mA',
                font: { size: 20 },
              },
            },
            scales: {
              y: {
                beginAtZero: true,
                title: { display: true, text: 'Voltage (V)' },
              },
            },
          },
        },
      ];
    } else if (id.endsWith('-ac')) {
      const x = vector(d, 'frequency').real,
        v = vector(d, 'out');
      const phase = v.real.map(
        (r, i) => (Math.atan2(v.imaginary[i], r) * 180) / Math.PI,
      );
      for (let i = 1; i < phase.length; i++) {
        while (phase[i] - phase[i - 1] > 180) phase[i] -= 360;
        while (phase[i] - phase[i - 1] < -180) phase[i] += 360;
      }
      configs = [
        config(
          id === 'rc-ac'
            ? 'RC low-pass: voltage gain'
            : 'AMP.DSN rebuild: loaded voltage gain',
          'Frequency (Hz)',
          'Gain (dB)',
          [
            {
              name: 'OUT / IN',
              x,
              y: v.real.map(
                (r, i) => 20 * Math.log10(Math.hypot(r, v.imaginary[i])),
              ),
            },
          ],
          true,
        ),
        config(
          'Phase of OUT relative to IN (unwrapped)',
          'Frequency (Hz)',
          'Phase (degrees)',
          [
            {
              name: 'OUT / IN',
              x,
              y: phase,
            },
          ],
          true,
        ),
      ];
    } else if (id === 'rc-noise') {
      const x = vector(d, 'frequency').real;
      configs = [
        config(
          'RC output noise spectral density',
          'Frequency (Hz)',
          'Output noise (nV/√Hz)',
          [
            {
              name: 'onoise_spectrum',
              x,
              y: vector(d, 'onoise_spectrum').real.map((v) => v * 1e9),
            },
          ],
          true,
        ),
      ];
    } else {
      let names =
        id === 'logic-counter'
          ? ['clk', 'q0', 'q1', 'q2', 'q3']
          : id === 'logic-dff'
          ? ['clk', 'd', 'reset', 'q']
          : id === 'logic-nand'
          ? ['a', 'b', 'y']
          : id === 'logic-filter'
          ? ['y', 'filtered']
          : id.startsWith('logic-')
          ? ['a', 'y']
          : ['in', 'out'];
      const scale = vector(d, d.scale).real,
        isDC = id === 'dc-sweep',
        factor = isDC
          ? 1
          : id.startsWith('logic-') && id !== 'logic-filter'
          ? 1e6
          : 1e3,
        x = scale.map((t) => t * factor),
        label = isDC
          ? 'Swept V1 (V)'
          : factor === 1e6
          ? 'Time (µs)'
          : 'Time (ms)';
      if (id === 'logic-counter' || id === 'logic-dff')
        configs = names.map((n) =>
          config(n.toUpperCase(), label, 'Voltage (V)', [
            { name: n, x, y: vector(d, n).real },
          ]),
        );
      else
        configs = [
          config(
            id.replaceAll('-', ' '),
            label,
            'Voltage (V)',
            names
              .filter((n) => vector(d, n))
              .map((n) => ({ name: n, x, y: vector(d, n).real })),
          ),
        ];
    }
    await render(`tutorials/${course}/images/${id}-results.png`, configs);
  }
  const waveforms = [];
  for (const id of [
    'dc',
    'sine',
    'pulse',
    'triangle',
    'pwl',
    'exponential',
    'fm',
    'current',
  ]) {
    const d = await data('source-' + id);
    waveforms.push(
      config(id, 'Time (ms)', 'Voltage (V)', [
        {
          name: 'OUT',
          x: vector(d, 'time').real.map((t) => t * 1000),
          y: vector(d, 'out').real,
        },
      ]),
    );
  }
  await render('tutorials/spice/images/source-waveforms.png', waveforms);
  w.close();
  app.exit(0);
}
main().catch((e) => {
  console.error(e);
  app.exit(1);
});
