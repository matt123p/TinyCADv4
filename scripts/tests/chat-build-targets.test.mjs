import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Parcel } from '@parcel/core';
import { FSCache } from '@parcel/cache';
import parcelFS from '@parcel/fs';

const root = fileURLToPath(new URL('../../', import.meta.url));

for (const [target, entry] of [
  ['filesystem', 'index-fs.html'],
  ['google', 'index-ga.html'],
  ['electron', 'index-electron.html'],
]) {
  test(`${target} bundles ${target === 'electron' ? 'include' : 'exclude'} the chatbot and LLM tools`, async () => {
    await mkdir(path.join(root, '.tmp'), { recursive: true });
    const directory = await mkdtemp(path.join(root, '.tmp/chat-build-'));
    try {
      const bundler = new Parcel({
        entries: path.join(root, entry),
        defaultConfig: '@parcel/config-default',
        mode: 'production',
        env: { TARGET_SYSTEM: target },
        shouldDisableCache: true,
        cacheDir: path.join(directory, 'cache'),
        cache: new FSCache(new parcelFS.NodeFS(), path.join(directory, 'cache')),
        shouldAutoInstall: false,
        logLevel: 'error',
        targets: { chatBuildTests: {
          context: 'browser', outputFormat: 'esmodule',
          distDir: path.join(directory, 'dist'), publicUrl: './',
          sourceMap: false, optimize: true,
        } },
      });
      const { bundleGraph } = await bundler.run();
      const assets = new Set();
      for (const bundle of bundleGraph.getBundles()) {
        bundle.traverseAssets(asset => assets.add(path.relative(root, asset.filePath).replaceAll('\\', '/')));
      }
      assert.ok(assets.has('src/components/pages/designApp.tsx'), 'Must inspect the real editor build');
      const chatAssets = [...assets].filter(name => /^src\/(?:chat|components\/chat)\//.test(name));
      if (target === 'electron') {
        for (const name of ['src/components/chat/ChatPanel.tsx', 'src/chat/tools.ts', 'src/chat/providers.ts']) {
          assert.ok(chatAssets.includes(name), `Electron is missing ${name}`);
        }
      } else {
        assert.deepEqual(chatAssets, [], 'Browser builds must contain no chatbot UI, providers, tools, or workers');
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
