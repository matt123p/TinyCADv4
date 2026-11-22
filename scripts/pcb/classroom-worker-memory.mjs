import { measureDesignCheck } from './classroom-performance.mjs';

export function installClassroomWorkerMemoryProbe() {
  const NativeWorker = window.Worker;
  let armed = false;
  let held;
  let wasmMemoryBytes;
  window.classroomWorkerMemoryProbe = {
    arm() { armed = true; },
    read() { return wasmMemoryBytes ?? null; },
    release() {
      armed = false;
      if (held) NativeWorker.prototype.terminate.call(held);
      held = undefined;
      wasmMemoryBytes = undefined;
    },
  };
  window.Worker = class extends NativeWorker {
    postMessage(request, ...options) {
      if (armed && request?.kind === 'check') {
        armed = false;
        held = this;
        this.addEventListener('message', ({ data }) => {
          if (data.kind === 'check') wasmMemoryBytes = data.wasmMemoryBytes;
        }, { once: true });
        return super.postMessage({ ...request, measureMemory: true }, ...options);
      }
      return super.postMessage(request, ...options);
    }

    terminate() {
      // Keep the completed diagnostic worker available until DevTools reads its heap.
      if (this !== held) super.terminate();
    }
  };
}

async function readWorkerHeap(cdp, url) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  const matches = targetInfos.filter((target) => target.type === 'worker' && target.url === url);
  if (matches.length !== 1) throw new Error('The completed PCB worker did not have a unique DevTools target.');
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId: matches[0].targetId,
    flatten: false,
  });
  let receive;
  let deadline;
  try {
    const id = 1;
    const response = new Promise((resolve) => {
      receive = (event) => {
        if (event.sessionId !== sessionId) return;
        const message = JSON.parse(event.message);
        if (message.id === id) resolve(message);
      };
      cdp.on('Target.receivedMessageFromTarget', receive);
      deadline = setTimeout(() => resolve({ error: { message: 'The worker heap request timed out.' } }), 5000);
    });
    await cdp.send('Target.sendMessageToTarget', {
      sessionId,
      message: JSON.stringify({ id, method: 'Runtime.getHeapUsage' }),
    });
    const { result, error } = await response;
    if (error) throw new Error(error.message);
    return result;
  } finally {
    clearTimeout(deadline);
    cdp.off('Target.receivedMessageFromTarget', receive);
    await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
  }
}

export async function measureClassroomWorkerMemory(page, browserSession) {
  await page.evaluate(() => window.classroomWorkerMemoryProbe.arm());
  try {
    const check = await measureDesignCheck(page);
    const wasmMemoryBytes = await page.evaluate(() => window.classroomWorkerMemoryProbe.read());
    const workers = page.workers().filter((worker) => /\/board\.worker\./.test(worker.url()));
    let heap = null;
    let unavailable = null;
    try {
      if (workers.length !== 1) throw new Error('Expected one completed PCB worker.');
      heap = await readWorkerHeap(browserSession, workers[0].url());
    } catch (error) {
      unavailable = error.message;
    }
    return { wasmMemoryBytes, heap, unavailable, findings: check.findings };
  } finally {
    await page.evaluate(() => window.classroomWorkerMemoryProbe.release());
  }
}
