import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';
import { measureClassroom, measureDesignCheck, stats } from './classroom-performance.mjs';
import { createWorkingSetSampler, observedMemory, sampleProcessTask } from './g0-resource-monitor.mjs';
import { assertReferenceDisplay, assertReferenceGraphics, readReferenceHardware, referenceWindowEvidence } from './reference-hardware.mjs';

const args = process.argv.slice(2);
const [fixture, output] = args.filter((arg) => !arg.startsWith('--'));
if (!fixture || !output) {
  throw new Error('Usage: node scripts/pcb/qualify-electron-classroom.mjs <classroom.dpn> <report.json> [--samples=10] [--reference-host=hardware.json] [--software-rendering]');
}
const count = Number(args.find((arg) => arg.startsWith('--samples='))?.split('=')[1] ?? 2);
if (!Number.isSafeInteger(count) || count < 1 || count > 20)
  throw new Error('Use 1–20 classroom samples.');
const referenceArgument = args.find((arg) => arg === '--reference-host' || arg.startsWith('--reference-host='));
const referenceFile = referenceArgument?.split('=', 2)[1];
if (referenceArgument && !referenceFile)
  throw new Error('Provide the hardware JSON file with --reference-host=hardware.json.');
const software = args.includes('--software-rendering');
if (referenceFile && software)
  throw new Error('Use the integrated GPU for the reference laptop run.');
const referenceHost = referenceFile ? await readReferenceHardware(referenceFile) : undefined;

const root = fileURLToPath(new URL('../../', import.meta.url));
const scratch = await mkdtemp(path.join(os.tmpdir(), 'tinycad-electron-classroom-'));
const names = Array.from({ length: count }, (_, index) => `Classroom-${index + 1}.dpn`);
const sampler = createWorkingSetSampler();
let electron;
try {
  await Promise.all(names.map((name) => copyFile(fixture, path.join(scratch, name))));
  const env = { ...process.env, ELECTRON_IS_DEV: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  electron = await _electron.launch({
    ...(env.TINYCAD_TEST_ELECTRON ? { executablePath: env.TINYCAD_TEST_ELECTRON } : {}),
    args: [root, '--user-data-dir=' + path.join(scratch, 'profile'),
      '--host-resolver-rules=MAP * ~NOTFOUND', '--lang=en-US',
      ...(software ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])],
    env,
  });
  const page = await electron.firstWindow();
  page.setDefaultTimeout(12000);
  await page.route('**/*', (route) => route.request().url().startsWith('file:')
    ? route.continue() : route.abort());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.message() === 'Discard unsaved edits to the current PCB?'
    ? dialog.accept() : dialog.dismiss());
  const cdp = await page.context().newCDPSession(page);
  const workingSets = async () => sampler.sample(await electron.evaluate(({ app }) =>
    app.getAppMetrics().map(({ pid: id, type }) => ({ id, type }))));
  const measurements = [];
  const memoryTasks = [];
  const samples = [];
  async function snapshot(name) {
    measurements.push({
      name,
      heap: await cdp.send('Runtime.getHeapUsage'),
      processes: await workingSets(),
      workers: page.workers().map((worker) => worker.url()),
    });
  }
  const workspace = (name) => page.getByRole('button', { name, exact: true });
  await workspace('PCB Design').click();
  const drawing = page.getByRole('img', { name: 'Board layout' });
  await drawing.waitFor();
  await snapshot('PCB Design before classroom open');
  const runtime = await electron.evaluate(async ({ app, screen }) => {
    const { size, scaleFactor } = screen.getPrimaryDisplay();
    const gpu = await app.getGPUInfo('complete');
    return {
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      platform: process.platform,
      display: { widthPx: Math.round(size.width * scaleFactor),
        heightPx: Math.round(size.height * scaleFactor), scaleFactor },
      graphics: gpu.auxAttributes?.glRenderer ?? null,
      graphicsDevices: gpu.gpuDevice ?? gpu.devices ?? [],
      graphicsFeatures: app.getGPUFeatureStatus(),
    };
  });
  if (referenceHost) {
    const evidence = await referenceWindowEvidence(page);
    assertReferenceDisplay(runtime.display);
    assertReferenceGraphics(evidence, {
      renderer: runtime.graphics,
      devices: runtime.graphicsDevices,
      features: runtime.graphicsFeatures,
    });
    runtime.referenceLaptop = referenceHost;
    runtime.webGLRenderer = evidence.renderer;
  }
  async function openFixture(name) {
    const began = performance.now();
    const rendererStarted = await page.evaluate(() => performance.now());
    await electron.evaluate(({ BrowserWindow, dialog, Menu }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
      const file = Menu.getApplicationMenu().items.find(({ label }) => label.replaceAll('&', '') === 'File');
      const open = file?.submenu.items.find(({ label }) => label.replaceAll('&', '') === 'Open');
      if (!open?.enabled) throw new Error('The native Open command is unavailable.');
      open.click(open, BrowserWindow.getAllWindows()[0], {});
    }, path.join(scratch, name));
    const rendered = await page.waitForFunction((title) => document.title === title &&
      document.querySelector('[aria-label="Board layout"] [data-track]'), 'TinyCAD - ' + name);
    await rendered.dispose();
    const openMs = await drawing.evaluate((_, started) =>
      new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now() - started))), rendererStarted);
    return { openMs, openHarnessMs: performance.now() - began };
  }
  for (const name of names) {
    const measurePhase = async (phase, task) => {
      const { result, memory } = await sampleProcessTask(workingSets, task, 100);
      memoryTasks.push([name + ' ' + phase, memory]);
      return result;
    };
    samples.push(await measureClassroom(page, openFixture, name,
      (phase) => snapshot(name + ' ' + phase), measurePhase));
    await snapshot(name + ' checked');
  }
  const repeat = await sampleProcessTask(workingSets, () => measureDesignCheck(page), 100);
  memoryTasks.push(['repeat design check', repeat.memory]);
  await workspace('Circuit Design').click();
  await drawing.waitFor({ state: 'hidden' });
  await cdp.send('HeapProfiler.collectGarbage');
  await snapshot('Circuit Design after forced GC');
  if (measurements.at(-1).workers.some((url) => /\/board\.worker\./.test(url)))
    errors.push('A PCB worker remained after returning to Circuit Design.');
  if ([...samples, repeat.result].some(({ findings }) => findings !== 0))
    errors.push('A classroom design check reported findings.');

  const report = {
    runtime: { ...runtime, softwareRenderingRequested: software, node: process.version, cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), viewport: await page.evaluate(() => ({
        width: innerWidth, height: innerHeight,
      })) },
    fixture,
    samples,
    statistics: Object.fromEntries(Object.keys(samples[0]).filter((key) => key !== 'counts')
      .map((key) => [key, stats(samples.flatMap((sample) => sample[key]))])),
    repeatDesignCheck: repeat.result,
    measurements,
    memoryTasks: Object.fromEntries(memoryTasks),
    observedMemory: observedMemory(measurements, memoryTasks),
    errors,
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(output);
  if (errors.length) process.exitCode = 1;
} finally {
  sampler.close();
  try {
    await electron?.close();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
