import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const intervalMs = 200;

async function snapshot(readPids) {
  const pids = [...new Set(await readPids())].filter(
    (pid) => Number.isSafeInteger(pid) && pid > 0,
  );
  if (!pids.length)
    throw new Error('The benchmark has no runtime process IDs to sample.');
  const { stdout } = await exec(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$sample = Get-Process -Id ${pids.join(
        ',',
      )} -ErrorAction SilentlyContinue | Select-Object Id,CPU,WorkingSet64; ConvertTo-Json -InputObject @($sample) -Compress`,
    ],
    { windowsHide: true, timeout: 10_000 },
  );
  const processes = JSON.parse(stdout);
  if (!processes.length)
    throw new Error('The runtime exited before resource sampling.');
  return {
    timeMs: performance.now(),
    workingSetBytes: processes.reduce(
      (total, proc) => total + proc.WorkingSet64,
      0,
    ),
    cpuByPid: new Map(processes.map((proc) => [proc.Id, proc.CPU])),
  };
}

export async function monitorRuntime(readPids, workload) {
  const baseline = await snapshot(readPids);
  let previous = baseline;
  let cpuSeconds = 0;
  let peakCpuPercent = 0;
  const samples = [];
  let done = false;
  const sampling = (async () => {
    while (!done) {
      await delay(intervalMs);
      if (done) break;
      const current = await snapshot(readPids);
      let delta = 0;
      for (const [pid, cpu] of current.cpuByPid) {
        const before = previous.cpuByPid.get(pid);
        if (typeof cpu === 'number' && typeof before === 'number')
          delta += Math.max(0, cpu - before);
      }
      const cpuPercent = (delta * 100_000) / (current.timeMs - previous.timeMs);
      cpuSeconds += delta;
      peakCpuPercent = Math.max(peakCpuPercent, cpuPercent);
      samples.push({
        elapsedMs: current.timeMs - baseline.timeMs,
        cpuPercent,
        workingSetBytes: current.workingSetBytes,
      });
      previous = current;
    }
  })().then(
    () => undefined,
    (error) => error,
  );
  let result;
  try {
    result = await workload();
  } finally {
    done = true;
    const samplingError = await sampling;
    if (samplingError) throw samplingError;
  }
  if (samples.length < 3)
    throw new Error(
      'Resource monitoring captured fewer than three workload samples.',
    );
  const durationMs = samples.at(-1).elapsedMs;
  return {
    result,
    resources: {
      initialWorkingSetBytes: baseline.workingSetBytes,
      peakWorkingSetBytes: Math.max(
        baseline.workingSetBytes,
        ...samples.map(({ workingSetBytes }) => workingSetBytes),
      ),
      cpuSeconds,
      meanCpuPercent: (cpuSeconds * 100_000) / durationMs,
      peakCpuPercent,
      samples,
    },
  };
}
