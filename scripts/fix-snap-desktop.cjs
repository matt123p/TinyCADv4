// electron-builder's core24 generator writes snap/gui/*.desktop but points
// Snapcraft at snap/meta/gui/*.desktop. Snapcraft resolves this field relative
// to the assets directory after checking prime, so use gui/ for the source.
// https://github.com/canonical/snapcraft/blob/main/snapcraft/parts/setup_assets.py
const { SnapCore24 } = require('app-builder-lib/out/targets/snap/core24.js');
const original = SnapCore24.prototype.mapSnapOptionsToSnapcraftYAML;
if (typeof original !== 'function')
  throw new Error(
    'Review the Snap desktop-path workaround for this electron-builder version.',
  );
SnapCore24.prototype.mapSnapOptionsToSnapcraftYAML = async function (...args) {
  const descriptor = await original.apply(this, args);
  for (const app of Object.values(descriptor.apps || {})) {
    if (app.desktop?.startsWith('meta/gui/'))
      app.desktop = app.desktop.slice('meta/'.length);
  }
  return descriptor;
};
