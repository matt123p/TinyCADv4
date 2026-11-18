const { Reporter } = require('@parcel/plugin');
const path = require('node:path');

module.exports = new Reporter({
  async report({ event, options }) {
    if (event.type !== 'buildSuccess') return;
    const { writeLicenseFiles } = await import('./lib/license-files.mjs');
    const bundlesByDirectory = new Map();
    for (const bundle of event.bundleGraph.getBundles()) {
      const directory = bundle.target.distDir;
      if (!bundlesByDirectory.has(directory)) bundlesByDirectory.set(directory, new Set());
      const files = bundlesByDirectory.get(directory);
      bundle.traverseAssets((asset) => files.add(asset.filePath));
    }
    for (const [directory, files] of bundlesByDirectory) {
      await writeLicenseFiles(options.projectRoot, path.join(directory, 'licenses'), files, options.env.TARGET_SYSTEM);
    }
  },
});
