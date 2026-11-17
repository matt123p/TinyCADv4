import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { expect } from '@playwright/test';
import { desktopSession } from './desktop-session.mjs';
import {
  parseExampleCatalog,
  exampleResourcePaths,
} from '../../shared/bundledExamples.js';

const exec = promisify(execFile);
const catalog = parseExampleCatalog(
  JSON.parse(await fs.readFile('tutorials/catalog.json', 'utf8')),
);
const resources = exampleResourcePaths(catalog);
const ids = [
  'first-run',
  'source-settings',
  'rc-transient',
  'ac-response',
  'rectifier-ripple',
];
const report = [];
for (const id of ids) {
  const relative = `spice/videos/${id}.mp4`;
  assert.ok(resources.has(relative), `Unpackaged video: ${relative}`);
  assert.ok(
    resources.has(`spice/videos/${id}.jpg`),
    `Unpackaged poster: ${id}`,
  );
  const file = path.resolve('tutorials', relative);
  const metadata = JSON.parse(
    (
      await exec('ffprobe', [
        '-v',
        'error',
        '-show_streams',
        '-show_format',
        '-of',
        'json',
        file,
      ])
    ).stdout,
  );
  const video = metadata.streams.find(
    (stream) => stream.codec_type === 'video',
  );
  assert.equal(video.codec_name, 'h264');
  assert.equal(video.width, 1600);
  assert.equal(video.height, 1000);
  assert.equal(video.pix_fmt, 'yuv420p');
  assert.equal(
    metadata.streams.length,
    1,
    'Captioned clips intentionally have no audio',
  );
  assert.ok(
    Number(metadata.format.duration) > 20 &&
      Number(metadata.format.duration) < 120,
  );
  const bytes = await fs.readFile(file);
  assert.ok(
    bytes.indexOf(Buffer.from('moov')) < bytes.indexOf(Buffer.from('mdat')),
    'MP4 must support fast start',
  );
  await exec('ffmpeg', [
    '-v',
    'error',
    '-xerror',
    '-i',
    file,
    '-f',
    'null',
    '-',
  ]);
  const capture = JSON.parse(
    await fs.readFile(file.replace('.mp4', '.json'), 'utf8'),
  );
  assert.ok(
    capture.checks.length,
    'Capture must retain checked UI result evidence',
  );
  assert.ok(capture.captions.length >= 6);
  assert.ok(
    Math.abs(capture.durationSeconds - Number(metadata.format.duration)) < 2,
  );
  const previous = capture.captions.map((cue) => cue.start);
  assert.ok(
    previous.every(
      (value, index) => index === 0 || value > previous[index - 1],
    ),
  );
  report.push({
    id,
    durationSeconds: Number(metadata.format.duration),
    bytes: bytes.length,
  });
}

if (process.argv.includes('--desktop')) {
  const session = await desktopSession();
  const { page } = session;
  try {
    await page
      .getByRole('button', { name: 'Open Example', exact: true })
      .click();
    await page
      .getByRole('navigation', { name: 'Example groups' })
      .getByRole('button', { name: 'SPICE tutorial', exact: true })
      .click();
    for (const [id, example] of [
      ['first-run', 'divider'],
      ['source-settings', 'source-sine'],
      ['rc-transient', 'rc-step'],
      ['ac-response', 'rc-ac'],
      ['rectifier-ripple', 'rectifier'],
    ]) {
      await page
        .getByRole('navigation', { name: 'Example groups' })
        .getByRole('button', { name: 'SPICE tutorial', exact: true })
        .click();
      // The selected lesson has one embedded video. No network media URL is used.
      await page
        .getByRole('dialog')
        .getByRole('button', { name: example, exact: true })
        .click();
      const video = page.getByRole('dialog').locator('video');
      await expect(video).toHaveAttribute('src', /^blob:/);
      await expect(video).toHaveAttribute('poster', /^blob:/);
      await expect(video).toHaveAttribute('preload', 'none');
      await video.scrollIntoViewIfNeeded();
      const result = await video.evaluate(async (element) => {
        const video = element;
        await video.play();
        await new Promise((resolve) => setTimeout(resolve, 600));
        video.pause();
        const first = video.currentTime;
        video.currentTime = Math.max(1, video.duration / 2);
        await new Promise((resolve, reject) => {
          video.addEventListener('seeked', resolve, { once: true });
          video.addEventListener(
            'error',
            () => reject(Error('Video decode failed')),
            { once: true },
          );
        });
        return {
          first,
          time: video.currentTime,
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          error: video.error?.message,
        };
      });
      assert.equal(result.error, undefined);
      assert.ok(result.first > 0, `${id} must play`);
      assert.ok(result.time > 10, `${id} must seek`);
      assert.equal(result.width, 1600);
      assert.equal(result.height, 1000);
      console.log(`Desktop playback and seeking passed: ${id}`);
    }
    await page.screenshot({
      path: 'build/tutorials/videos/embedded-player.png',
    });
  } finally {
    await session.close();
  }
}
console.log(JSON.stringify(report, null, 2));
