import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

let available = true;
try {
  await fs.access('build/engines/native/manifest.json');
} catch {
  available = false;
}
test(
  'Electron broker streams native results, rejects unsafe models and stops only its owner job',
  { skip: !available },
  async () => {
    const handlers = new Map(),
      listeners = new Map(),
      appListeners = new Map();
    globalThis.tinycadElectronMock = {
      app: {
        isPackaged: false,
        on: (name, listener) => appListeners.set(name, listener),
      },
      ipcMain: {
        handle: (name, handler) => handlers.set(name, handler),
        on: (name, listener) => listeners.set(name, listener),
      },
    };
    const output = path.resolve(`electron/.simulation-test-${process.pid}.mjs`);
    try {
      await build({
        entryPoints: ['electron/simulation.js'],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: output,
        plugins: [
          {
            name: 'electron-mock',
            setup(builder) {
              builder.onResolve({ filter: /^electron$/ }, () => ({
                path: 'electron',
                namespace: 'mock',
              }));
              builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
                contents:
                  'export const {app,ipcMain}=globalThis.tinycadElectronMock;',
              }));
            },
          },
        ],
      });
      (await import(pathToFileURL(output))).registerSimulation();
      const messages = [];
      const owner = {
        id: 123,
        isDestroyed: () => false,
        send: (channel, id, event) => messages.push(event),
      };
      const start = handlers.get('simulation-start');
      await start(
        { sender: owner },
        {
          runId: 'divider',
          deck: 'Divider\nV1 in 0 DC 5\nR1 in out 1k\nR2 out 0 1k\n.op\n.end',
          files: {},
        },
      );
      assert.equal(messages[0].type, 'ready');
      assert.equal(messages.at(-1).state, 'complete');
      const names = messages.find((e) => e.type === 'vectors').names;
      assert.equal(
        messages.find((e) => e.type === 'data').rows[0][names.indexOf('out')],
        2.5,
      );
      await assert.rejects(
        start(
          { sender: owner },
          {
            runId: 'unsafe',
            deck: 'Unsafe\n.include /etc/passwd\n.end',
            files: {},
          },
        ),
      );
      await assert.rejects(
        start(
          { sender: owner },
          {
            runId: 'unsafe',
            deck: 'Unsafe\n.control\nshell echo bad\n.endc\n.end',
            files: {},
          },
        ),
      );
      messages.length = 0;
      owner.send = (channel, id, event) => {
        messages.push(event);
        if (event.type === 'data')
          listeners.get('simulation-stop')({ sender: owner }, id);
      };
      await start(
        { sender: owner },
        {
          runId: 'long-transient',
          deck: 'Transient\nV1 in 0 PULSE(0 1 0 1n 1n 1m 2m)\nR1 in out 1k\nC1 out 0 1u\n.tran 1u 10\n.end',
          files: {},
        },
      );
      assert.ok(
        messages.some((e) => e.type === 'data'),
        JSON.stringify(messages),
      );
      assert.equal(messages.at(-1).state, 'stopped');
      listeners.get('simulation-stop')(
        { sender: { id: 999 } },
        'long-transient',
      );
      // Exercise the same cleanup hook Electron invokes when its window closes.
      let destroyed;
      appListeners.get('web-contents-created')(undefined, {
        id: owner.id,
        once: (name, listener) => {
          if (name === 'destroyed') destroyed = listener;
        },
      });
      messages.length = 0;
      owner.send = (_channel, _id, event) => {
        messages.push(event);
        if (event.type === 'data') destroyed();
      };
      await start(
        { sender: owner },
        {
          runId: 'window-closed',
          deck: 'Transient\nV1 in 0 PULSE(0 1 0 1n 1n 1m 2m)\nR1 in out 1k\nC1 out 0 1u\n.tran 1u 10\n.end',
          files: {},
        },
      );
      assert.equal(messages.at(-1).state, 'stopped');
      messages.length = 0;
      owner.send = (_channel, _id, event) => messages.push(event);
      await start(
        { sender: owner },
        {
          runId: 'after-cleanup',
          deck: 'Divider\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.op\n.end',
          files: {},
        },
      );
      assert.equal(messages.at(-1).state, 'complete');
    } finally {
      await fs.rm(output, { force: true });
      delete globalThis.tinycadElectronMock;
    }
  },
);

for (const pathSuffix of ['spaces', 'Unicode \u03a9 \u6d4b\u8bd5']) {
  test(
    `bundled native modules load from ${pathSuffix} paths without developer PATH or startup files`,
    { skip: !available },
    async () => {
      const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), `TinyCAD engine ${pathSuffix} `),
      );
      try {
        await fs.cp('build/engines/native', directory, { recursive: true });
        const manifest = JSON.parse(
          await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'),
        );
        await fs.writeFile(
          path.join(directory, '.spiceinit'),
          'echo TINYCAD_STARTUP_MUST_NOT_RUN\n',
        );
        await fs.writeFile(
          path.join(directory, 'divider.cir'),
          'Divider\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.op\n.end',
        );
        const result = spawnSync(
          path.join(directory, manifest.helper),
          [
            path.join(directory, manifest.library),
            path.join(directory, 'divider.cir'),
            ...manifest.modules.map((name) => path.join(directory, name)),
          ],
          {
            cwd: directory,
            env: {
              ...process.env,
              HOME: directory,
              USERPROFILE: directory,
              ...(process.platform === 'win32'
                ? { PATH: path.join(process.env.SystemRoot, 'System32') }
                : {}),
            },
            encoding: 'utf8',
            timeout: 30000,
          },
        );
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.ok(!result.stdout.includes('TINYCAD_STARTUP_MUST_NOT_RUN'));
      } finally {
        await fs.rm(directory, { recursive: true, force: true });
      }
    },
  );
}
