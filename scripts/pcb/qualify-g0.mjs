import assert from 'node:assert/strict';
import {
  readFile,
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, _electron } from 'playwright';
import { monitorRuntime } from './g0-resource-monitor.mjs';

const resourceMonitoring = process.argv
  .slice(2)
  .includes('--monitor-resources');
const args = process.argv
  .slice(2)
  .filter((arg) => arg !== '--monitor-resources');
if (resourceMonitoring && process.platform !== 'win32')
  throw new Error('The process resource monitor is available on Windows.');
let referenceHost;
if (args.length) {
  if (args.length !== 2 || args[0] !== '--reference-host') {
    throw new Error(
      'Usage: npm run qualify:pcb-g0 -- [--reference-host <hardware.json>] [--monitor-resources]',
    );
  }
  const reported = JSON.parse(await readFile(args[1], 'utf8'));
  assert.equal(
    typeof reported.model,
    'string',
    'Record the exact reference laptop model.',
  );
  assert(reported.model.trim(), 'Record the exact reference laptop model.');
  assert.equal(
    reported.physicalCores,
    4,
    'The reference laptop requires four physical CPU cores.',
  );
  assert.equal(
    reported.installedRamGiB,
    8,
    'The reference laptop requires 8 GiB of installed RAM.',
  );
  assert.equal(
    typeof reported.integratedGpu,
    'string',
    'Record the exact integrated GPU model.',
  );
  assert(
    reported.integratedGpu.trim(),
    'Record the exact integrated GPU model.',
  );
  assert(
    ['chrome', 'msedge'].includes(reported.stableBrowser),
    'Choose the installed stable Chrome or Edge channel.',
  );
  assert(
    os.cpus().length >= 4,
    'The running host reports fewer than four logical cores.',
  );
  assert(
    os.totalmem() <= 8 * 1024 ** 3,
    'The running host reports more usable memory than the 8 GiB reference laptop.',
  );
  assert.notEqual(
    process.env.TINYCAD_PCB_G0_NO_ELECTRON_SANDBOX,
    '1',
    'Keep the Electron sandbox enabled for the reference run.',
  );
  const {
    model,
    physicalCores,
    installedRamGiB,
    integratedGpu,
    stableBrowser,
  } = reported;
  referenceHost = {
    model,
    physicalCores,
    installedRamGiB,
    integratedGpu,
    stableBrowser,
  };
}

const require = createRequire(import.meta.url);
const scratch = path.resolve('.tmp');
await mkdir(scratch, { recursive: true });
const output = await mkdtemp(path.join(scratch, 'pcb-g0-'));
const browserBundle = path.join(output, 'worker.js');
await build({
  entryPoints: ['scripts/pcb/g0-worker.ts'],
  outfile: browserBundle,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  external: ['node:*', 'fs', 'path', 'module'],
  minify: true,
});
const clientBundle = await build({
  entryPoints: ['src/pcb/geometryRevision.ts'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  write: false,
});
const clipperPackage = path.dirname(
  require.resolve('clipper2-wasm/package.json'),
);
await copyFile(
  path.join(clipperPackage, 'dist/es/clipper2z.wasm'),
  path.join(output, 'clipper2z.wasm'),
);

const payloads = new Map([
  [
    '/',
    [
      'text/html',
      Buffer.from(
        '<!doctype html><meta charset="utf-8"><title>TinyCAD PCB G0 qualification</title>',
      ),
    ],
  ],
  ['/worker.js', ['text/javascript', await readFile(browserBundle)]],
  ['/revision.js', ['text/javascript', clientBundle.outputFiles[0].contents]],
  [
    '/clipper2z.wasm',
    ['application/wasm', await readFile(path.join(output, 'clipper2z.wasm'))],
  ],
]);
const server = createServer((request, response) => {
  const entry = payloads.get(request.url);
  if (!entry) return response.writeHead(404).end();
  response
    .writeHead(200, {
      'Content-Type': entry[0],
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    })
    .end(entry[1]);
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const url = `http://127.0.0.1:${server.address().port}`;
const observations = {};

async function attachHeapProbe(page) {
  const cdp = await page.context().newCDPSession(page);
  const workers = new Set();
  const requests = new Map();
  let ticket = 0;
  cdp.on('Target.attachedToTarget', ({ sessionId, targetInfo }) => {
    if (targetInfo.type === 'worker') workers.add(sessionId);
  });
  cdp.on('Target.detachedFromTarget', ({ sessionId }) =>
    workers.delete(sessionId),
  );
  cdp.on('Target.receivedMessageFromTarget', ({ message }) => {
    const reply = JSON.parse(message);
    requests.get(reply.id)?.(reply.result ?? null);
  });
  await cdp.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: false,
  });
  await page.exposeFunction('readWorkerHeap', async () => {
    const sessionId = [...workers].at(-1);
    if (!sessionId) return null;
    const id = ++ticket;
    let timeout;
    try {
      const reply = new Promise((resolve) => {
        requests.set(id, resolve);
        timeout = setTimeout(() => resolve(null), 1_000);
      });
      await cdp.send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({ id, method: 'Runtime.getHeapUsage' }),
      });
      return await reply;
    } finally {
      clearTimeout(timeout);
      requests.delete(id);
    }
  });
  return cdp;
}

async function qualify(page, platform) {
  await page.goto(url);
  const heapProbe = await attachHeapProbe(page);
  const stats = await page.evaluate(
    async (iterations) => {
      const { isCurrentGeometryRevision } = await import('/revision.js');
      const run = (candidate, test) =>
        new Promise((resolve, reject) => {
          const worker = new Worker('./worker.js', { type: 'module' });
          const snapshot = {
            boardId: 'g0-fixture',
            revision: 41,
            inputDigest: 'fixture-v1',
            engine: candidate,
          };
          let workingRevision = snapshot;
          const timeout = setTimeout(() => {
            worker.terminate();
            reject(new Error('Worker timed out'));
          }, 60_000);
          const finish = (callback, value) => {
            clearTimeout(timeout);
            worker.terminate();
            callback(value);
          };
          worker.onerror = (event) => finish(reject, new Error(event.message));
          worker.onmessage = async ({ data }) => {
            if (data.kind === 'running' && test === 'cancel') {
              const cancelStarted = performance.now();
              worker.terminate();
              const terminateMs = performance.now() - cancelStarted;
              worker.onmessage = () =>
                finish(
                  reject,
                  new Error('Cancelled worker published a result'),
                );
              setTimeout(
                () => finish(resolve, { cancelled: true, terminateMs }),
                25,
              );
            } else if (data.kind === 'running' && test === 'stale')
              workingRevision = { ...snapshot, revision: 42 };
            else if (data.kind === 'failure')
              finish(reject, new Error(data.error));
            else if (data.kind === 'result') {
              if (test === 'cancel')
                finish(
                  reject,
                  new Error('Cancelled worker published a result'),
                );
              else if (
                !isCurrentGeometryRevision(data.snapshot, workingRevision)
              )
                finish(resolve, { staleRejected: true });
              else {
                const workerHeap = await globalThis
                  .readWorkerHeap()
                  .catch(() => null);
                finish(resolve, { ...data.result, workerHeap });
              }
            }
          };
          worker.postMessage({
            candidate,
            snapshot,
            iterations: test === 'normal' ? iterations : undefined,
          });
        });
      const memory = () => performance.memory?.usedJSHeapSize ?? null;
      const result = {};
      for (const candidate of ['typescript', 'wasm']) {
        const before = memory();
        result[candidate] = {
          ...(await run(candidate, 'normal')),
          rendererHeapBefore: before,
          rendererHeapAfter: memory(),
          ...(await run(candidate, 'cancel')),
          ...(await run(candidate, 'stale')),
        };
      }
      return result;
    },
    resourceMonitoring ? 24 : 7,
  );
  await heapProbe.detach();
  for (const [candidate, result] of Object.entries(stats)) {
    const { files, ...summary } = result;
    const directory = path.join(output, platform, candidate);
    await mkdir(directory, { recursive: true });
    await Promise.all(
      Object.entries(files).map(([name, data]) =>
        writeFile(path.join(directory, name), data, 'ascii'),
      ),
    );
    stats[candidate] = summary;
  }
  return stats;
}

let browser;
let desktop;
const versions = {};
const resourceUsage = {};
async function qualifyRuntime(page, platform, readPids) {
  if (!resourceMonitoring) return qualify(page, platform);
  const { result, resources } = await monitorRuntime(readPids, () =>
    qualify(page, platform),
  );
  resourceUsage[platform] = resources;
  return result;
}
try {
  browser = await chromium.launch({
    ...(referenceHost ? { channel: referenceHost.stableBrowser } : {}),
    args: [
      '--enable-precise-memory-info',
      '--enable-blink-features=ForceEagerMeasureMemory',
    ],
  });
  versions.chromium = browser.version();
  const browserProcesses = resourceMonitoring
    ? await browser.newBrowserCDPSession()
    : undefined;
  observations.browser = await qualifyRuntime(
    await browser.newPage(
      referenceHost ? { viewport: { width: 1920, height: 1080 } } : {},
    ),
    'browser',
    async () =>
      (
        await browserProcesses.send('SystemInfo.getProcessInfo')
      ).processInfo.map(({ id }) => id),
  );
  await browser.close();
  browser = undefined;
  const env = {
    ...process.env,
    TINYCAD_PCB_G0_PROFILE: path.join(output, 'electron-profile'),
    TINYCAD_PCB_G0_URL: url,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const disableElectronSandbox = env.TINYCAD_PCB_G0_NO_ELECTRON_SANDBOX === '1';
  desktop = await _electron.launch({
    cwd: process.cwd(),
    env,
    timeout: 30_000,
    ...(env.TINYCAD_PCB_G0_ELECTRON
      ? { executablePath: env.TINYCAD_PCB_G0_ELECTRON }
      : {}),
    args: [
      ...(disableElectronSandbox ? ['--no-sandbox'] : []),
      path.resolve('scripts/pcb/g0-electron.cjs'),
    ],
  });
  versions.electron = await desktop.evaluate(() => process.versions.electron);
  const display = await desktop.evaluate(({ screen }) => {
    const { size, scaleFactor } = screen.getPrimaryDisplay();
    return {
      widthPx: Math.round(size.width * scaleFactor),
      heightPx: Math.round(size.height * scaleFactor),
      scaleFactor,
    };
  });
  if (referenceHost) {
    assert.equal(
      display.widthPx,
      1920,
      'Set the primary display to 1920 × 1080 for the reference run.',
    );
    assert.equal(
      display.heightPx,
      1080,
      'Set the primary display to 1920 × 1080 for the reference run.',
    );
  }
  observations.desktop = await qualifyRuntime(
    await desktop.firstWindow(),
    'desktop',
    () =>
      desktop.evaluate(({ app }) => app.getAppMetrics().map(({ pid }) => pid)),
  );
  await desktop.close();
  desktop = undefined;
  const report = {
    host: {
      ...(referenceHost ? { referenceLaptop: referenceHost } : {}),
      os: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model,
      logicalCores: os.cpus().length,
      memoryBytes: os.totalmem(),
      node: process.version,
      display,
      ...versions,
      electronSandbox: !disableElectronSandbox,
    },
    ...observations,
    ...(resourceMonitoring ? { resourceUsage } : {}),
  };
  const reportPath = path.join(output, 'qualification.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  console.log(`Qualification evidence: ${reportPath}`);
  for (const [platform, results] of Object.entries(observations)) {
    for (const [candidate, result] of Object.entries(results)) {
      const context = `${platform}/${candidate}`;
      assert.equal(result.seededShort, true, context);
      assert.equal(result.seededOpen, true, context);
      assert.equal(result.corruptOutput, true, context);
      assert.equal(result.missingOutput, true, context);
      assert.equal(result.cancelled && result.staleRejected, true, context);
      assert.deepEqual(result.camIssues, [], context);
      assert.deepEqual(result.openNets, [], context);
      assert.deepEqual(result.missingTerminals, [], context);
      assert.equal(result.shorts, 0, context);
    }
  }
  assert.equal(
    observations.browser.wasm.digest,
    observations.desktop.wasm.digest,
  );
  assert.equal(
    observations.browser.typescript.digest,
    observations.desktop.typescript.digest,
  );
  assert.equal(
    observations.browser.wasm.digest,
    observations.browser.typescript.digest,
  );
} finally {
  await browser?.close();
  await desktop?.close();
  server.close();
}
