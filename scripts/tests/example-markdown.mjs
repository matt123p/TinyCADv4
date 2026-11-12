import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Exercise the real Markdown parser, sanitizer and browser DOM. Resource I/O is
// supplied by a fixture; binary loading and desktop IPC are covered separately.
const compiled = await build({
  entryPoints: ['src/io/exampleMarkdown.ts'],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  globalName: 'markdownTest',
  plugins: [
    {
      name: 'example-resource-fixture',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/examples$/ }, () => ({
          path: 'fixture',
          namespace: 'fixture',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `
      export const exampleResources = {
        catalog: async () => window.fixture,
        description: async item => item.description,
        media: async path => {
          window.reads.push(path);
          const url = URL.createObjectURL(new Blob(['fixture'], {type: path.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg'}));
          return {url, dispose() { window.disposed.push(url); URL.revokeObjectURL(url); }};
        }
      };
    `,
        }));
      },
    },
  ],
});
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: compiled.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    window.fixture = {
      version: 1,
      groups: [],
      assets: ['videos/demo.mp4', 'images/poster.jpg'],
    };
    window.reads = [];
    window.disposed = [];
    const rendered = await markdownTest.renderExampleMarkdown(
      {
        descriptionPath: 'notes/lesson.md',
        description: `
<video src="../videos/demo.mp4" poster="../images/poster.jpg" autoplay loop onplay="alert(1)">
<source src="https://invalid.example/remote.mp4"><track src="https://invalid.example/captions.vtt">
</video>

[Download](../videos/demo.mp4)

<video src="https://invalid.example/remote.mp4" poster="https://invalid.example/poster.jpg"></video>
<video src="../../outside.mp4"></video>
<video src="../images/poster.jpg"></video>
![Invalid image](../videos/demo.mp4)
<script>alert(1)</script>
`,
      },
      new AbortController().signal,
    );
    const document = new DOMParser().parseFromString(
      rendered.html,
      'text/html',
    );
    const videos = [...document.querySelectorAll('video')];
    const local = videos[0];
    const url = local.getAttribute('src');
    const loaded = await (await fetch(url)).text();
    const answer = {
      count: videos.length,
      local: url,
      poster: local.getAttribute('poster'),
      controls: local.controls,
      preload: local.preload,
      autoplay: local.autoplay,
      loop: local.loop,
      remote: videos
        .slice(1)
        .map((video) => [
          video.getAttribute('src'),
          video.getAttribute('poster'),
        ]),
      forbidden: document.querySelectorAll('script, source, track, [onplay]')
        .length,
      imageSource: document.querySelector('img').getAttribute('src'),
      download: document.querySelector('a').getAttribute('href'),
      reads: window.reads,
      loaded,
    };
    rendered.dispose();
    answer.disposed = window.disposed;
    answer.revoked = await fetch(url).then(
      () => false,
      () => true,
    );
    return answer;
  });
  assert.equal(result.count, 4);
  assert.match(result.local, /^blob:/);
  assert.match(result.poster, /^blob:/);
  assert.equal(result.controls, true);
  assert.equal(result.preload, 'none');
  assert.equal(result.autoplay, false);
  assert.equal(result.loop, false);
  assert.deepEqual(result.remote, [
    [null, null],
    [null, null],
    [null, null],
  ]);
  assert.equal(result.forbidden, 0);
  assert.equal(result.imageSource, null);
  assert.equal(
    result.download,
    result.local,
    'player and download link share the same blob',
  );
  assert.deepEqual(result.reads.sort(), [
    'images/poster.jpg',
    'videos/demo.mp4',
  ]);
  assert.equal(result.disposed.length, 2);
  assert.equal(result.loaded, 'fixture');
  assert.equal(result.revoked, true);
  console.log(
    'Markdown media checks passed: local playback URLs, posters, downloads, sanitization, deduplication and disposal.',
  );
} finally {
  await browser.close();
}
