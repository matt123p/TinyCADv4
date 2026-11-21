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

export async function measureClassroom(page, openFixture, name) {
  await page.evaluate(() => {
    window.classroomTasks = [];
    window.classroomObserver?.disconnect();
    if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) return;
    window.classroomObserver = new PerformanceObserver((list) => {
      window.classroomTasks.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })));
    });
    window.classroomObserver.observe({ type: 'longtask' });
  });
  const openMs = await openFixture(name);
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

  const interactions = await canvas.evaluate(async (svg) => {
    const framesUntil = async (complete) => {
      const deadline = performance.now() + 2500;
      while (!complete()) {
        if (performance.now() >= deadline) throw new Error('Timed out waiting for the editor to render.');
        await new Promise(requestAnimationFrame);
      }
    };
    const layout = svg.closest('section[aria-label="PCB layout"]');
    const controls = [...layout.querySelectorAll('ul[aria-label="Placed components"] button')].slice(0, 2);
    const selectionMs = [];
    for (let i = 0; i < 12; i++) {
      const control = controls[i % 2];
      const before = performance.now();
      control.click();
      await framesUntil(() => [...layout.querySelectorAll('legend')]
        .some((legend) => legend.textContent.trim() === 'Position ' + control.textContent));
      selectionMs.push(performance.now() - before);
    }
    const zoomFrameMs = [];
    for (let i = 0; i < 20; i++) {
      const { x, y, width, height } = svg.getBoundingClientRect();
      const previous = svg.getAttribute('viewBox');
      const before = performance.now();
      svg.dispatchEvent(new WheelEvent('wheel', {
        clientX: x + width / 2, clientY: y + height / 2, deltaY: i % 2 ? 120 : -120,
        bubbles: true, cancelable: true,
      }));
      await framesUntil(() => svg.getAttribute('viewBox') !== previous);
      zoomFrameMs.push(performance.now() - before);
    }
    return { selectionMs, zoomFrameMs };
  });
  const net = page.getByLabel('Board net', { exact: true });
  await net.selectOption({ label: 'U1-1' });
  await page.getByRole('button', { name: 'Route track', exact: true }).click();
  const route = await canvas.evaluate(async (svg) => {
    const began = performance.now();
    const cursor = (x, y) => {
      const screen = new DOMPoint(x * 1e6, -y * 1e6).matrixTransform(svg.getScreenCTM());
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
  await page.getByRole('button', { name: 'Cancel route', exact: true }).click();

  const cancel = page.getByRole('button', { name: 'Cancel zone fill', exact: true });
  const refill = page.getByRole('button', { name: 'Refill zones', exact: true });
  await cancel.click();
  await refill.click();
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
  const refillStart = performance.now();
  await refill.click();
  await filled.waitFor({ timeout: 90_000 });
  const explicitRefillMs = performance.now() - refillStart;
  const beganChecks = performance.now();
  await page.getByRole('button', { name: 'Run design checks…' }).click();
  const check = page.getByRole('dialog', { name: 'PCB design checks' });
  await check.getByRole('list', { name: 'PCB findings' }).waitFor({ timeout: 90_000, state: 'attached' });
  const checksMs = performance.now() - beganChecks;
  await check.getByText('Physical connectivity · checked', { exact: true }).waitFor();
  const findings = await check.getByRole('list', { name: 'PCB findings' }).getByRole('listitem').count();
  await check.getByRole('button', { name: 'Close', exact: true }).click();
  const tasks = await page.evaluate(() => {
    const pending = window.classroomObserver?.takeRecords() ?? [];
    window.classroomObserver?.disconnect();
    return [...window.classroomTasks, ...pending.map(({ startTime, duration }) => ({ startTime, duration }))];
  });
  const routeLongTaskMs = tasks.filter(({ startTime, duration }) =>
    startTime < route.endTime && startTime + duration >= route.startTime).map(({ duration }) => duration);
  return {
    counts, openMs, refillAfterOpenMs, explicitRefillMs, checksMs, findings, cancelFillMs,
    ...interactions, routeReadyMs: route.readyMs, routePreviewMs: route.previewMs, routeLongTaskMs,
  };
}
