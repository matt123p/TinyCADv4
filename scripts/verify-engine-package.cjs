const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

module.exports = async (context) => {
  const platform = context.electronPlatformName;
  const arch = { 1: 'x64', 3: 'arm64' }[context.arch];
  if (!arch) throw new Error('Unsupported ngspice package architecture');
  const resources =
    platform === 'darwin'
      ? path.join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources',
        )
      : path.join(context.appOutDir, 'resources');
  const directory = path.join(resources, 'ngspice');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'),
  );
  if (
    manifest.platform !== platform ||
    manifest.arch !== arch ||
    manifest.protocol !== 1
  )
    throw new Error(
      'Packaged ngspice target does not match Electron target. Build separately for each architecture.',
    );
  // Sign nested Mach-O resources before recording their packaged hashes. The
  // outer app signing step skips these already-signed resources (mac.signIgnore).
  if (
    platform === 'darwin' &&
    process.env.CSC_IDENTITY_AUTO_DISCOVERY !== 'false'
  ) {
    const identities = execFileSync(
      'security',
      ['find-identity', '-v', '-p', 'codesigning'],
      { encoding: 'utf8' },
    );
    const identity = identities.match(
      /"(Developer ID Application:[^"]+)"/,
    )?.[1];
    if (
      !identity &&
      context.packager.platformSpecificBuildOptions.forceCodeSigning
    )
      throw new Error('No Developer ID available for bundled ngspice');
    if (identity) {
      for (const name of [
        manifest.helper,
        manifest.library,
        ...manifest.modules,
      ])
        execFileSync('codesign', [
          '--force',
          '--options',
          'runtime',
          '--timestamp',
          '--sign',
          identity,
          path.join(directory, name),
        ]);
      for (const entry of manifest.files) {
        const data = fs.readFileSync(path.join(directory, entry.path));
        entry.size = data.length;
        entry.sha256 = crypto.createHash('sha256').update(data).digest('hex');
      }
      fs.writeFileSync(
        path.join(directory, 'manifest.json'),
        JSON.stringify(manifest, null, 2) + '\n',
      );
    }
  }
  for (const entry of manifest.files) {
    const data = fs.readFileSync(path.join(directory, entry.path));
    if (crypto.createHash('sha256').update(data).digest('hex') !== entry.sha256)
      throw new Error(`Packaged engine integrity failure: ${entry.path}`);
  }
  const binaries = manifest.files
    .filter(
      (entry) =>
        /\.(?:exe|dll|cm|so|dylib)$/.test(entry.path) ||
        entry.path === manifest.helper,
    )
    .map((entry) => entry.path);
  for (const name of binaries) {
    if (!manifest.files.some((entry) => entry.path === name))
      throw new Error(`Missing required engine binary: ${name}`);
    const bytes = fs.readFileSync(path.join(directory, name));
    if (
      platform === 'linux' &&
      (bytes.toString('ascii', 1, 4) !== 'ELF' ||
        bytes.readUInt16LE(18) !== (arch === 'arm64' ? 183 : 62))
    )
      throw new Error(`Wrong ELF architecture: ${name}`);
    if (platform === 'win32') {
      if (bytes.toString('ascii', 0, 2) !== 'MZ')
        throw new Error(`Invalid Windows binary: ${name}`);
      const offset = bytes.readUInt32LE(0x3c);
      if (
        bytes.readUInt16LE(offset + 4) !== (arch === 'arm64' ? 0xaa64 : 0x8664)
      )
        throw new Error(`Wrong PE architecture: ${name}`);
    }
    if (
      platform === 'darwin' &&
      (bytes.readUInt32LE(0) !== 0xfeedfacf ||
        bytes.readUInt32LE(4) !== (arch === 'arm64' ? 0x0100000c : 0x01000007))
    )
      throw new Error(`Wrong Mach-O architecture: ${name}`);
  }
};
