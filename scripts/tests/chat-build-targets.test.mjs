import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
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
      assert.ok(assets.has('bundled-libraries/spice/openjellybean.json'));
      assert.ok(assets.has('bundled-libraries/spice/circsim.json'));
      const chatAssets = [...assets].filter(name => /^src\/(?:chat|components\/chat)\//.test(name));
      if (target === 'electron') {
        for (const name of ['src/components/chat/ChatPanel.tsx', 'src/chat/tools.ts', 'src/chat/providers.ts']) {
          assert.ok(chatAssets.includes(name), `Electron is missing ${name}`);
        }
      } else {
        assert.deepEqual(chatAssets, [], 'Browser builds must contain no chatbot UI, providers, tools, or workers');
      }
      const notices = path.join(directory, 'dist', 'licenses');
      assert.match(await readFile(path.join(notices, 'tinycad.txt'), 'utf8'), /TERMS AND CONDITIONS/);
      const index = JSON.parse(await readFile(path.join(notices, 'index.json'), 'utf8'));
      const readNotice = (name) => {
        const entries = index.filter((notice) => notice.name === name);
        assert.equal(entries.length, 1, `Expected one ${name} entry`);
        return readFile(path.join(notices, entries[0].file), 'utf8');
      };
      const react = await readNotice('React');
      assert.match(react, /react-dom /);
      assert.equal([...react.matchAll(/Permission is hereby granted/g)].length, 1);
      assert.ok(!index.some(({ name }) => ['react', 'react-dom', 'react-is', 'scheduler'].includes(name)));
      const fluent = await readNotice('Fluent UI');
      assert.match(fluent, /@fluentui\/react-icons /);
      assert.match(fluent, /Microsoft Corporation/);
      assert.match(fluent, /2020 Microsoft Corporation/);
      assert.equal([...fluent.matchAll(/Permission is hereby granted/g)].length, 1);
      assert.ok(!index.some(({ name }) => name.startsWith('@fluentui/')));
      assert.match(await readNotice('SQLite (via sql.js)'), /SQLite is in the public domain[\s\S]*Permission is hereby granted/);
      assert.match(await readNotice('ngspice'), /Ngspice Licensing[\s\S]*Kenneth S\. Kundert/);
      assert.match(await readNotice('OpenJellyBean'), /MIT License[\s\S]*openjellybean contributors/);
      assert.match(await readNotice('circsim'), /MIT License[\s\S]*circsim maintainers/);
      assert.match(await readNotice('Spice_Files'), /MIT License[\s\S]*Spice_Files contributors/);
      assert.match(await readNotice('ngspice special models'), /BSD 3-Clause License[\s\S]*Holger Vogt/);
      for (const foundry of ['SkyWater SKY130', 'GlobalFoundries GF180MCU', 'IHP SG13G2']) {
        assert.match(await readNotice(foundry), /Apache License[\s\S]*Version 2\.0/);
      }
      assert.ok(index.some(({ name, license }) => name === 'Liberation Fonts' && license === 'OFL-1.1'));
      assert.ok(!index.some(({ name }) => ['tslib', 'parcel', 'type-fest'].includes(name)));
      assert.ok(!index.some(({ name }) => name.startsWith('@types/')));
      assert.equal(index.some(({ name }) => name === 'electron-store'), target === 'electron');
      if (target === 'electron') {
        assert.match(await readNotice('XSPICE table code models'), /Version 2, June 1991/);
      } else {
        assert.ok(!index.some(({ name }) => name === 'XSPICE table code models'));
      }
      for (const { file } of index) {
        assert.match(file, /^[a-f0-9]{64}\.txt$/);
        assert.ok((await readFile(path.join(notices, file), 'utf8')).trim());
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
