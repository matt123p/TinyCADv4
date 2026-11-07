import { app, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const jobs = new Map();
const root = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'ngspice')
    : fileURLToPath(new URL('../build/engines/native/', import.meta.url));
const safeName = (name) => /^[A-Za-z0-9_-]+\.(?:lib|cir|mod)$/i.test(name);

async function verifiedRuntime() {
  const directory = root();
  const manifest = JSON.parse(
    await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'),
  );
  if (
    manifest.protocol !== 1 ||
    manifest.platform !== process.platform ||
    manifest.arch !== process.arch ||
    !Array.isArray(manifest.files)
  )
    throw new Error(
      'Bundled ngspice does not match this application architecture.',
    );
  const verified = new Set();
  for (const entry of manifest.files) {
    if (!/^[A-Za-z0-9_.-]+$/.test(entry.path))
      throw new Error('Invalid bundled engine path.');
    const data = await fs.readFile(path.join(directory, entry.path));
    if (crypto.createHash('sha256').update(data).digest('hex') !== entry.sha256)
      throw new Error(`Bundled engine integrity check failed: ${entry.path}`);
    verified.add(entry.path);
  }
  if (
    ![manifest.helper, manifest.library, ...manifest.modules].every((file) =>
      verified.has(file),
    )
  )
    throw new Error('Engine manifest has an unverified executable.');
  return { directory, manifest };
}

export function registerSimulation() {
  ipcMain.handle('simulation-start', async (event, request) => {
    const owner = event.sender;
    if (jobs.has(owner.id)) throw new Error('A simulation is already running.');
    if (
      !request ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(request.runId) ||
      typeof request.deck !== 'string' ||
      request.deck.length > 8 * 1024 * 1024
    )
      throw new Error('Invalid simulation request.');
    // Validate again across the privilege boundary; renderer validation is not trusted.
    const files = request.files;
    if (
      !files ||
      typeof files !== 'object' ||
      Array.isArray(files) ||
      Object.keys(files).length > 100
    )
      throw new Error('Invalid model attachments.');
    let modelBytes = 0;
    for (const [name, text] of Object.entries(files)) {
      if (!safeName(name) || typeof text !== 'string')
        throw new Error('Invalid model attachment.');
      modelBytes += Buffer.byteLength(text);
      if (modelBytes > 16 * 1024 * 1024)
        throw new Error('Model attachments exceed 16 MiB.');
    }
    for (const text of [request.deck, ...Object.values(files)]) {
      if (text.includes('\0')) throw new Error('Invalid SPICE text.');
      for (const raw of text.replace(/\r?\n[ \t]*\+/g, ' ').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('*')) continue;
        if (
          /^\s*\.model\s+\S+\s+(?:filesource|d_source|table2d|table3d)\b|\b(?:file|filename|infile|outfile|cardfile)\s*=/i.test(
            line,
          )
        )
          throw new Error('File-backed device models are not supported.');
        if (
          /^(?:\.control|\.endc|\.spiceinit|\.osdi|\.load|\.csparam|\.shell|shell\b|!)/i.test(
            line,
          )
        )
          throw new Error(
            'SPICE control scripts and external modules are disabled.',
          );
        if (/^\.(?:inc|include|lib)\b/i.test(line)) {
          const match =
            /^\.(?:inc|include|lib)\s+["']?([A-Za-z0-9_-]+\.(?:lib|cir|mod))["']?(?:\s+[A-Za-z0-9_-]+)?\s*$/i.exec(
              line,
            );
          if (!match || !Object.hasOwn(files, match[1]))
            throw new Error('Model include is outside this drawing.');
        }
      }
    }
    // Reserve before awaiting I/O so concurrent requests cannot race the check.
    const job = { runId: request.runId, child: null, stopped: false };
    jobs.set(owner.id, job);
    let directory;
    const send = (data) => {
      if (!owner.isDestroyed())
        owner.send('simulation-event', request.runId, data);
    };
    try {
      const runtime = await verifiedRuntime();
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tinycad-ngspice-'));
      await fs.writeFile(path.join(directory, 'circuit.cir'), request.deck, {
        mode: 0o600,
      });
      for (const [name, text] of Object.entries(files))
        await fs.writeFile(path.join(directory, name), text, { mode: 0o600 });
      if (job.stopped) {
        send({ type: 'finished', state: 'stopped' });
        return;
      }
      if (owner.isDestroyed()) return;
      const { manifest } = runtime;
      if (process.platform === 'win32') {
        for (const file of manifest.files.filter((entry) =>
          /\.(?:dll|cm)$/i.test(entry.path),
        ))
          await fs.copyFile(
            path.join(runtime.directory, file.path),
            path.join(directory, file.path),
          );
      }
      if (job.stopped) {
        send({ type: 'finished', state: 'stopped' });
        return;
      }
      if (owner.isDestroyed()) return;
      send({
        type: 'ready',
        info: {
          backend: 'native',
          buildId: manifest.buildId,
          version: manifest.version,
          protocol: 1,
          capabilities: manifest.capabilities,
        },
      });
      const child = spawn(
        path.join(runtime.directory, manifest.helper),
        [
          process.platform === 'win32'
            ? manifest.library
            : path.join(runtime.directory, manifest.library),
          'circuit.cir',
          ...manifest.modules.map((name) =>
            process.platform === 'win32'
              ? `./${name}`
              : path.join(runtime.directory, name),
          ),
        ],
        {
          cwd: directory,
          windowsHide: true,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            PATH:
              process.platform === 'win32'
                ? `${process.env.SystemRoot}\\System32`
                : '/usr/bin:/bin',
            SystemRoot: process.env.SystemRoot || '',
            HOME: directory,
            USERPROFILE: directory,
            TMPDIR: directory,
          },
        },
      );
      job.child = child;
      let buffer = '',
        total = 0,
        finished = false,
        stderr = '';
      const finish = (data) => {
        if (!finished) {
          finished = true;
          send(data);
        }
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        total += Buffer.byteLength(chunk);
        buffer += chunk;
        if (total > 512 * 1024 * 1024 || buffer.length > 8 * 1024 * 1024) {
          finish({
            type: 'finished',
            state: 'failed',
            error: 'Engine output exceeded its transport limit.',
          });
          child.kill();
          return;
        }
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          try {
            const message = JSON.parse(line);
            if (!['log', 'vectors', 'data', 'finished'].includes(message.type))
              throw new Error('Invalid engine event.');
            if (message.type === 'finished') finish(message);
            else if (!finished) send(message);
          } catch {
            finish({
              type: 'finished',
              state: 'failed',
              error: 'Invalid response from bundled ngspice.',
            });
            child.kill();
          }
        }
      });
      child.stderr.on('data', (chunk) => {
        if (stderr.length < 65536) stderr += chunk;
      });
      await new Promise((resolve) => {
        child.once('error', (error) => {
          finish({ type: 'finished', state: 'failed', error: String(error) });
          resolve();
        });
        child.once('close', (code) => {
          finish({
            type: 'finished',
            state: job.stopped ? 'stopped' : 'failed',
            error: job.stopped
              ? undefined
              : `Engine exited (${code}). ${stderr}`,
          });
          resolve();
        });
      });
    } finally {
      if (jobs.get(owner.id) === job) jobs.delete(owner.id);
      if (directory) await fs.rm(directory, { recursive: true, force: true });
    }
  });
  ipcMain.on('simulation-stop', (event, id) => {
    const job = jobs.get(event.sender.id);
    if (job?.runId === id) {
      job.stopped = true;
      job.child?.kill();
    }
  });
  app.on('web-contents-created', (_, contents) =>
    contents.once('destroyed', () => {
      const job = jobs.get(contents.id);
      if (job) {
        job.stopped = true;
        job.child?.kill();
      }
    }),
  );
  app.on('before-quit', () => {
    for (const job of jobs.values()) job.child?.kill();
  });
}
