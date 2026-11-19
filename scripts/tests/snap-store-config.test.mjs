import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SnapCore24 } = require('app-builder-lib/out/targets/snap/core24.js');
const { Arch } = require('builder-util');

test('generated Snap uses strict confinement without privileged browser sandbox access', async () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const core = new SnapCore24({
    executableName: 'tinycad',
    appInfo: { version: pkg.version, productName: pkg.productName },
  }, {
    getDesktopFileName: name => name,
    icons: Promise.resolve([]),
    getDescription: () => pkg.description,
    isElectronVersionGreaterOrEqualThan: () => true,
  }, pkg.build.snapcraft.core24);
  const descriptor = await core.mapSnapOptionsToSnapcraftYAML(Arch[process.arch]);
  assert.equal(descriptor.confinement, 'strict');
  assert(descriptor.apps.tinycad.plugs.includes('browser-support'));
  for (const plug of Object.values(descriptor.plugs || {}))
    assert.notEqual(plug['allow-sandbox'], true);
  assert.match(descriptor.apps.tinycad.command, / --no-sandbox(?: |$)/);
  for (const plug of ['home', 'desktop', 'network', 'x11', 'wayland', 'opengl'])
    assert(descriptor.apps.tinycad.plugs.includes(plug), `Missing ${plug}`);
});
