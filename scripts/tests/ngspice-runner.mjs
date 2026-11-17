import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = path.resolve(
  process.env.TINYCAD_NATIVE_ENGINE_DIR ||
    path.join(root, 'build/engines/native'),
);
let manifest;
if (!process.env.NGSPICE_BIN) {
  try {
    manifest = JSON.parse(
      readFileSync(path.join(directory, 'manifest.json'), 'utf8'),
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
export const ngspiceAvailable = Boolean(process.env.NGSPICE_BIN || manifest);
export const ngspiceBackend = process.env.NGSPICE_BIN
  ? 'CLI override'
  : manifest
  ? `bundled ngspice ${manifest.version}`
  : 'unavailable';

// Exercise the same helper, library and code models as the Electron runtime.
// An explicit CLI override remains useful for comparing upstream versions.
export function runNgspice(file) {
  if (!ngspiceAvailable)
    throw Error(
      'Build the native engine or set NGSPICE_BIN before numerical qualification.',
    );
  const command =
    process.env.NGSPICE_BIN || path.join(directory, manifest.helper);
  const args = process.env.NGSPICE_BIN
    ? ['-b', file]
    : [
        path.join(directory, manifest.library),
        file,
        ...manifest.modules.map((m) => path.join(directory, m)),
      ];
  const result = spawnSync(command, args, {
    cwd: path.dirname(file),
    encoding: 'utf8',
    env: process.env,
    timeout: 15000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (process.env.NGSPICE_BIN)
    return { status: result.status, log: result.stdout + result.stderr };
  const events = result.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const finished = events.filter((e) => e.type === 'finished').at(-1);
  const log =
    events
      .filter((e) => e.type === 'log' || (e.type === 'finished' && e.error))
      .map((e) => e.message || e.error)
      .join('\n') + result.stderr;
  return {
    status:
      result.status === 0 && finished?.state === 'complete'
        ? 0
        : result.status || 1,
    log,
    events,
  };
}
