import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { verifyEngineArtifact } from '../engine-artifact.mjs';

async function fixture(run) {
  const parent = path.resolve('build/qualification/artifact-tests');
  await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, 'artifact-'));
  try {
    const lock = JSON.parse(
      await fs.readFile('build-support/ngspice/engine.lock.json', 'utf8'),
    );
    const bridge = (
      await fs.readFile('native/ngspice-host/host.cpp', 'utf8')
    ).replace(/\r?\n/g, '\r\n');
    const files = {
      'engine.lock.json': Buffer.from(JSON.stringify(lock)),
      'tinycad-ngspice-host.cpp': Buffer.from(bridge),
      'ngspice.js': Buffer.from('current test module'),
      'ngspice.wasm': Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
    };
    await fs.mkdir(path.join(directory, 'patches'));
    for (const name of Object.keys(lock.patches))
      await fs.copyFile(
        path.join('build-support/ngspice/patches', name),
        path.join(directory, 'patches', name),
      );
    const manifest = {
      protocol: 1,
      version: lock.version,
      source: lock.source,
      platform: 'wasm',
      arch: 'wasm32',
      configure: lock.configure,
      patches: Object.entries(lock.patches).map(([name, sha256]) => ({
        path: name,
        sha256,
      })),
      files: Object.entries(files).map(([name, bytes]) => ({
        path: name,
        size: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      })),
    };
    for (const [name, bytes] of Object.entries(files))
      await fs.writeFile(path.join(directory, name), bytes);
    const save = () =>
      fs.writeFile(
        path.join(directory, 'manifest.json'),
        JSON.stringify(manifest),
      );
    await save();
    await run({ directory, manifest, save, bridge });
  } finally {
    assert.ok(directory.startsWith(parent + path.sep));
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('qualified artifact staging accepts the pinned bridge with Windows line endings', async () =>
  fixture(async (f) => {
    assert.equal((await verifyEngineArtifact(f.directory)).platform, 'wasm');
  }));

test('artifact reuse rejects stale engines, different bridges and corrupt payloads', async () =>
  fixture(async (f) => {
    const version = f.manifest.version;
    f.manifest.version = 'old';
    await f.save();
    await assert.rejects(verifyEngineArtifact(f.directory), /version mismatch/);
    f.manifest.version = version;
    await f.save();
    await fs.appendFile(
      path.join(f.directory, 'tinycad-ngspice-host.cpp'),
      '\n// unreviewed bridge\n',
    );
    await assert.rejects(verifyEngineArtifact(f.directory), /bridge mismatch/);
    await fs.writeFile(
      path.join(f.directory, 'tinycad-ngspice-host.cpp'),
      f.bridge,
    );
    const bytes = await fs.readFile(path.join(f.directory, 'ngspice.wasm'));
    bytes[0] ^= 1;
    await fs.writeFile(path.join(f.directory, 'ngspice.wasm'), bytes);
    await assert.rejects(
      verifyEngineArtifact(f.directory),
      /integrity mismatch/,
    );
  }));
