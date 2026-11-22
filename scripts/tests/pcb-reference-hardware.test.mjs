import assert from 'node:assert/strict';
import test from 'node:test';
import { assertReferenceDisplay, assertReferenceGraphics } from '../pcb/reference-hardware.mjs';

const integrated = { vendorId: 0x8086, deviceId: 0x5917 };
const accelerated = { webGL2: true, renderer: 'ANGLE (Intel UHD Graphics 620)' };

test('qualifies a 1920 × 1080 display and records hardware-backed WebGL 2 evidence', () => {
  assert.doesNotThrow(() => assertReferenceDisplay({ widthPx: 1920, heightPx: 1080 }));
  assert.throws(() => assertReferenceDisplay({ widthPx: 1280, heightPx: 720 }), /1920 × 1080/);
  assert.doesNotThrow(() => assertReferenceGraphics(accelerated, {}));
  assert.doesNotThrow(() => assertReferenceGraphics(
    { ...accelerated, renderer: null },
    { devices: [integrated], features: { webgl2: 'enabled' } },
  ));
});

test('rejects reference runs with software fallback or missing graphics evidence', () => {
  assert.throws(() => assertReferenceGraphics(
    { ...accelerated, renderer: 'ANGLE (Google, SwiftShader)' },
    { renderer: null, devices: [integrated] },
  ), /software rendering/);
  assert.throws(() => assertReferenceGraphics(
    accelerated, { features: { webgl2: 'unavailable_software' } },
  ), /Hardware-accelerated WebGL 2/);
  assert.throws(() => assertReferenceGraphics(
    { ...accelerated, renderer: null }, { devices: [] },
  ), /Could not identify/);
  assert.throws(() => assertReferenceGraphics(
    { ...accelerated, webGL2: false }, { devices: [integrated] },
  ), /WebGL 2 is unavailable/);
});
