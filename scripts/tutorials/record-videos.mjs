// Run under xvfb-run; all circuit edits and solver runs use the actual desktop UI.
import { desktopSession } from './desktop-session.mjs';
import { expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';

const directory = path.resolve('tutorials/spice/videos');
const work = path.resolve('build/tutorials/videos');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sheet = (page) =>
  page.getByRole('region', { name: 'Simulation sheet', exact: true });
const explorer = (page) =>
  page.getByRole('region', { name: 'Circuit Explorer', exact: true });

async function click(page, locator, options) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 16,
  });
  await pause(220);
  await locator.click(options);
}
async function fill(page, locator, value) {
  await click(page, locator);
  await locator.press('ControlOrMeta+a');
  await locator.pressSequentially(value, { delay: 140 });
  await locator.press('Tab');
}
async function simulation(page, id) {
  await click(page, page.getByText('◷ ' + id, { exact: true }));
  await sheet(page).getByRole('tab', { name: 'Setup', exact: true }).waitFor();
}
async function run(page) {
  await click(
    page,
    page.getByRole('button', { name: 'Run', exact: true }).first(),
  );
  await expect(
    page.getByRole('button', { name: 'Run', exact: true }).first(),
  ).toBeEnabled({ timeout: 30000 });
  await click(
    page,
    sheet(page).getByRole('tab', { name: 'History', exact: true }),
  );
  await expect(sheet(page).locator('tbody tr').first()).toContainText(
    'complete',
  );
  await expect(sheet(page).locator('tbody tr').first()).toContainText(
    'available',
  );
}
async function source(page) {
  const box = await page
    .locator('#sheet-content-Circuit ellipse')
    .first()
    .boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 20,
  });
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2, {
    delay: 140,
  });
  await page.getByLabel('Signal type', { exact: true }).waitFor();
}
async function measurements(page) {
  const add = explorer(page).getByRole('button', {
    name: 'Add Measurements',
    exact: true,
  });
  if (await add.isVisible()) await click(page, add);
  else
    await click(
      page,
      explorer(page).getByRole('tab', { name: 'Measurements', exact: true }),
    );
}
async function addMeasurement(page, kind, options = {}) {
  await click(
    page,
    explorer(page).getByRole('button', {
      name: 'Add measurement',
      exact: true,
    }),
  );
  const detail = explorer(page).locator('details').last();
  await click(page, detail.locator('summary'));
  await detail.getByLabel('Measurement', { exact: true }).selectOption(kind);
  await detail
    .getByLabel('Signal / component', { exact: true })
    .selectOption('out');
  for (const [label, value] of Object.entries(options))
    await fill(page, detail.getByLabel(label, { exact: true }), value);
  return detail;
}
async function chartMode(page, mode) {
  await click(
    page,
    page.getByRole('button', { name: 'Chart menu', exact: true }).first(),
  );
  await page
    .getByRole('menuitem', { name: 'Chart options and cursors' })
    .hover();
  await page.getByLabel('Display', { exact: true }).selectOption(mode);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

const scenarios = [
  {
    id: 'first-run',
    title: '01 · Open, run and change a divider',
    async record({ page, step, evidence }) {
      await step(
        'Open Example contains the complete tutorial circuits and their instructions.',
        async () => {
          await click(
            page,
            page.getByRole('button', { name: 'Open Example', exact: true }),
          );
          await fill(
            page,
            page.getByRole('textbox', { name: 'Search groups and examples' }),
            'divider',
          );
        },
      );
      await step(
        'Choose SPICE tutorial, then divider. Open drawing creates an editable copy.',
        async () => {
          await click(
            page,
            page
              .getByRole('navigation', { name: 'Example groups' })
              .getByRole('button', { name: 'SPICE tutorial', exact: true }),
          );
          await click(
            page,
            page
              .getByRole('dialog')
              .getByRole('button', { name: 'divider', exact: true }),
          );
          await click(
            page,
            page.getByRole('button', { name: 'Open drawing', exact: true }),
          );
          await page.getByText('◷ divider', { exact: true }).waitFor();
        },
        6500,
      );
      await step(
        'Select the Simulation sheet. Operating Point finds the DC voltages and currents.',
        () => simulation(page, 'divider'),
      );
      await step(
        'Run a new acquisition. History confirms that the native solver completed it.',
        () => run(page),
        5500,
      );
      await step(
        'Data gives OUT = 2.5 V, IN = 5 V and source current = −2.5 mA.',
        async () => {
          await click(
            page,
            sheet(page).getByRole('tab', { name: 'Data', exact: true }),
          );
          await expect(sheet(page)).toContainText('2.5000000');
          await expect(sheet(page)).toContainText('-0.0025000000');
          await evidence('nominal');
        },
        6000,
      );
      await step(
        'Return to Circuit and double-click R2 to open its properties.',
        async () => {
          await click(page, page.getByText('Circuit', { exact: true }).first());
          const box = await page
            .locator('#sheet-content-Circuit rect[width="10"][height="26"]')
            .boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
            steps: 20,
          });
          await page.mouse.dblclick(
            box.x + box.width / 2,
            box.y + box.height / 2,
            { delay: 140 },
          );
          await page.getByRole('table', { name: 'Properties' }).waitFor();
        },
      );
      await step(
        'Change R2 Value from 1k to 2k. The previous acquisition still describes the old circuit.',
        async () => {
          await fill(
            page,
            page
              .getByRole('table', { name: 'Properties' })
              .getByRole('row')
              .filter({
                has: page.getByRole('cell', { name: 'Value', exact: true }),
              })
              .getByRole('textbox'),
            '2k',
          );
        },
        6000,
      );
      await step(
        'Run again to calculate the changed circuit. Both acquisitions remain in History.',
        async () => {
          await simulation(page, 'divider');
          await run(page);
        },
        6000,
      );
      await step(
        'OUT is now about 3.333 V. Save As keeps your edited copy of the example.',
        async () => {
          await click(
            page,
            sheet(page).getByRole('tab', { name: 'Data', exact: true }),
          );
          await expect(sheet(page)).toContainText('3.3333333');
          await evidence('changed');
        },
        6500,
      );
    },
  },
  {
    id: 'source-settings',
    file: 'source-sine',
    title: '03 · Source settings and waveform preview',
    async record({ page, step, evidence }) {
      await step(
        'source-sine drives a 1 kΩ load. Double-click the source body to see its settings.',
        () => source(page),
        5000,
      );
      await step(
        'Offset = 1 V, amplitude = 2 V peak and frequency = 1 kHz produce a −1 to +3 V sine.',
        async () => {
          await expect(page.getByLabel('Offset', { exact: true })).toHaveValue(
            '1',
          );
          await expect(
            page.getByLabel('Amplitude', { exact: true }),
          ).toHaveValue('2');
        },
        6000,
      );
      await step(
        'Set offset to 0 and amplitude to 1. The preview immediately changes to a ±1 V sine.',
        async () => {
          await fill(page, page.getByLabel('Offset', { exact: true }), '0');
          await fill(page, page.getByLabel('Amplitude', { exact: true }), '1');
        },
        6500,
      );
      await step(
        'Double the frequency to 2k. There are now twice as many cycles in the preview.',
        async () => {
          await fill(
            page,
            page.getByLabel('Frequency (Hz)', { exact: true }),
            '2k',
          );
        },
        5000,
      );
      await step(
        'AC amplitude is separate: it excites an AC sweep, not this transient waveform.',
        async () => {
          await page
            .getByLabel('AC amplitude', { exact: true })
            .scrollIntoViewIfNeeded();
        },
        5500,
      );
      await step(
        'Select the Simulation sheet and run the edited source through the actual circuit.',
        async () => {
          await simulation(page, 'source-sine');
          await run(page);
        },
        6000,
      );
      await step(
        'The new trace spans about −1 to +1 V, with ten cycles in the 5 ms acquisition.',
        async () => {
          await click(
            page,
            sheet(page)
              .getByRole('tab', { name: 'Measurements', exact: true })
              .first(),
          );
          await sheet(page).getByRole('table').last().scrollIntoViewIfNeeded();
          await expect(sheet(page).getByRole('table').last()).toContainText(
            '-0.999',
          );
          await expect(sheet(page).getByRole('table').last()).toContainText(
            '0.999',
          );
          await evidence('changed-source');
        },
        6500,
      );
    },
  },
  {
    id: 'rc-transient',
    file: 'rc-step',
    title: '04 · RC charging, timestep and time constant',
    async record({ page, step, evidence }) {
      await step(
        'rc-step applies a 0–1 V step to a 1 kΩ / 1 µF network. The output charges gradually.',
        async () => {},
        5500,
      );
      await step(
        'The saved transient runs for 5 ms. Maximum step limits the spacing between solver points.',
        () => simulation(page, 'rc-step'),
        5500,
      );
      await step(
        'Halve maximum step from 5us to 2.5us to check that the measured response is stable.',
        async () => {
          await fill(
            page,
            page.getByLabel('Maximum step (e.g. 10us)', { exact: true }),
            '2.5us',
          );
        },
        5500,
      );
      await step(
        'Add a Value measurement on OUT at 1ms to inspect one time constant.',
        async () => {
          await measurements(page);
          await addMeasurement(page, 'value', {
            'At (s or Hz; blank = start)': '1ms',
          });
        },
        7000,
      );
      await step(
        'Add Time constant with initial level 0 and final level 1. Here R × C = 1 ms.',
        async () => {
          await addMeasurement(page, 'timeConstant', {
            'Initial / low level': '0',
            'Final / high level': '1',
          });
        },
        7500,
      );
      await step(
        'Run again to capture both measurements with the finer timestep.',
        () => run(page),
        5500,
      );
      await step(
        'Named measurements show about 0.632 V at 1 ms and a time constant close to 1 ms.',
        async () => {
          await click(
            page,
            sheet(page)
              .getByRole('tab', { name: 'Measurements', exact: true })
              .first(),
          );
          await expect(sheet(page).locator('tbody').first()).toContainText(
            /0\.63/,
          );
          await expect(sheet(page).locator('tbody').first()).toContainText(
            /0\.001/,
          );
          await evidence('time-constant');
        },
        7500,
      );
    },
  },
  {
    id: 'ac-response',
    file: 'rc-ac',
    title: '05 · AC response, decibels and cutoff',
    async record({ page, step, evidence }) {
      await step(
        'rc-ac is the same RC network, measured in the frequency domain.',
        async () => {},
        4500,
      );
      await step(
        'The AC sweep uses 1 Hz to 100 kHz and 100 points per decade.',
        () => simulation(page, 'rc-ac'),
        5500,
      );
      await step(
        'Run the sweep. AC analysis calculates small-signal response rather than stepping through time.',
        () => run(page),
        6000,
      );
      await step(
        'The prepared Cutoff measurement compares OUT with IN using reference gain 1.',
        async () => {
          await click(
            page,
            sheet(page).getByRole('tab', { name: 'Setup', exact: true }),
          );
          await explorer(page).scrollIntoViewIfNeeded();
          await click(page, explorer(page).locator('summary').first());
          await explorer(page)
            .getByLabel('Input reference', { exact: true })
            .scrollIntoViewIfNeeded();
        },
        6500,
      );
      await step(
        'The cutoff is about 159.15 Hz, where the gain is 0.707 or −3.01 dB.',
        async () => {
          await click(
            page,
            sheet(page)
              .getByRole('tab', { name: 'Measurements', exact: true })
              .first(),
          );
          await expect(sheet(page).locator('tbody').first()).toContainText(
            /159\.15/,
          );
          await evidence('cutoff');
        },
        6500,
      );
      await step(
        'Select the derived OUT / IN trace and hide the separate node voltages to plot gain directly.',
        async () => {
          for (const name of ['OUT / IN (V/V)', 'V(out) (V)', 'V(in) (V)']) {
            const option = page.getByRole('menuitemcheckbox', { name, exact: true });
            if (!(await option.isVisible()))
              await click(page, page.getByRole('button', { name: 'Signals', exact: true }));
            await click(page, option);
          }
          await page.keyboard.press('Escape');
        },
        6500,
      );
      await step(
        'Use the chart menu to show Magnitude (dB). The frequency axis remains logarithmic.',
        () => chartMode(page, 'db'),
        6000,
      );
      await step(
        'Switch to Phase: the output lags, passing approximately −45° at the corner frequency.',
        () => chartMode(page, 'phase'),
        6500,
      );
      await step(
        'OUT / IN expresses gain even if the input AC amplitude changes.',
        () => chartMode(page, 'magnitude'),
        5000,
      );
    },
  },
  {
    id: 'rectifier-ripple',
    file: 'rectifier',
    title: '06 · Measure settled rectifier ripple',
    async record({ page, step, evidence }) {
      await step(
        'The rectifier charges its reservoir capacitor near each positive input peak.',
        async () => {},
        5500,
      );
      await step(
        'Startup is visible in this 200 ms transient. Measure settled operation over 160–200 ms.',
        () => simulation(page, 'rectifier'),
        5500,
      );
      await step(
        'Add Mean on OUT. Set from = 160ms and to = 200ms to exclude startup.',
        async () => {
          await measurements(page);
          await addMeasurement(page, 'mean', {
            'from (s or Hz; blank = full range)': '160ms',
            'to (s or Hz; blank = full range)': '200ms',
          });
        },
        8500,
      );
      await step(
        'Add Peak-to-peak on OUT using the same window. This measures ripple around the DC level.',
        async () => {
          await addMeasurement(page, 'peakToPeak', {
            'from (s or Hz; blank = full range)': '160ms',
            'to (s or Hz; blank = full range)': '200ms',
          });
        },
        8500,
      );
      await step(
        'Run to capture the mean and ripple measurements alongside the acquisition.',
        () => run(page),
        5500,
      );
      await step(
        'The settled mean is about 3.90 V and the peak-to-peak ripple is about 0.684 V.',
        async () => {
          await click(
            page,
            sheet(page)
              .getByRole('tab', { name: 'Measurements', exact: true })
              .first(),
          );
          await expect(sheet(page).locator('tbody').first()).toContainText(
            /3\.90/,
          );
          await expect(sheet(page).locator('tbody').first()).toContainText(
            /0\.68/,
          );
          await evidence('settled-ripple');
        },
        7500,
      );
      await step(
        'Total RMS includes the DC level. AC RMS removes the mean; it answers a different question.',
        async () => {},
        6000,
      );
    },
  },
];

function assTime(seconds) {
  const centiseconds = Math.round(seconds * 100);
  return `${Math.floor(centiseconds / 360000)}:${String(
    Math.floor(centiseconds / 6000) % 60,
  ).padStart(2, '0')}:${String(Math.floor(centiseconds / 100) % 60).padStart(
    2,
    '0',
  )}.${String(centiseconds % 100).padStart(2, '0')}`;
}
function ass(title, cues, duration) {
  const safe = (text) => text.replace(/[{}\\]/g, '');
  return (
    `[Script Info]\nScriptType: v4.00+\nPlayResX: 1600\nPlayResY: 1000\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,24,&H00FFFFFF,&H00FFFFFF,&H00101827,&H00101827,0,0,0,0,100,100,0,0,1,0,0,1,32,32,18,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` +
    cues
      .map(
        (cue, i) =>
          `Dialogue: 0,${assTime(cue.start)},${assTime(
            cues[i + 1]?.start ?? duration,
          )},Default,,0,0,0,,{\\fs18\\c&H00E3C47D&}TinyCAD Desktop · SPICE ${safe(
            title,
          )}{\\c&H00FFFFFF&\\fs24}\\N${safe(cue.text)}`,
      )
      .join('\n') +
    '\n'
  );
}
async function encode(args) {
  const process = spawn(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', ...args],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let errors = '';
  process.stderr.on('data', (data) => {
    errors += data;
  });
  const [code] = await once(process, 'close');
  if (code !== 0) throw Error(errors || `ffmpeg exited ${code}`);
}

await fs.mkdir(directory, { recursive: true });
await fs.mkdir(work, { recursive: true });
const requested = process.argv.slice(2);
if (requested.some((id) => !scenarios.some((scenario) => scenario.id === id)))
  throw Error(
    'Unknown video. Choose: ' +
      scenarios.map((scenario) => scenario.id).join(', '),
  );
if (!process.env.DISPLAY)
  throw Error(
    'Use xvfb-run -a -s "-screen 0 1600x900x24" node scripts/tutorials/record-videos.mjs',
  );
for (const scenario of scenarios.filter(
  (item) => !requested.length || requested.includes(item.id),
)) {
  console.log('Recording ' + scenario.id);
  const session = await desktopSession(
    scenario.file && `tutorials/spice/circuits/${scenario.file}.dzn`,
  );
  const { page } = session;
  let recorder;
  let stopped;
  try {
    if (scenario.file)
      await page.getByText('◷ ' + scenario.file, { exact: true }).waitFor();
    await pause(1500);
    // Presentation-only pointer overlay. The schematic and controls remain unmodified.
    await page.evaluate(() => {
      const pointer = document.createElement('div');
      pointer.style.cssText =
        'position:fixed;left:0;top:0;width:22px;height:22px;border:3px solid #0078d4;border-radius:50%;background:#ffffff66;z-index:2147483647;pointer-events:none;transform:translate(-50%,-50%);display:none';
      document.body.append(pointer);
      document.addEventListener('mousemove', (event) => {
        pointer.style.display = 'block';
        pointer.style.left = event.clientX + 'px';
        pointer.style.top = event.clientY + 'px';
      });
      document.addEventListener('mousedown', () => {
        pointer.style.background = '#ffc83dcc';
        pointer.style.borderColor = '#9b5c00';
      });
      document.addEventListener('mouseup', () => {
        pointer.style.background = '#ffffff66';
        pointer.style.borderColor = '#0078d4';
      });
    });
    const raw = path.join(work, scenario.id + '-raw.mp4');
    recorder = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'info',
        '-y',
        '-f',
        'x11grab',
        '-draw_mouse',
        '0',
        '-framerate',
        '25',
        '-video_size',
        '1600x900',
        '-i',
        process.env.DISPLAY,
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        raw,
      ],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );
    stopped = once(recorder, 'close');
    await new Promise((resolve, reject) => {
      let log = '';
      const timer = setTimeout(
        () => reject(Error('Capture did not start: ' + log)),
        10000,
      );
      recorder.once('error', reject);
      recorder.stderr.on('data', (data) => {
        log += data;
        if (log.includes('Output #0')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const started = performance.now();
    const cues = [],
      checks = [];
    let number = 0;
    const context = {
      page,
      async step(text, action, minimum = 4500) {
        console.log('  ' + text);
        const start = performance.now();
        cues.push({ start: (start - started) / 1000, text });
        await action();
        await pause(Math.max(500, minimum - (performance.now() - start)));
        await page.screenshot({
          path: path.join(work, `${scenario.id}-${++number}.png`),
        });
      },
      async evidence(name) {
        checks.push({ name, text: await sheet(page).innerText() });
      },
    };
    await scenario.record(context);
    const duration = (performance.now() - started) / 1000;
    recorder.stdin.write('q\n');
    const [code] = await stopped;
    recorder = undefined;
    if (code !== 0) throw Error(`Capture exited ${code}`);
    const subtitles = path.join(work, scenario.id + '.ass');
    await fs.writeFile(subtitles, ass(scenario.title, cues, duration));
    await encode([
      '-i',
      raw,
      '-vf',
      `pad=1600:1000:0:0:color=0x101827,ass=${subtitles}`,
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-metadata',
      `title=TinyCAD SPICE ${scenario.title}`,
      path.join(directory, scenario.id + '.mp4'),
    ]);
    await encode([
      '-ss',
      String(Math.min(duration - 1, 8)),
      '-i',
      path.join(directory, scenario.id + '.mp4'),
      '-frames:v',
      '1',
      '-update',
      '1',
      path.join(directory, scenario.id + '.jpg'),
    ]);
    await fs.writeFile(
      path.join(directory, scenario.id + '.json'),
      JSON.stringify(
        {
          title: scenario.title,
          recorded: new Date().toISOString(),
          application: 'TinyCAD Desktop (Electron)',
          solver: 'bundled native ngspice',
          durationSeconds: Number(duration.toFixed(2)),
          width: 1600,
          height: 1000,
          captions: cues,
          checks,
        },
        null,
        2,
      ) + '\n',
    );
    console.log('Saved ' + scenario.id);
  } catch (error) {
    await page
      .screenshot({ path: path.join(work, scenario.id + '-failure.png') })
      .catch(() => {});
    console.error(
      await page
        .locator('body')
        .innerText()
        .catch(() => ''),
    );
    throw error;
  } finally {
    if (recorder) {
      recorder.stdin.write('q\n');
      await stopped;
    }
    await session.close();
  }
}
