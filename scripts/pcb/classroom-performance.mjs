export function stats(samples) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * .95) - 1],
    max: sorted.at(-1),
  };
}

function observeWorkerClose(worker) {
  const started = performance.now();
  const closed = new Promise((resolve) =>
    worker.once('close', () => resolve(performance.now() - started)));
  return async () => {
    let deadline;
    return Promise.race([
      closed,
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error('PCB worker did not close.')), 5000);
      }),
    ]).finally(() => clearTimeout(deadline));
  };
}

function isBoardWorker(worker) {
  return /\/board\.worker\./.test(worker.url());
}

export async function measureClassroomLocalEdit(page) {
  const layout = page.getByRole('region', { name: 'PCB layout' });
  const drawing = layout.getByRole('img', { name: 'Board layout' });
  const tracks = drawing.locator('[data-track]');
  const zonesFilled = layout.getByText('Zones filled.', { exact: true });
  await drawing.waitFor();
  await zonesFilled.waitFor({ timeout: 90_000 });
  const originalTracks = await tracks.count();
  const samples = [];
  for (let index = 0; index < 5; index++) {
    await layout.getByRole('button', { name: 'Route track', exact: true }).click();
    await layout.getByLabel('Board net', { exact: true }).selectOption({ label: `U1-${index + 1}` });
    const waypointX = layout.getByLabel('Waypoint X (mm)');
    if (!await waypointX.isVisible())
      await layout.getByText('Enter route coordinates', { exact: true }).click();
    for (const y of ['6', '6.5']) {
      await waypointX.fill((3 + 1.05 * index).toFixed(2));
      await layout.getByLabel('Waypoint Y (mm)').fill(y);
      await layout.getByRole('button', { name: 'Add waypoint', exact: true }).click();
      await layout.getByRole('status', { name: 'Route waypoints' })
        .filter({ hasText: ', Y ' + y + ' mm.' }).waitFor();
    }
    const finish = layout.getByRole('button', { name: 'Finish route', exact: true })
      .and(layout.locator('button:enabled'));
    await finish.scrollIntoViewIfNeeded();
    samples.push(await finish.evaluate(async (button, count) => {
      const layout = button.closest('section[aria-label="PCB layout"]');
      const tracks = () => layout.querySelectorAll('[aria-label="Board layout"] [data-track]').length;
      const started = performance.now();
      let pendingMs = null;
      button.click();
      do {
        await new Promise(requestAnimationFrame);
        const elapsed = performance.now() - started;
        const pending = layout.querySelector('[data-copper-edit-pending]');
        if (pending?.textContent.trim() && pending.getClientRects().length) pendingMs ??= elapsed;
        const actualCount = tracks();
        if (actualCount === count)
          return { feedbackMs: pendingMs ?? elapsed, pendingMs, committedMs: elapsed };
        if (actualCount > count)
          throw new Error('The classroom route exceeded ' + count + ' tracks. Observed ' + actualCount + '.');
        const failure = layout.querySelector('[role="alert"]')?.textContent;
        if (failure) throw new Error(failure);
        if (elapsed > 10_000)
          throw new Error('The classroom route edit did not reach ' + count + ' tracks. Observed ' + actualCount + '.');
      } while (true);
    }, originalTracks + index + 1, { timeout: 15_000 }));
    await zonesFilled.waitFor({ timeout: 90_000 });
  }
  const undo = layout.getByRole('button', { name: 'Undo', exact: true });
  for (let index = 0; index < samples.length; index++) await undo.click();
  await zonesFilled.waitFor({ timeout: 90_000 });
  if (await tracks.count() !== originalTracks)
    throw new Error('Undo did not restore the classroom route count.');
  return {
    samples,
    feedbackMs: stats(samples.map(({ feedbackMs }) => feedbackMs)),
    committedMs: stats(samples.map(({ committedMs }) => committedMs)),
  };
}

export async function measureDesignCheck(page) {
  const run = page.getByRole('button', { name: 'Run design checks…' });
  const timing = await run.evaluate((button) => new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const failure = dialog?.querySelector('[role="alert"]')?.textContent;
      if (!failure && !dialog?.querySelector('[aria-label="PCB findings"]')) return;
      const endTime = performance.now();
      observer.disconnect();
      clearTimeout(deadline);
      if (failure) reject(new Error('PCB design checks failed. ' + failure));
      else resolve({ startTime, endTime });
    });
    const deadline = setTimeout(() => {
      observer.disconnect();
      reject(new Error('The PCB design check did not display a report.'));
    }, 90_000);
    observer.observe(document.body, { childList: true, subtree: true });
    const startTime = performance.now();
    button.click();
  }), undefined, { timeout: 95_000 });
  const check = page.getByRole('dialog', { name: 'PCB design checks' });
  await check.getByText('Physical connectivity · checked', { exact: true }).waitFor();
  const findings = await check.getByRole('table', { name: 'PCB findings' }).locator('tbody > tr').count();
  await check.getByRole('button', { name: 'Close', exact: true }).click();
  return { ...timing, checksMs: timing.endTime - timing.startTime, findings };
}

export async function measureCheckDuringRefill(page) {
  await page.getByRole('button', { name: 'Cancel zone fill', exact: true }).click();
  const reset = page.getByRole('button', { name: 'Refill zones', exact: true });
  const startedAt = performance.now();
  const lifetimes = [];
  const track = (worker) => {
    if (!isBoardWorker(worker)) return;
    lifetimes.push({
      startMs: performance.now() - startedAt,
      close: observeWorkerClose(worker),
    });
  };
  page.on('worker', track);
  try {
    const refill = page.waitForEvent('worker', { predicate: isBoardWorker });
    await reset.click();
    await refill;
    await page.getByRole('button', { name: 'Run design checks…' }).click();
    const checks = page.getByRole('dialog', { name: 'PCB design checks' });
    await checks.getByText('Physical connectivity · checked', { exact: true }).waitFor();
    await checks.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByText('Zones filled.', { exact: true }).waitFor();
    const workers = await Promise.all(lifetimes.map(async ({ startMs, close }) => ({
      startMs, endMs: startMs + await close(),
    })));
    if (workers.length < 2)
      throw new Error('Expected a refill and design-check worker.');
    return { workers, overlapped: workers[1].startMs < workers[0].endMs };
  } finally {
    page.off('worker', track);
  }
}

export async function measureClassroom(page, openFixture, name, checkpoint, measurePhase = (_phase, task) => task()) {
  await page.evaluate(() => {
    window.classroomTasks = [];
    window.classroomObserver?.disconnect();
    if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) return;
    window.classroomObserver = new PerformanceObserver((list) => {
      window.classroomTasks.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })));
    });
    window.classroomObserver.observe({ type: 'longtask' });
  });
  const { openMs, openHarnessMs } = await openFixture(name);
  const canvas = page.getByRole('img', { name: 'Board layout' });
  const counts = {
    components: await canvas.locator('[data-component]').count(),
    tracks: await canvas.locator('[data-track]').count(),
    vias: await canvas.locator('[data-via]').count(),
  };
  if (counts.components !== 100 || counts.tracks !== 2000 || counts.vias !== 50)
    throw new Error('Expected the complete classroom board in the SVG editor.');

  const fillStarted = performance.now();
  const filled = page.getByText('Zones filled.', { exact: true });
  await filled.waitFor({ timeout: 90_000 });
  const refillAfterOpenMs = performance.now() - fillStarted;
  counts.zones = await canvas.locator('[data-zone-fill]').count();
  if (counts.zones !== 4) throw new Error('Expected four classroom zone fills.');
  await checkpoint?.('initial fill ready');

  const measureInteraction = (phase) => canvas.evaluate(async (svg, phase) => {
    const framesUntil = async (complete) => {
      const deadline = performance.now() + 2500;
      while (!complete()) {
        if (performance.now() >= deadline) throw new Error('Timed out waiting for the editor to render.');
        await new Promise(requestAnimationFrame);
      }
    };
    if (phase === 'selection') {
      const layout = svg.closest('section[aria-label="PCB layout"]');
      const controls = [...svg.querySelectorAll('[data-component] text')].slice(0, 2);
      const selectionMs = [];
      for (let i = 0; i < 12; i++) {
        const control = controls[i % 2];
        const before = performance.now();
        control.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await framesUntil(() => [...layout.querySelectorAll('legend')]
          .some((legend) => legend.textContent.trim() === 'Position ' + control.textContent));
        selectionMs.push(performance.now() - before);
      }
      return selectionMs;
    }
    function viewBox() {
      return svg.getAttribute('data-view-box').split(' ').map(Number);
    }
    function wheel(deltaY, shiftKey) {
      const { x, y, width, height } = svg.getBoundingClientRect();
      svg.dispatchEvent(new WheelEvent('wheel', {
        clientX: x + width / 2,
        clientY: y + height / 2,
        deltaY,
        shiftKey,
        bubbles: true,
        cancelable: true,
      }));
    }

    if (phase === 'zoom') {
      const zoomFrameMs = [];
      for (let i = 0; i < 20; i++) {
        const width = viewBox()[2];
        const before = performance.now();
        wheel(i % 2 ? 120 : -120, true);
        await framesUntil(() => viewBox()[2] !== width);
        zoomFrameMs.push(performance.now() - before);
      }
      return zoomFrameMs;
    }

    // Exercise the full editor SVG continuously. Frame callbacks measure
    // scheduling under input load, while viewBox checks prove pan is working.
    const panFrameMs = [];
    let lastFrame = await new Promise(requestAnimationFrame);
    for (let i = 0; i < 60; i++) {
      const [, y, width] = viewBox();
      wheel(i % 2 ? -24 : 24, false);
      await new Promise((resolve, reject) => {
        const deadline = performance.now() + 2500;
        function update(frame) {
          panFrameMs.push(frame - lastFrame);
          lastFrame = frame;
          const [, nextY, nextWidth] = viewBox();
          if (nextWidth !== width) {
            reject(new Error('Expected plain wheel input to pan the board without changing zoom.'));
          } else if (nextY !== y) {
            resolve();
          } else if (performance.now() >= deadline) {
            reject(new Error('Timed out waiting for the board to pan.'));
          } else {
            requestAnimationFrame(update);
          }
        }
        requestAnimationFrame(update);
      });
    }
    return panFrameMs;
  }, phase);
  const selectionMs = await measureInteraction('selection');
  await checkpoint?.('after selection');
  const zoomFrameMs = await measureInteraction('zoom');
  await checkpoint?.('after zoom');
  const panFrameMs = await measureInteraction('pan');
  await checkpoint?.('after pan');
  const { route, routePreparationWorkerCloseMs } = await measurePhase('routing', async () => {
    const routeWorkerStopped = page.waitForEvent('worker', { predicate: isBoardWorker })
      .then(observeWorkerClose);
    const net = page.getByLabel('Board net', { exact: true });
    await net.selectOption({ label: 'U1-1' });
    await page.getByRole('button', { name: 'Route track', exact: true }).click();
    const route = await canvas.evaluate(async (svg) => {
      const began = performance.now();
      const cursor = (x, y) => {
        const screen = new DOMPoint(x * 1e6, -y * 1e6).matrixTransform(svg.querySelector('[data-svg-drawing]').getScreenCTM());
        return { clientX: screen.x, clientY: screen.y, bubbles: true, cancelable: true };
      };
      svg.dispatchEvent(new MouseEvent('click', cursor(5, 8)));
      function path() {
        return svg.querySelector('[data-route-preview]')?.getAttribute('d');
      }
      const waitFor = async (change) => {
        const deadline = performance.now() + 5000;
        while (!change()) {
          if (performance.now() >= deadline) throw new Error('Classroom route preview did not update.');
          await new Promise(requestAnimationFrame);
        }
      };
      await new Promise(requestAnimationFrame);
      svg.dispatchEvent(new PointerEvent('pointermove', { ...cursor(7, 8), pointerType: 'mouse' }));
      await waitFor(path);
      const startTime = performance.now();
      const previewMs = [];
      for (let i = 0; i < 12; i++) {
        const previous = path();
        const before = performance.now();
        svg.dispatchEvent(new PointerEvent('pointermove', {
          ...cursor(i % 2 ? 7 : 8, 8), pointerType: 'mouse',
        }));
        await waitFor(() => path() && path() !== previous);
        previewMs.push(performance.now() - before);
      }
      return { previewMs, readyMs: startTime - began, startTime, endTime: performance.now() };
    });
    const routePreparationWorkerCloseMs = await (await routeWorkerStopped)();
    if (page.workers().some(isBoardWorker))
      throw new Error('Route preview kept a PCB worker after clearance preparation.');
    return { route, routePreparationWorkerCloseMs };
  });
  await checkpoint?.('routing preview active');
  await page.getByRole('button', { name: 'Cancel route', exact: true }).click();

  const cancel = page.getByRole('button', { name: 'Cancel zone fill', exact: true });
  const refill = page.getByRole('button', { name: 'Refill zones', exact: true });
  await cancel.click();
  const pendingFill = page.waitForEvent('worker', { predicate: isBoardWorker });
  await refill.click();
  const geometryStopped = observeWorkerClose(await pendingFill);
  const cancelFillMs = await cancel.evaluate(async (button) => {
    const layout = button.closest('section');
    const starting = [...layout.querySelectorAll('[role="status"]')]
      .some((status) => status.textContent === 'Filling zones…');
    if (!starting) throw new Error('Zone computation finished before the cancellation probe started.');
    const before = performance.now();
    button.click();
    while (button.textContent !== 'Refill zones') {
      if (performance.now() - before > 2500) throw new Error('Zone cancellation did not update its control.');
      await new Promise(requestAnimationFrame);
    }
    return performance.now() - before;
  });
  const cancelWorkerCloseMs = await geometryStopped();
  await checkpoint?.('after cancellation');
  const explicitRefillMs = await measurePhase('refill', async () => {
    const refillStart = performance.now();
    await refill.click();
    await filled.waitFor({ timeout: 90_000 });
    return performance.now() - refillStart;
  });
  await checkpoint?.('after cancelling route and refilling');
  const check = await measurePhase('check', () => measureDesignCheck(page));
  const tasks = await page.evaluate(() => {
    const pending = window.classroomObserver?.takeRecords() ?? [];
    window.classroomObserver?.disconnect();
    return [...window.classroomTasks, ...pending.map(({ startTime, duration }) => ({ startTime, duration }))];
  });
  const longTasksDuring = ({ startTime, endTime }) => tasks.filter((task) =>
    task.startTime < endTime && task.startTime + task.duration >= startTime)
    .map(({ duration }) => duration);
  return {
    counts, openMs, openHarnessMs, refillAfterOpenMs, explicitRefillMs,
    checksMs: check.checksMs, findings: check.findings, cancelFillMs,
    cancelWorkerCloseMs, routePreparationWorkerCloseMs, selectionMs,
    routeReadyMs: route.readyMs, routePreviewMs: route.previewMs,
    routeLongTaskMs: longTasksDuring(route), checkLongTaskMs: longTasksDuring(check),
    zoomFrameMs, panFrameMs,
  };
}
