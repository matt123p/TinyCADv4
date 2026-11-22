import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import os from 'node:os';

export async function readReferenceHardware(file) {
  const reported = JSON.parse(await readFile(file, 'utf8'));
  assert(reported && typeof reported === 'object', 'Record the reference laptop hardware.');
  const { model, physicalCores, installedRamGiB, integratedGpu, stableBrowser } = reported;
  assert(typeof model === 'string' && model.trim(), 'Record the exact reference laptop model.');
  assert.equal(physicalCores, 4, 'The reference laptop requires four physical CPU cores.');
  assert.equal(installedRamGiB, 8, 'The reference laptop requires 8 GiB of installed RAM.');
  assert(typeof integratedGpu === 'string' && integratedGpu.trim(), 'Record the exact integrated GPU model.');
  assert(['chrome', 'msedge'].includes(stableBrowser), 'Choose the installed stable Chrome or Edge channel.');
  assert(os.cpus().length >= 4, 'The running host reports fewer than four logical cores.');
  assert(os.totalmem() <= 8 * 1024 ** 3,
    'The running host reports more usable memory than the 8 GiB reference laptop.');
  return { model, physicalCores, installedRamGiB, integratedGpu, stableBrowser };
}

export function assertReferenceDisplay({ widthPx, heightPx }) {
  assert.equal(widthPx, 1920, 'Set the reference display to 1920 × 1080.');
  assert.equal(heightPx, 1080, 'Set the reference display to 1920 × 1080.');
}

export async function referenceWindowEvidence(page) {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return {
      display: {
        widthPx: Math.round(screen.width * devicePixelRatio),
        heightPx: Math.round(screen.height * devicePixelRatio),
        scaleFactor: devicePixelRatio,
      },
      webGL2: !!gl,
      renderer,
    };
  });
}

export function assertReferenceGraphics(observed, { renderer, devices, features }) {
  const names = [renderer, observed.renderer].filter((name) => typeof name === 'string' && name.trim());
  assert(!names.some((name) => /SwiftShader|llvmpipe|software rasterizer|Microsoft Basic Render Driver|\bWARP\b/i.test(name)),
    'The reference run is using software rendering. Enable the laptop’s integrated GPU.');
  assert(observed.webGL2, 'WebGL 2 is unavailable on the reference display.');
  assert(!/software|disabled|unavailable/i.test(features?.webgl2 ?? ''),
    'Hardware-accelerated WebGL 2 is unavailable.');
  assert(names.length || devices?.some(({ vendorId, deviceId }) => vendorId > 0 && deviceId > 0),
    'Could not identify the graphics device used by the reference run.');
}

export async function referenceBrowserEvidence(browser, session) {
  const context = await browser.newContext({ viewport: null });
  try {
    const observed = await referenceWindowEvidence(await context.newPage());
    assertReferenceDisplay(observed.display);
    const { gpu } = await session.send('SystemInfo.getInfo');
    const renderer = gpu.auxAttributes?.glRenderer ?? null;
    assertReferenceGraphics(observed, {
      renderer,
      devices: gpu.devices,
      features: gpu.featureStatus,
    });
    return {
      display: observed.display,
      renderer,
      webGLRenderer: observed.renderer,
      devices: gpu.devices,
      features: gpu.featureStatus,
    };
  } finally {
    await context.close();
  }
}
