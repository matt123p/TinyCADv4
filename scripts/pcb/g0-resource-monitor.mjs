import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const intervalMs = 200;

async function processCounters(pids) {
  if (process.platform !== 'win32') {
    const { stdout } = await exec('ps', ['-p', pids.join(','), '-o', 'pid=,rss='], { timeout: 10_000 });
    return stdout.trim().split('\n').filter(Boolean).map((line) => {
      const [Id, rssKiB] = line.trim().split(/\s+/).map(Number);
      return { Id, WorkingSet64: rssKiB * 1024 };
    });
  }
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
  return JSON.parse(stdout);
}

async function sampleWorkingSets(processInfo, readCounters, includeProportionalBacking = false) {
  const types = new Map(processInfo
    .filter(({ id }) => Number.isSafeInteger(id) && id > 0)
    .map(({ id, type }) => [id, type]));
  if (!types.size) return [];
  const counters = await readCounters([...types.keys()]);
  return Promise.all(counters.map(async ({ Id, WorkingSet64 }) => {
    const sample = { pid: Id, type: types.get(Id), bytes: WorkingSet64 };
    if (process.platform === 'linux') {
      // A process can exit between ps and the proportional memory read.
      const rollup = await readFile('/proc/' + Id + '/smaps_rollup', 'utf8').catch(() => '');
      const pss = /^Pss:\s+(\d+) kB$/m.exec(rollup);
      if (pss) sample.proportionalBytes = Number(pss[1]) * 1024;
      if (includeProportionalBacking) {
        const backing = Object.fromEntries([
          ['anonymous', /^Pss_Anon:\s+(\d+) kB$/m],
          ['file', /^Pss_File:\s+(\d+) kB$/m],
          ['sharedMemory', /^Pss_Shmem:\s+(\d+) kB$/m],
        ].flatMap(([kind, pattern]) => {
          const match = pattern.exec(rollup);
          return match ? [[kind, Number(match[1]) * 1024]] : [];
        }));
        if (Object.keys(backing).length) sample.proportionalBacking = backing;
      }
    }
    return sample;
  }));
}

export function createWorkingSetSampler() {
  if (process.platform !== 'win32') {
    return {
      sample: (processInfo, includeProportionalBacking) =>
        sampleWorkingSets(processInfo, processCounters, includeProportionalBacking),
      close() {},
    };
  }

  // Keep the process alive between reads so shell startup cannot hide short jobs.
  const shell = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command', `
      while ($null -ne ($line = [Console]::ReadLine())) {
        $ids = [int[]]($line.Split(','))
        $sample = @(Get-Process -Id $ids -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64)
        [Console]::WriteLine((ConvertTo-Json -InputObject $sample -Compress))
      }
    `,
  ], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  const output = createInterface({ input: shell.stdout });
  const lines = output[Symbol.asyncIterator]();
  let failure;

  function failed(error) {
    failure ??= error;
    output.close();
    shell.kill();
  }

  shell.on('error', failed);
  shell.stdin.on('error', failed);
  async function readCounters(pids) {
    if (failure) throw failure;
    const timeout = setTimeout(
      () => failed(new Error('Timed out collecting browser process memory.')),
      10_000,
    );
    try {
      shell.stdin.write(pids.join(',') + '\n');
      const reply = await lines.next();
      if (failure) throw failure;
      if (reply.done) throw new Error('The browser process memory sampler exited.');
      return JSON.parse(reply.value);
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    sample: (processInfo) => sampleWorkingSets(processInfo, readCounters),
    close() {
      output.close();
      shell.kill();
    },
  };
}

async function snapshot(readPids) {
  const pids = [...new Set(await readPids())].filter(
    (pid) => Number.isSafeInteger(pid) && pid > 0,
  );
  if (!pids.length)
    throw new Error('The benchmark has no runtime process IDs to sample.');
  const processes = await processCounters(pids);
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

function processTotals(processes) {
  return {
    workingSetBytes: processes.reduce((total, { bytes }) => total + bytes, 0),
    proportionalBytes: processes.every(({ proportionalBytes }) => proportionalBytes !== undefined)
      ? processes.reduce((total, { proportionalBytes }) => total + proportionalBytes, 0)
      : null,
  };
}

export function observedMemory(measurements, tasks = []) {
  const samples = measurements.filter(({ processes }) => processes.length).map(({ name, processes }) => ({
    phase: name, ...processTotals(processes),
  }));
  for (const [phase, task] of tasks) {
    samples.push({
      phase,
      workingSetBytes: task.peakBrowserProcessWorkingSetBytes,
      proportionalBytes: task.peakSampledProportionalBytes,
    });
  }
  const peak = (metric) => samples.reduce((largest, sample) => {
    const bytes = sample[metric];
    return bytes !== null && (!largest || bytes > largest.bytes)
      ? { phase: sample.phase, bytes }
      : largest;
  }, null);
  return { peakWorkingSet: peak('workingSetBytes'), peakProportional: peak('proportionalBytes') };
}

export async function sampleProcessTask(workingSets, task, intervalMs) {
  const baselineProcesses = await workingSets();
  const samples = [];
  const controller = new AbortController();
  const startedAt = performance.now();
  const sampling = (async () => {
    try {
      while (!controller.signal.aborted) {
        const elapsedMs = performance.now() - startedAt;
        const processes = await workingSets();
        samples.push({
          elapsedMs,
          completedMs: performance.now() - startedAt,
          processes,
        });
        await delay(intervalMs, undefined, { signal: controller.signal });
      }
    } catch (failure) {
      if (failure.name !== 'AbortError') throw failure;
    }
  })().catch((failure) => failure);
  let result;
  let taskCompletedMs;
  try {
    result = await task();
  } finally {
    taskCompletedMs = performance.now() - startedAt;
    controller.abort();
    const failure = await sampling;
    if (failure) throw failure;
  }
  const taskSamples = samples.filter(({ completedMs, processes }) =>
    completedMs <= taskCompletedMs && processes.length);
  const totals = taskSamples.map(({ processes }) => processTotals(processes));
  const proportionalTotals = totals.map(({ proportionalBytes }) => proportionalBytes)
    .filter((bytes) => bytes !== null);
  return {
    result,
    memory: {
      baselineProcesses,
      samples,
      taskCompletedMs,
      completeTaskSamples: taskSamples.length,
      peakBrowserProcessWorkingSetBytes: totals.length ? Math.max(...totals.map(({ workingSetBytes }) => workingSetBytes)) : null,
      completeProportionalSamples: proportionalTotals.length,
      peakSampledProportionalBytes: proportionalTotals.length ? Math.max(...proportionalTotals) : null,
    },
  };
}
