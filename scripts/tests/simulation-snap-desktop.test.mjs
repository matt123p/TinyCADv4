import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../fix-snap-desktop.cjs');
const { SnapCore24 } = require('app-builder-lib/out/targets/snap/core24.js');

test('core24 descriptor references the generated desktop source in snap/gui', async () => {
  const core = new SnapCore24(
    {
      appInfo: { version: '4.0.10', productName: 'TinyCAD' },
      executableName: 'tinycad',
    },
    {
      getDesktopFileName: (name) => name,
      getDescription: () => 'Circuit editor',
      isElectronVersionGreaterOrEqualThan: () => true,
      icons: Promise.resolve([]),
      maxIconPath: null,
    },
    { useDestructiveMode: true },
  );
  const descriptor = await core.createDescriptor(1);
  assert.equal(descriptor.apps.tinycad.desktop, 'gui/tinycad.desktop');
  assert.match(descriptor.apps.tinycad.command, /^app\/tinycad/);
  assert.equal(descriptor.base, 'core24');
  assert.equal(descriptor.parts.tinycad.source, 'app');
});
