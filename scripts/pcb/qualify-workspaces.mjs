import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { measureCheckDuringRefill, measureClassroom, measureClassroomLocalEdit, measureDesignCheck, stats } from './classroom-performance.mjs';
import { measureClassroomPresentation } from './classroom-presentation.mjs';
import { createWorkingSetSampler, observedMemory, sampleProcessTask } from './g0-resource-monitor.mjs';
import { readReferenceHardware, referenceBrowserEvidence } from './reference-hardware.mjs';
import { installClassroomWorkerMemoryProbe, measureClassroomWorkerMemory } from './classroom-worker-memory.mjs';

const args = process.argv.slice(2);
const mockDrive = args.includes('--mock-drive');
const measureMemory = args.includes('--measure-memory');
const checkDuringRefill = args.includes('--check-during-refill');
const tracePresentation = args.includes('--classroom-presentation');
const localEditFeedback = args.includes('--classroom-local-edit');
const traceRetention = args.includes('--classroom-retention');
const traceWorkerMemory = args.includes('--classroom-worker-memory');
const fixtureArgument = (flag) =>
  args.find((arg) => arg.startsWith(flag + '='))?.slice(flag.length + 1);
const referenceIndex = args.indexOf('--reference-host');
const referenceFile = referenceIndex < 0
  ? fixtureArgument('--reference-host')
  : args.splice(referenceIndex, 2)[1];
if (referenceIndex >= 0 && (!referenceFile || referenceFile.startsWith('--')))
  throw new Error('Provide the hardware JSON file with --reference-host.');
const referenceHost = referenceFile === undefined ? undefined : await readReferenceHardware(referenceFile);
const requestedChannel = fixtureArgument('--channel');
if (referenceHost && requestedChannel !== undefined && requestedChannel !== referenceHost.stableBrowser)
  throw new Error('Use the stable browser channel recorded in the reference hardware file.');
const channel = referenceHost?.stableBrowser ?? requestedChannel;
const headless = !referenceHost && !args.includes('--headed');
const locale = 'en-US';
if (channel !== undefined && !['chrome', 'msedge', 'chromium'].includes(channel))
  throw new Error('Use --channel=chrome, --channel=msedge or --channel=chromium.');
const stepBoard = fixtureArgument('--step-board');
const classroomBoard = fixtureArgument('--classroom-board');
if (tracePresentation && !classroomBoard)
  throw new Error('Use --classroom-presentation with --classroom-board.');
if (localEditFeedback && !classroomBoard)
  throw new Error('Use --classroom-local-edit with --classroom-board.');
if (traceRetention && (!classroomBoard || !measureMemory))
  throw new Error('Use --classroom-retention with --classroom-board and --measure-memory.');
if (traceWorkerMemory && !classroomBoard)
  throw new Error('Use --classroom-worker-memory with --classroom-board.');
const classroomEntry = fixtureArgument('--classroom-entry');
if (classroomEntry !== undefined &&
    (!['direct', 'switched', 'inspected'].includes(classroomEntry) || !classroomBoard || !measureMemory))
  throw new Error('Use --classroom-entry=direct, switched or inspected with --classroom-board and --measure-memory.');
if (checkDuringRefill && (!measureMemory || !classroomBoard))
  throw new Error('Use --check-during-refill with --measure-memory and --classroom-board.');
const classroomSamples = Number(fixtureArgument('--classroom-samples') ?? 1);
const coldSamples = Number(fixtureArgument('--cold-samples') ?? 1);
if (!Number.isSafeInteger(classroomSamples) || classroomSamples < 1 || classroomSamples > 20 ||
    (classroomSamples > 1 && !classroomBoard))
  throw new Error('Use 1–20 classroom samples with --classroom-board.');
if (!Number.isSafeInteger(coldSamples) || coldSamples < 1 || coldSamples > 20)
  throw new Error('Use 1–20 cold-start samples per workspace.');
const camBoard = fixtureArgument('--cam-board');
const camBundle = fixtureArgument('--cam-bundle');
const releaseReview = fixtureArgument('--release-review');
if (releaseReview && !camBoard)
  throw new Error(
    'Release review qualification requires --cam-board and --cam-bundle.',
  );
const kicadBoard = fixtureArgument('--kicad-board');
const kicadBundle = fixtureArgument('--kicad-bundle');
if (classroomEntry && (stepBoard || camBoard || kicadBoard))
  throw new Error('The dedicated classroom memory run uses only the classroom board.');
if (Boolean(kicadBoard) !== Boolean(kicadBundle))
  throw new Error('Use --kicad-board and --kicad-bundle together.');
if (Boolean(camBoard) !== Boolean(camBundle))
  throw new Error('Use --cam-board and --cam-bundle together.');
const [buildDirectory, output] = args.filter((arg) => !arg.startsWith('--'));
const stepFixture = stepBoard && (await readFile(stepBoard));
const classroomFixture = classroomBoard && (await readFile(classroomBoard));
const camFixture = camBoard && (await readFile(camBoard));
const kicadFixture = kicadBoard && (await readFile(kicadBoard));
if ((classroomFixture || camFixture || kicadFixture) && mockDrive)
  throw new Error('The PCB file picker fixtures require the filesystem build.');
const dist = path.resolve(buildDirectory ?? 'dist');
const reportPath = path.resolve(
  output ?? 'build/qualification/pcb-workspaces.json',
);
await readFile(path.join(dist, 'index.html'));
const mime = new Map([
  ['.html', 'text/html'],
  ['.css', 'text/css'],
  ['.js', 'text/javascript'],
  ['.json', 'application/json'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
]);
const fixtures = new Map([
  ['/qualification/Inspection.dpn', stepFixture],
  ['/qualification/CAM.dpn', camFixture],
  ['/qualification/Interchange.dpn', kicadFixture],
]);
const classroomFiles = Array.from({ length: classroomSamples }, (_, index) =>
  index === 0 ? 'Classroom.dpn' : 'Classroom-' + (index + 1) + '.dpn');
for (const name of classroomFiles) fixtures.set('/qualification/' + name, classroomFixture);
const server = createServer(async (request, response) => {
  try {
    const { pathname } = new URL(request.url, 'http://localhost');
    const fixture = fixtures.get(pathname);
    if (fixture) {
      response
        .writeHead(200, { 'Content-Type': 'application/octet-stream' })
        .end(fixture);
      return;
    }
    const requested = path.resolve(
      dist,
      '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname),
    );
    if (!requested.startsWith(dist + path.sep)) {
      response.writeHead(403).end();
      return;
    }
    const content = await readFile(requested);
    response
      .writeHead(200, {
        'Content-Type':
          mime.get(path.extname(requested)) ?? 'application/octet-stream',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
      })
      .end(content);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
const workspaceNames = {
  circuit: 'Circuit Design',
  pcb: 'PCB Design',
  simulation: 'Circuit Design + Simulation',
};
const inspectionAssets =
  /\/(?:BoardInspectionDialog|boardInspectionJob|occt-import-js|stepEngine)\./i;
const kicadDialogAsset = /\/KicadExportDialog\./i;
const pcbAssets =
  /\/(?:BoardWorkspace|board\.worker|clipper2z|BoardCamDialog)\./i;
const simulationAssets =
  /\/(?:SimulationSheet|ChartWorkspace|engine\.worker|ngspice[^/]*|SpiceControlPanel)\./i;

const chartAssets = /\/(?:Waveform|StudyHistogram)\./i;

async function waitForBoardJob(dialog, ready, job) {
  const alert = dialog.getByRole('alert').first();
  await ready.or(alert).first().waitFor();
  if (await alert.isVisible())
    throw new Error(job + ' failed. ' + await alert.innerText());
}

let browser;
let memorySampler;
const runs = [];
try {
  browser = await chromium.launch({ channel, headless });
  const browserSession = await browser.newBrowserCDPSession();
  const reference = referenceHost ? await referenceBrowserEvidence(browser, browserSession) : undefined;
  const graphics = reference
    ? reference.renderer
    : (await browserSession.send('SystemInfo.getInfo')).gpu.auxAttributes?.glRenderer ?? null;
  if (measureMemory) memorySampler = createWorkingSetSampler();
  async function workingSets(includeProportionalBacking = false) {
    const { processInfo } = await browserSession.send('SystemInfo.getProcessInfo');
    return memorySampler.sample(processInfo, includeProportionalBacking);
  }
  const entryWorkspaces = classroomEntry ? ['pcb'] : Object.keys(workspaceNames);
  const entries = Array.from({ length: coldSamples }, (_, index) =>
    entryWorkspaces.map((workspace) => ({ workspace, trial: index + 1 }))).flat();
  for (const { workspace, trial } of entries) {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      locale,
    });
    const resources = [];
    const workers = [];
    const workerRecords = new Map();
    const errors = [];
    const classroomRetention = traceRetention && classroomFixture && workspace === 'pcb' ? [] : undefined;
    let stage = 'cold';
    let page;
    try {
      if (traceWorkerMemory && workspace === 'pcb' && trial === 1)
        await context.addInitScript(installClassroomWorkerMemoryProbe);
      if (mockDrive) {
        await context.route('https://**/*', (route) => route.abort());
        await context.route(
          'https://www.googleapis.com/drive/v3/**',
          (route) => {
            const url = new URL(route.request().url());
            if (stepFixture && url.pathname.endsWith('/files/inspection')) {
              if (url.searchParams.get('alt') === 'media')
                return route.fulfill({
                  body: stepFixture,
                  contentType: 'application/xml',
                });
              return route.fulfill({ json: { version: '1' } });
            }
            return route.fulfill({ json: { files: [] } });
          },
        );
        if (stepFixture) {
          await context.route(
            'https://www.googleapis.com/drive/v2/files/inspection',
            (route) =>
              route.fulfill({
                json: { title: 'Inspection.dpn', id: 'inspection' },
              }),
          );
        }
        await context.addInitScript(() => {
          const user = {
            getBasicProfile: () => ({
              getId: () => 'workspace-qualification',
              getName: () => 'Workspace qualification',
              getImageUrl: () => '',
              getEmail: () => 'qualification@example.test',
            }),
            getAuthResponse: () => ({ access_token: 'qualification-fixture' }),
          };
          window.gapi = {
            load: (_, callback) => callback(),
            auth2: {
              init: async () => {},
              getAuthInstance: () => ({
                signIn: async () => user,
                currentUser: { get: () => user },
              }),
            },
          };
        });
      }
      if (!mockDrive && [...fixtures.values()].some(Boolean)) {
        await context.addInitScript(() => {
          window.showOpenFilePicker = async () => {
            const name = window.qualificationBoardName;
            return [
              {
                name,
                getFile: async () =>
                  new File(
                    [
                      await (
                        await fetch(
                          '/qualification/' + encodeURIComponent(name),
                        )
                      ).arrayBuffer(),
                    ],
                    name,
                  ),
              },
            ];
          };
        });
      }
      page = await context.newPage();
      page.setDefaultTimeout(12000);
      const cdp = await context.newCDPSession(page);
      context.on('response', (response) => {
        resources.push({
          stage,
          status: response.status(),
          url: response.url(),
          type: response.request().resourceType(),
        });
      });
      page.on('worker', (worker) => {
        const record = { stage, url: worker.url(), name: '', closedDuring: null };
        workers.push(record);
        workerRecords.set(worker, record);
        worker.on('close', () => {
          record.closedDuring = stage;
        });
      });
      page.on('pageerror', (error) => errors.push(error.message));
      const snapshot = async (name, includeProportionalBacking = false) => {
        const heap = await cdp.send('Runtime.getHeapUsage');
        const runningWorkers = await Promise.all(page.workers().map(async (worker) => {
          const record = workerRecords.get(worker);
          let workerName = record?.name;
          if (!workerName) {
            workerName = await worker.evaluate(() => self.name).catch(() => '');
            if (record) record.name = workerName;
          }
          return { name: workerName, url: worker.url() };
        }));
        return {
          name,
          heap,
          ...(measureMemory ? { processes: await workingSets(includeProportionalBacking) } : {}),
          ...(await page.evaluate(() => ({
            nodes: document.getElementsByTagName('*').length,
            resources: performance.getEntriesByType('resource').length,
          }))),
          workerCount: runningWorkers.length,
          workerUrls: runningWorkers.map(({ url }) => url),
          runningWorkers,
        };
      };
      const retainedSnapshot = async (name) => {
        await cdp.send('HeapProfiler.collectGarbage');
        return { ...await snapshot(name, traceRetention), dom: await cdp.send('Memory.getDOMCounters') };
      };
      const workspaceButton = (name) =>
        page.getByRole('button', {
          name: workspaceNames[name],
          exact: true,
        });
      const ready = async (name) => {
        await workspaceButton(name)
          .and(page.getByRole('button', { pressed: true }))
          .waitFor();
        if (name === 'pcb') {
          await page.getByRole('img', { name: 'Board layout' }).waitFor();
        } else if (name === 'simulation') {
          await page.getByLabel('Simulation charts', { exact: true }).waitFor();
        } else {
          await page.locator('.circuit-drawing svg').first().waitFor();
        }
      };

      const began = performance.now();
      const entry = workspace === 'circuit' ? '/' : '/?workspace=' + workspace;
      await page.goto(origin + entry);
      await ready(workspace);
      const readyMs = performance.now() - began;
      await page.waitForLoadState('networkidle');
      const measurements = [await snapshot('cold idle')];
      const coldResources = resources.filter(({ stage }) => stage === 'cold');
      const unexpected = coldResources.filter(
        ({ url }) =>
          inspectionAssets.test(url) ||
          chartAssets.test(url) ||
          kicadDialogAsset.test(url) ||
          (workspace !== 'pcb' && pcbAssets.test(url)) ||
          (workspace !== 'simulation' && simulationAssets.test(url)),
      );
      if (trial > 1) {
        runs.push({
          workspace, trial, entry, readyMs, measurements, workers, resources,
          ...(measureMemory ? { observedMemory: observedMemory(measurements) } : {}),
          unexpectedColdResources: unexpected.map(({ url }) => url), errors,
        });
        continue;
      }

      if (classroomEntry !== 'direct') {
        stage = 'switches';
        for (let loop = 0; loop < 3; loop++) {
          for (const next of ['pcb', 'simulation', 'circuit']) {
            await workspaceButton(next).click();
            await ready(next);
            measurements.push(await snapshot(`loop ${loop + 1} ${next}`));
          }
        }

        stage = 'pcb checks';
        await workspaceButton('pcb').click();
        await ready('pcb');
        await page.getByRole('button', { name: 'Run design checks…' }).click();
        const dialog = page.getByRole('region', { name: 'PCB design checks' });
        const result = dialog.getByRole('table', { name: 'PCB findings' });
        await waitForBoardJob(dialog, result, 'PCB design checks');
        const findings = await result.locator('tbody > tr').allTextContents();
        if (findings.length) throw new Error('Empty PCB reported findings. ' + findings.join(' '));
        const checkedBoard = await snapshot('PCB checks ready');
        if (checkedBoard.runningWorkers.some(({ name }) => name === 'tinycad-schematic-netlist'))
          throw new Error('The schematic netlist worker remained active in PCB Design.');
        measurements.push(checkedBoard);
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      }
      const inspection = page.getByRole('dialog', { name: '3D board inspection' });
      if (!classroomEntry || classroomEntry === 'inspected') {
        stage = '3D inspection';
        await page.getByRole('button', { name: 'Inspect in 3D…' }).click();
        await waitForBoardJob(inspection, inspection.getByText(/Assumed board thickness/), '3D inspection');
        measurements.push(await snapshot('3D inspection ready'));
        await inspection
          .getByRole('button', { name: 'Close', exact: true })
          .click();
        if (
          workers.some(
            ({ stage: started, closedDuring, url }) =>
              started === '3D inspection' &&
              /\/board\.worker\./.test(url) &&
              !closedDuring,
          )
        )
          errors.push('A 3D worker remained open after closing inspection.');
      }

      async function openFixture(name) {
        if (!classroomEntry) {
          await workspaceButton('circuit').click();
          await ready('circuit');
        }
        await page.evaluate((name) => {
          window.qualificationBoardName = name;
        }, name);
        await page.getByRole('button', { name: 'File', exact: true }).click();
        const replaceCurrent = (dialog) => {
          if (dialog.message() === 'Discard unsaved edits to the current PCB?')
            return dialog.accept();
          return dialog.dismiss();
        };
        const open = page.getByRole('menuitem', { name: 'Open', exact: true });
        const timing = await open.evaluateHandle((item, basename) => {
          let frame;
          const expectedTitle = 'TinyCAD - ' + basename;
          const result = {
            openMs: undefined,
            dispose() {
              item.removeEventListener('click', begin, true);
              cancelAnimationFrame(frame);
            },
          };
          function begin() {
            const startedAt = performance.now();
            function check() {
              const drawing = document.querySelector(
                'section[aria-label="PCB layout"] svg[aria-label="Board layout"] [data-svg-drawing]:not([visibility="hidden"])',
              );
              if (document.title === expectedTitle && drawing)
                result.openMs = performance.now() - startedAt;
              else frame = requestAnimationFrame(check);
            }
            frame = requestAnimationFrame(check);
          }
          item.addEventListener('click', begin, { capture: true, once: true });
          return result;
        }, name);
        page.on('dialog', replaceCurrent);
        const startedAt = performance.now();
        try {
          await open.click();
          await page.waitForFunction((probe) => probe.openMs !== undefined, timing, { timeout: 30_000 });
          return {
            openMs: await timing.evaluate((probe) => probe.openMs),
            openHarnessMs: performance.now() - startedAt,
          };
        } finally {
          page.off('dialog', replaceCurrent);
          await timing.evaluate((probe) => probe.dispose()).catch(() => {});
          await timing.dispose();
        }
      }

      if (stepFixture && workspace === 'pcb') {
        stage = 'standalone STEP inspection';
        if (mockDrive) {
          const state = JSON.stringify({ action: 'open', ids: ['inspection'] });
          await page.goto(origin + '/?state=' + encodeURIComponent(state));
          await page
            .getByText('Inspection.dpn', { exact: true })
            .last()
            .waitFor();
          await ready('pcb');
        } else {
          await openFixture('Inspection.dpn');
        }
        await page.getByRole('button', { name: 'Inspect in 3D…' }).click();
        const model = inspection.getByText(/Generated STEP envelope|Imported STEP/).first();
        await waitForBoardJob(inspection, model, 'Embedded STEP inspection');
        measurements.push(await snapshot('embedded STEP displayed'));
        await inspection
          .getByRole('button', { name: 'Close', exact: true })
          .click();
      }

      if (camFixture && workspace === 'pcb') {
        stage = 'standalone CAM preview';
        await openFixture('CAM.dpn');
        await page
          .getByRole('button', { name: 'CAM read-back preview…' })
          .click();
        const preview = page.getByRole('dialog', {
          name: 'CAM read-back preview',
        });
        const ready = preview.getByText(/Gerber and drill read-back matched revision/);
        await waitForBoardJob(preview, ready, 'CAM preview');
        const layerPicker = preview.getByLabel('CAM layer');
        const layers = await layerPicker.locator('option').evaluateAll((options) =>
          options.map(({ value, label }) => ({ value, label })),
        );
        if (!layers.length) throw new Error('CAM preview has no artwork layers.');
        const download = page.waitForEvent('download');
        await preview
          .getByRole('button', { name: 'Download preview bundle…' })
          .click();
        await (await download).saveAs(camBundle);
        measurements.push(await snapshot('CAM preview downloaded'));
        if (releaseReview) {
          await preview
            .getByText(/Manufacturing review · .* release blockers/)
            .click();
          for (const { value, label } of layers) {
            await layerPicker.selectOption(value);
            await preview.getByRole('img', { name: 'CAM read-back' }).waitFor();
            await preview.getByLabel(label + ' reviewed', { exact: true }).check();
          }
          await preview
            .getByLabel('Outline and both drill files reviewed', {
              exact: true,
            })
            .check();
          await preview
            .getByLabel(
              'Normalize archive timestamps for reproducible builds',
              { exact: true },
            )
            .check();

          const archive = page.waitForEvent('download');
          await preview
            .getByRole('button', { name: 'Download release review…' })
            .click();
          await (await archive).saveAs(releaseReview);
          measurements.push(await snapshot('manufacturing review downloaded'));
        }
        await preview
          .getByRole('button', { name: 'Close', exact: true })
          .click();
      }

      if (kicadFixture && workspace === 'pcb') {
        stage = 'standalone KiCad export';
        await openFixture('Interchange.dpn');
        await page.getByRole('button', { name: 'Export KiCad board…' }).click();
        const preview = page.getByRole('dialog', {
          name: 'Export KiCad board',
        });
        const downloadButton = preview.getByRole('button', { name: 'Download KiCad bundle…' });
        await waitForBoardJob(preview, downloadButton, 'KiCad export');
        const download = page.waitForEvent('download');
        await downloadButton.click();
        await (await download).saveAs(kicadBundle);
        measurements.push(await snapshot('KiCad export downloaded'));
        await preview
          .getByRole('button', { name: 'Close', exact: true })
          .click();
      }

      let classroom;
      if (classroomFixture && workspace === 'pcb') {
        stage = 'before classroom open';
        if (classroomEntry && resources.some(({ url }) => chartAssets.test(url)))
          errors.push('The empty-workspace probes loaded a simulation chart renderer.');
        if (measureMemory) measurements.push(await snapshot(stage));
        if (classroomRetention) classroomRetention.push(await retainedSnapshot(stage));
        const samples = [];
        const phaseMemory = { routing: [], refill: [], check: [] };
        const measurePhase = measureMemory ? async (phase, task) => {
          const { result, memory } = await sampleProcessTask(workingSets, task, 100);
          phaseMemory[phase].push(memory);
          return result;
        } : undefined;
        for (const [index, name] of classroomFiles.entries()) {
          stage = 'classroom board ' + (index + 1);
          const checkpoint = measureMemory ? async (phase) => {
            measurements.push(await snapshot(stage + ' ' + phase));
          } : undefined;
          samples.push(await measureClassroom(page, openFixture, name, checkpoint, measurePhase));
          measurements.push(await snapshot(stage + ' checked'));
          if (classroomRetention) classroomRetention.push(await retainedSnapshot(stage + ' checked'));
        }
        const metrics = [
          'openMs', 'openHarnessMs', 'refillAfterOpenMs', 'explicitRefillMs', 'checksMs', 'cancelFillMs',
          'selectionMs', 'routeReadyMs', 'routePreviewMs', 'routeLongTaskMs', 'checkLongTaskMs', 'zoomFrameMs',
          'panFrameMs', 'cancelWorkerCloseMs', 'routePreparationWorkerCloseMs',
        ];
        classroom = {
          samples,
          ...(measureMemory ? {
            routingMemory: phaseMemory.routing,
            refillMemory: phaseMemory.refill,
            checkMemory: phaseMemory.check,
          } : {}),
          statistics: Object.fromEntries(metrics.map((metric) =>
            [metric, stats(samples.flatMap((sample) => sample[metric]))])),
        };
      }

      let classroomMemory;
      if (measureMemory && classroomFixture && workspace === 'pcb') {
        stage = 'classroom memory';
        const { result, memory } = await sampleProcessTask(
          workingSets, () => measureDesignCheck(page), 100,
        );
        classroomMemory = { ...memory, checksMs: result.checksMs, findings: result.findings };
      }

      let refillCheck;
      if (checkDuringRefill && workspace === 'pcb') {
        stage = 'design check during refill';
        const { result, memory } = await sampleProcessTask(
          workingSets, () => measureCheckDuringRefill(page), 100,
        );
        refillCheck = { ...result, memory };
      }

      let classroomPresentation;
      if (tracePresentation && workspace === 'pcb') {
        stage = 'classroom compositor presentation';
        classroomPresentation = await measureClassroomPresentation(page, cdp);
      }
      let classroomLocalEdit;
      if (localEditFeedback && workspace === 'pcb') {
        stage = 'classroom edit feedback';
        classroomLocalEdit = await measureClassroomLocalEdit(page);
      }

      let classroomWorkerMemory;
      if (traceWorkerMemory && workspace === 'pcb') {
        stage = 'classroom worker memory';
        classroomWorkerMemory = await measureClassroomWorkerMemory(page, browserSession);
      }

      stage = 'retained';
      await workspaceButton('circuit').click();
      await ready('circuit');
      const retained = await retainedSnapshot('circuit after forced GC');
      measurements.push(retained);
      const retainedWorkspaceWorker = retained.runningWorkers.find(({ name, url }) =>
        name === 'tinycad-pcb' || name === 'tinycad-simulation' ||
        /\/(?:board|engine)\.worker\./.test(url));
      if (retainedWorkspaceWorker)
        errors.push('A workspace worker remained open after returning to Circuit Design: ' + retainedWorkspaceWorker.url);
      if (classroomRetention) {
        classroomRetention.push(retained);
        stage = 'return to the classroom board';
        await workspaceButton('pcb').click();
        await ready('pcb');
        const board = page.getByRole('region', { name: 'PCB layout' });
        await board.getByText('Zones filled.', { exact: true }).waitFor();
        const currentCount = await board.locator('[data-track]').count();
        const title = (await page.title()).replace(/\*$/, '');
        if (title !== 'TinyCAD - ' + classroomFiles.at(-1) ||
          currentCount !== classroom.samples.at(-1).counts.tracks)
          errors.push('The last classroom PCB did not reopen with its tracks when switching workspaces.');
        classroomRetention.push(await retainedSnapshot(stage));

        stage = 'after closing the classroom board';
        const discard = (dialog) => dialog.message() === 'Discard unsaved PCB edits?'
          ? dialog.accept() : dialog.dismiss();
        page.on('dialog', discard);
        try {
          await board.getByRole('button', { name: 'Close', exact: true }).click();
          await board.waitFor({ state: 'hidden' });
        } finally {
          page.off('dialog', discard);
        }
        await ready('circuit');
        const closed = await retainedSnapshot(stage);
        classroomRetention.push(closed);
        if (closed.runningWorkers.some(({ name }) => name === 'tinycad-pcb'))
          errors.push('A PCB worker remained open after closing the classroom board.');
      }
      const memoryTasks = [
        ['route preview', classroom?.routingMemory],
        ['zone refill', classroom?.refillMemory],
        ['design check', classroom?.checkMemory],
      ].flatMap(([name, samples]) => (samples ?? []).map((sample, index) => [
        'classroom board ' + (index + 1) + ' ' + name, sample,
      ]));
      if (classroomMemory) memoryTasks.push(['classroom repeat design check', classroomMemory]);
      if (refillCheck) memoryTasks.push(['design check during refill', refillCheck.memory]);
      runs.push({
        workspace,
        trial,
        entry,
        readyMs,
        classroom,
        classroomMemory,
        classroomPresentation,
        classroomLocalEdit,
        classroomRetention,
        classroomWorkerMemory,
        refillCheck,
        measurements,
        ...(measureMemory ? { observedMemory: observedMemory(measurements, memoryTasks) } : {}),
        workers,
        resources,
        unexpectedColdResources: unexpected.map(({ url }) => url),
        errors,
      });
    } catch (error) {
      runs.push({
        workspace,
        trial,
        stage,
        error: String(error),
        errors,
        classroomRetention,
        workers,
        resources,
        alerts: await page
          ?.getByRole('alert')
          .allTextContents()
          .catch(() => []),
      });
    } finally {
      await context.close();
    }
  }
  const report = {
    runtime: {
      browser: browser.version(),
      node: process.version,
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      logicalCpus: os.cpus().length,
      availableCpus: os.availableParallelism(),
      cpu: os.cpus()[0]?.model,
      memoryBytes: os.totalmem(),
      viewport: { width: 1920, height: 1080 },
      headless,
      locale,
      channel: channel ?? (headless ? 'Playwright Chromium headless shell' : 'Playwright bundled Chromium'),
      graphics,
      ...(referenceHost ? {
        referenceLaptop: referenceHost, referenceDisplay: reference.display,
        graphicsDevices: reference.devices, graphicsFeatures: reference.features,
        webGLRenderer: reference.webGLRenderer,
      } : {}),
    },
    dist,
    stepBoard: stepBoard ?? null,
    classroomBoard: classroomBoard ?? null,
    classroomEntry: classroomEntry ?? null,
    camBoard: camBoard ?? null,
    camBundle: camBundle ?? null,
    releaseReview: releaseReview ?? null,
    kicadBoard: kicadBoard ?? null,
    kicadBundle: kicadBundle ?? null,
    authentication: mockDrive ? 'mocked Google Drive' : 'none',
    startup: Object.fromEntries(Object.keys(workspaceNames).map((workspace) => [workspace,
      stats(runs.filter((run) => run.workspace === workspace && !run.error).map((run) => run.readyMs)),
    ])),
    coverage: [
      'One new browser context per cold entry within one Chromium process.',
      'Heap samples cover the renderer V8 target. They do not measure process RSS, worker heaps or GPU memory.',
      ...(classroomEntry ? [
        'Dedicated classroom run starts in PCB Design in a fresh Chromium process.',
        ...(classroomEntry === 'direct' ? [] : ['Three empty-workspace cycles and an empty PCB check before classroom file open.']),
        ...(classroomEntry === 'inspected' ? ['3D inspection of the empty board before classroom file open.'] : []),
      ] : ['Repeated empty-workspace switches, a PCB check and 3D inspection of the bare board.']),
      ...(measureMemory ? [
        'Process working sets come from the isolated Chromium instance. Renderer memory includes workers hosted by that process. Summing working sets can count shared pages more than once. The GPU process working set excludes dedicated GPU memory. On Linux, proportional set size apportions shared pages across the processes that map them when procfs permits the read.',
        'Process memory is sampled separately during routing, refill, the first check after refill and a repeat check. Each task records a pre-task snapshot and the start and completion of each sample. Peaks use samples that finished before the task did. A missing peak means no eligible sample was captured.',
        'The observed memory summary reports the highest completed task sample or workspace snapshot for each metric, with its phase. Presentation and local edit feedback are timed separately.',
      ] : []),
      ...(classroomFixture ? [
        'Classroom file opens and full checks use warmed application dependencies in a single browser context. The distinct filenames each load the same board bytes. Open time is measured in the page from the Open command click to the first animation frame with the named board drawing visible. Harness time also includes automation overhead.',
        'Selection, route and zoom delays measure event dispatch through observable SVG or inspector updates. Pan records consecutive animation-frame intervals while processing 60 SVG position changes. These are browser callback intervals, not compositor presentation times.',
        'Cancellation records UI acknowledgement and the geometry worker close event observed through Playwright, including IPC latency.',
      ] : []),
      ...(tracePresentation ? [
        'Compositor measurements use Chromium PipelineReporter presentation feedback during separate pan and zoom input windows. Unavailable feedback is recorded explicitly.',
      ] : []),
      ...(localEditFeedback ? [
        'Local edit feedback measures five route continuations from the Finish route command to the first pending message or committed track, and separately to the committed track.',
      ] : []),
      ...(traceRetention ? [
        'Classroom retention snapshots use forced garbage collection and record renderer heap, live DOM counters, workers and process memory. The final samples switch away from an open PCB, return to it, then explicitly close it. These diagnostic samples are separate from task peak reporting.',
      ] : []),
      ...(traceWorkerMemory ? [
        'The worker memory diagnostic repeats a design check after timing. It records the completed PCB worker’s V8 heap and Clipper’s WASM capacity before stopping that worker. This is a completion sample.',
      ] : []),
    ],
    runs,
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(reportPath);
  if (
    runs.some(
      (run) =>
        run.error || run.errors.length || run.unexpectedColdResources.length,
    )
  )
    process.exitCode = 1;
} finally {
  memorySampler?.close();
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
