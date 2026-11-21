import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { measureClassroom, stats } from './classroom-performance.mjs';

const args = process.argv.slice(2);
const mockDrive = args.includes('--mock-drive');
const fixtureArgument = (flag) =>
  args.find((arg) => arg.startsWith(flag + '='))?.slice(flag.length + 1);
const channel = fixtureArgument('--channel');
const headless = !args.includes('--headed');
if (channel !== undefined && !['chrome', 'msedge', 'chromium'].includes(channel))
  throw new Error('Use --channel=chrome, --channel=msedge or --channel=chromium.');
const stepBoard = fixtureArgument('--step-board');
const classroomBoard = fixtureArgument('--classroom-board');
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

let browser;
const runs = [];
try {
  browser = await chromium.launch({ channel, headless });
  const browserSession = await browser.newBrowserCDPSession();
  const { gpu } = await browserSession.send('SystemInfo.getInfo');
  await browserSession.detach();
  const entries = Array.from({ length: coldSamples }, (_, index) =>
    Object.keys(workspaceNames).map((workspace) => ({ workspace, trial: index + 1 }))).flat();
  for (const { workspace, trial } of entries) {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    const resources = [];
    const workers = [];
    const workerRecords = new Map();
    const errors = [];
    let stage = 'cold';
    let page;
    try {
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
      const snapshot = async (name) => {
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
          ...(await page.evaluate(() => ({
            nodes: document.getElementsByTagName('*').length,
            resources: performance.getEntriesByType('resource').length,
          }))),
          workerCount: runningWorkers.length,
          workerUrls: runningWorkers.map(({ url }) => url),
          runningWorkers,
        };
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
          kicadDialogAsset.test(url) ||
          (workspace !== 'pcb' && pcbAssets.test(url)) ||
          (workspace !== 'simulation' && simulationAssets.test(url)),
      );
      if (trial > 1) {
        runs.push({
          workspace, trial, entry, readyMs, measurements, workers, resources,
          unexpectedColdResources: unexpected.map(({ url }) => url), errors,
        });
        continue;
      }

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
      const dialog = page.getByRole('dialog', { name: 'PCB design checks' });
      await dialog.getByText(/checks found no issues/).waitFor();
      measurements.push(await snapshot('PCB checks ready'));
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();

      stage = '3D inspection';
      await page.getByRole('button', { name: 'Inspect in 3D…' }).click();
      const inspection = page.getByRole('dialog', {
        name: '3D board inspection',
      });
      await inspection.getByText(/Assumed board thickness/).waitFor();
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

      async function openFixture(name) {
        await workspaceButton('circuit').click();
        await ready('circuit');
        await page.evaluate((name) => {
          window.qualificationBoardName = name;
        }, name);
        await page.getByRole('button', { name: 'File', exact: true }).click();
        const replaceCurrent = (dialog) => {
          if (dialog.message() === 'Discard unsaved edits to the current PCB?')
            return dialog.accept();
          return dialog.dismiss();
        };
        page.on('dialog', replaceCurrent);
        const start = performance.now();
        try {
          await page
            .getByRole('menuitem', { name: 'Open', exact: true })
            .click();
          await page
            .getByText(name, { exact: true })
            .last()
            .waitFor({ timeout: 30_000 });
        } finally {
          page.off('dialog', replaceCurrent);
        }
        return performance.now() - start;
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
        await inspection
          .getByText(/Generated STEP envelope|Imported STEP/)
          .first()
          .waitFor();
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
        await preview
          .getByText(/Gerber and drill read-back matched revision/)
          .waitFor();
        await preview.getByLabel('CAM layer').selectOption('silk-bottom');
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
          await preview
            .getByLabel('Bottom silkscreen reviewed', { exact: true })
            .check();
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
          await preview
            .getByRole('list', { name: 'Release blockers' })
            .waitFor();
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
        await preview
          .getByRole('list', { name: 'KiCad export notes' })
          .getByText(/zone.*could not be mapped/i)
          .waitFor();
        const download = page.waitForEvent('download');
        await preview
          .getByRole('button', { name: 'Download KiCad bundle…' })
          .click();
        await (await download).saveAs(kicadBundle);
        measurements.push(await snapshot('KiCad export downloaded'));
        await preview
          .getByRole('button', { name: 'Close', exact: true })
          .click();
      }

      let classroom;
      if (classroomFixture && workspace === 'pcb') {
        const samples = [];
        for (const [index, name] of classroomFiles.entries()) {
          stage = 'classroom board ' + (index + 1);
          samples.push(await measureClassroom(page, openFixture, name));
          measurements.push(await snapshot(stage + ' checked'));
        }
        const metrics = [
          'openMs', 'refillAfterOpenMs', 'explicitRefillMs', 'checksMs', 'cancelFillMs',
          'selectionMs', 'routeReadyMs', 'routePreviewMs', 'routeLongTaskMs', 'zoomFrameMs',
        ];
        classroom = {
          samples,
          statistics: Object.fromEntries(metrics.map((metric) =>
            [metric, stats(samples.flatMap((sample) => sample[metric]))])),
        };
      }

      stage = 'retained';
      await workspaceButton('circuit').click();
      await ready('circuit');
      await cdp.send('HeapProfiler.collectGarbage');
      const retained = await snapshot('circuit after forced GC');
      measurements.push(retained);
      const retainedWorkspaceWorker = retained.runningWorkers.find(({ name, url }) =>
        name === 'tinycad-pcb' || name === 'tinycad-simulation' ||
        /\/(?:board|engine)\.worker\./.test(url));
      if (retainedWorkspaceWorker)
        errors.push('A workspace worker remained open after returning to Circuit Design: ' + retainedWorkspaceWorker.url);
      runs.push({
        workspace,
        trial,
        entry,
        readyMs,
        classroom,
        measurements,
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
      channel: channel ?? 'Playwright bundled Chromium',
      graphics: gpu.auxAttributes?.glRenderer ?? null,
    },
    dist,
    stepBoard: stepBoard ?? null,
    classroomBoard: classroomBoard ?? null,
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
      'Repeated empty-workspace switches, a PCB check and 3D inspection of the bare board.',
      ...(classroomFixture ? [
        'Classroom file opens and full checks use warmed application dependencies in a single browser context. The distinct filenames each load the same board bytes.',
        'Selection, route and zoom delays measure event dispatch through observable SVG or inspector updates. Zoom delays are per interaction rather than a continuous presentation frame-rate measurement.',
        'Cancellation acknowledges its changed UI state. It does not time worker termination.',
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
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
