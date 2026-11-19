import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function verifySignedMacBundle(appPath) {
  // Apple re-signs nested code for TestFlight and App Store delivery. Verify
  // the complete resource seal, nested code and Apple trust anchor instead of
  // comparing the pre-upload signature bytes of those executables.
  await execFileAsync('/usr/bin/codesign', [
    '--verify', '--deep', '--strict', '--all-architectures',
    '-R', '=anchor apple generic', appPath,
  ]);
}

export async function verifyEngineFiles(directory, manifest, {
  allowResignedCode = false,
  verifyBundle,
} = {}) {
  const executableNames = [manifest.helper, manifest.library, ...manifest.modules];
  const executables = new Set(executableNames);
  const verified = new Set();
  let needsBundleVerification = false;
  for (const entry of manifest.files) {
    if (!/^[A-Za-z0-9_.+-]+$/.test(entry.path))
      throw new Error('Invalid bundled engine path.');
    const data = await fs.readFile(path.join(directory, entry.path));
    if (crypto.createHash('sha256').update(data).digest('hex') !== entry.sha256) {
      if (!allowResignedCode || !executables.has(entry.path))
        throw new Error(`Bundled engine integrity check failed: ${entry.path}`);
      needsBundleVerification = true;
    }
    verified.add(entry.path);
  }
  if (!executableNames.every(file => verified.has(file)))
    throw new Error('Engine manifest has an unverified executable.');
  if (needsBundleVerification) {
    if (!verifyBundle) throw new Error('Signed bundle verification is required.');
    try {
      await verifyBundle();
    } catch (cause) {
      const detail = (cause.stderr || cause.message || String(cause)).trim();
      throw new Error(`Bundled engine code signature verification failed: ${detail}`, { cause });
    }
  }
}
