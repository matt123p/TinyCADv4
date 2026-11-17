import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { loadComponent } from './load-component.mjs';
const require = createRequire(import.meta.url);
const properties = loadComponent('src/model/imageProperties.ts', {});
const { imagePixelSize, imageClip, setImageProperties } = properties;
const { updateRectBase } = loadComponent('src/manipulators/updateRectBase.ts', {
  'immutability-helper': require('immutability-helper'),
});
const { updateImage } = loadComponent('src/manipulators/updateImage.ts', {
  './updateRectBase': { updateRectBase },
});
const bitmap = async (format) => ({
  id: 1,
  type: format.toUpperCase(),
  imageData: `data:image/${format};base64,${(
    await sharp({
      create: { width: 200, height: 100, channels: 3, background: 'red' },
    })
      .toFormat(format)
      .toBuffer()
  ).toString('base64')}`,
});

test('clipping reads PNG/JPEG dimensions, preserves pixel scale and does not alter shared image data', async () => {
  for (const format of ['png', 'jpeg']) {
    const imageData = await bitmap(format);
    const item = {
      NodeName: 'image',
      point: [100, 100],
      point_b: [500, 300],
      imageData,
    };
    assert.deepEqual(imagePixelSize(imageData), [200, 100]);
    assert.deepEqual(imageClip(item), {
      clip_left: 0,
      clip_right: 0,
      clip_top: 0,
      clip_bottom: 0,
    });
    const clipped = setImageProperties(item, {
      clip_left: 10,
      clip_right: 20,
      clip_top: 5,
      clip_bottom: 15,
    });
    assert.deepEqual(clipped.point, [120, 110]);
    assert.deepEqual(clipped.point_b, [460, 270]);
    assert.equal(clipped.imageData, item.imageData);
    assert.deepEqual(item.point, [100, 100]);
    const restored = setImageProperties(clipped, {
      clip_left: 0,
      clip_right: 0,
      clip_top: 0,
      clip_bottom: 0,
    });
    assert.deepEqual(restored.point, item.point);
    assert.deepEqual(restored.point_b, item.point_b);
    const limited = setImageProperties(clipped, {
      clip_left: 999,
      clip_top: -5,
      clip_bottom: NaN,
    });
    assert.equal(limited.clip_left, 179);
    assert.equal(limited.clip_right, 20);
    assert.equal(limited.clip_top, 0);
    assert.equal(limited.clip_bottom, 15);
  }
});

test('fixed aspect ratio holds for all eight resize handles and keeps opposite anchors fixed', () => {
  const item = {
    NodeName: 'image',
    point: [0, 0],
    point_b: [200, 100],
    fixed_aspect: true,
  };
  const snap = { snap: (p) => p };
  for (let handle = 1; handle <= 8; handle++) {
    const result = new updateImage(item).mouse_move(
      { a: null, b: null },
      [20, 7],
      handle,
      snap,
    ).obj;
    const [x, y] = result.point,
      [right, bottom] = result.point_b;
    assert.equal((right - x) / (bottom - y), 2, `handle ${handle}`);
    if ([1, 3, 5].includes(handle)) assert.equal(right, 200);
    if ([2, 4, 7].includes(handle)) assert.equal(x, 0);
    if ([1, 2, 6].includes(handle)) assert.equal(bottom, 100);
    if ([3, 4, 8].includes(handle)) assert.equal(y, 0);
    if ([5, 7].includes(handle)) assert.equal((y + bottom) / 2, 50);
    if ([6, 8].includes(handle)) assert.equal((x + right) / 2, 100);
  }
  const free = new updateImage({ ...item, fixed_aspect: false }).mouse_move(
    { a: null, b: null },
    [20, 0],
    7,
    snap,
  ).obj;
  assert.equal(free.point_b[0], 220);
  assert.equal(free.point_b[1], 100);
  const crossed = new updateImage(item).mouse_move(
    { a: null, b: null },
    [-300, 0],
    7,
    snap,
  ).obj;
  assert.equal(crossed, item);
});

test('reset aspect ratio restores cropped source proportions while preserving width, position and lock setting', async () => {
  const imageData = await bitmap('png');
  for (const fixed_aspect of [false, true]) {
    const item = { NodeName: 'image', point: [100, 100], point_b: [440, 400],
      imageData, fixed_aspect, clip_left: 10, clip_right: 20, clip_top: 5, clip_bottom: 15 };
    const reset = setImageProperties(item, {reset_aspect:true});
    assert.deepEqual(reset.point, [100, 100]);
    assert.deepEqual(reset.point_b, [440, 260]);
    assert.equal(reset.fixed_aspect, fixed_aspect);
    assert.deepEqual(imageClip(reset), imageClip(item));
    assert.equal(reset.imageData, imageData);
    assert.equal('reset_aspect' in reset, false);
    assert.deepEqual(item.point_b, [440, 400]);
  }
});
