const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const verify = require('./verify-engine-package.cjs');

// Windows signs executable resources after afterPack. Finalize their hashes
// before NSIS/AppX archives the app; macOS handles nested signing in afterPack.
module.exports = async (context) => {
  if (context.electronPlatformName !== 'win32') return;
  const directory = path.join(context.appOutDir, 'resources', 'ngspice');
  const manifestPath = path.join(directory, 'manifest.json');
  const original = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(original);
  let changed = 0;
  for (const entry of manifest.files) {
    const bytes = fs.readFileSync(path.join(directory, entry.path));
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (digest === entry.sha256) continue;
    if (
      !/\.(exe|dll|cm)$/i.test(entry.path) ||
      bytes.toString('ascii', 0, 2) !== 'MZ'
    )
      throw new Error(
        `Non-PE engine resource changed during signing: ${entry.path}`,
      );
    entry.sha256 = digest;
    entry.size = bytes.length;
    changed++;
  }
  if (changed)
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  try {
    await verify(context);
  } catch (error) {
    if (changed) fs.writeFileSync(manifestPath, original);
    throw error;
  }
  console.log(
    `Finalized Windows engine manifest: ${changed} changed binaries.`,
  );
};
