import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { build } from 'esbuild';

async function fixture(run) {
  const parent = path.resolve('build/qualification/runtime-integrity');
  await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, 'package-'));
  const engine = path.join(directory, 'ngspice');
  await fs.mkdir(engine);
  const content = Buffer.from('verified test resource');
  const names = ['helper.bin', 'ngspice.bin', 'analog.cm'];
  const manifest = {
    protocol: 1,
    platform: process.platform,
    arch: process.arch,
    helper: names[0],
    library: names[1],
    modules: [names[2]],
    files: names.map((name) => ({
      path: name,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
      size: content.length,
    })),
  };
  for (const name of names)
    await fs.writeFile(path.join(engine, name), content);
  const save = () =>
    fs.writeFile(path.join(engine, 'manifest.json'), JSON.stringify(manifest));
  await save();
  let start,
    spawns = 0;
  globalThis.runtimeIntegrityMock = {
    app: { isPackaged: true, on() {} },
    ipcMain: {
      handle: (_name, handler) => {
        start = handler;
      },
      on() {},
    },
    spawn() {
      spawns++;
      throw new Error('Engine must not start after verification failure');
    },
  };
  const previous = process.resourcesPath;
  process.resourcesPath = directory;
  try {
    const compiled = await build({
      entryPoints: ['electron/simulation.js'],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      write: false,
      logLevel: 'silent',
      plugins: [
        {
          name: 'runtime-services',
          setup(builder) {
            builder.onResolve(
              { filter: /^(electron|node:child_process)$/ },
              ({ path }) => ({ path, namespace: 'mock' }),
            );
            builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
              contents:
                path === 'electron'
                  ? 'export const {app,ipcMain}=globalThis.runtimeIntegrityMock;'
                  : 'export const spawn=(...args)=>globalThis.runtimeIntegrityMock.spawn(...args);',
            }));
          },
        },
      ],
    });
    const module = { exports: {} };
    new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(
      module,
      module.exports,
      (await import('node:module')).createRequire(import.meta.url),
    );
    module.exports.registerSimulation();
    const events = [];
    const request = () =>
      start(
        {
          sender: {
            id: 1,
            isDestroyed: () => false,
            send: (...args) => events.push(args),
          },
        },
        {
          runId: 'check',
          deck: 'Divider\nV1 in 0 5\nR1 in 0 1k\n.op\n.end',
          files: {},
        },
      );
    await run({ engine, manifest, save, request });
    assert.equal(
      spawns,
      0,
      'Verification failures must not spawn any native/system fallback',
    );
    assert.deepEqual(
      events,
      [],
      'A rejected runtime must not announce a ready acquisition',
    );
  } finally {
    if (previous === undefined) delete process.resourcesPath;
    else process.resourcesPath = previous;
    delete globalThis.runtimeIntegrityMock;
    assert.ok(directory.startsWith(parent + path.sep));
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('a corrupted bundled binary fails before startup and releases the acquisition slot', async () =>
  fixture(async (f) => {
    await fs.appendFile(path.join(f.engine, f.manifest.library), 'corrupt');
    await assert.rejects(f.request(), /integrity check failed: ngspice.bin/);
    await assert.rejects(f.request(), /integrity check failed: ngspice.bin/);
  }));
test('a missing bundled file fails before startup', async () =>
  fixture(async (f) => {
    await fs.rm(path.join(f.engine, 'analog.cm'));
    await assert.rejects(f.request(), /ENOENT.*analog.cm/);
  }));
test('a mismatched engine architecture fails before startup', async () =>
  fixture(async (f) => {
    f.manifest.arch = process.arch === 'x64' ? 'arm64' : 'x64';
    await f.save();
    await assert.rejects(
      f.request(),
      /does not match this application architecture/,
    );
  }));
test('an unverified helper cannot bypass the bundled-file inventory', async () =>
  fixture(async (f) => {
    f.manifest.helper = 'unverified.bin';
    await f.save();
    await assert.rejects(f.request(), /unverified executable/);
  }));
