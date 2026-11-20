import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SnapCore24 } = require('app-builder-lib/out/targets/snap/core24.js');
const { Arch } = require('builder-util');

test('generated Snap stages the Electron runtime and launches in strict confinement', async () => {
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
  const stagePackages = descriptor.parts.tinycad['stage-packages'];
  for (const dependency of ['libnspr4', 'libnss3', 'libgtk-3-0t64', 'libcups2t64', 'libgbm1', 'libgl1', 'libglx-mesa0', 'libasound2t64'])
    assert(stagePackages?.includes(dependency), `Missing staged package ${dependency}`);
  assert(descriptor.environment.LD_LIBRARY_PATH.split(':').includes('$SNAP/usr/lib/x86_64-linux-gnu'));
  // The desktop socket is outside the runtime directory in a core24 Snap without the GNOME extension.
  assert.equal(descriptor.environment.XDG_SESSION_TYPE, 'x11');
  assert(descriptor.apps.tinycad.plugs.includes('browser-support'));
  for (const plug of Object.values(descriptor.plugs || {}))
    assert.notEqual(plug['allow-sandbox'], true);
  assert.match(descriptor.apps.tinycad.command, / --no-sandbox(?: |$)/);
  for (const plug of ['home', 'desktop', 'network', 'x11', 'wayland', 'opengl'])
    assert(descriptor.apps.tinycad.plugs.includes(plug), `Missing ${plug}`);
});
