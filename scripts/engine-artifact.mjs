import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const normalized = (text) => text.replace(/\r\n/g, '\n');

// Packaging may reuse qualified engine jobs while changing application code.
// Require the current engine source, patches, configuration and bridge first.
export async function verifyEngineArtifact(source) {
  const lock = JSON.parse(
    await fs.readFile(
      path.join(root, 'build-support/ngspice/engine.lock.json'),
      'utf8',
    ),
  );
  const manifest = JSON.parse(
    await fs.readFile(path.join(source, 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.protocol, 1, 'Engine artifact protocol mismatch');
  assert.equal(
    manifest.version,
    lock.version,
    'Engine artifact version mismatch',
  );
  assert.deepEqual(
    manifest.source,
    lock.source,
    'Engine artifact source mismatch',
  );
  assert.ok(
    ['wasm', 'win32', 'linux', 'darwin'].includes(manifest.platform),
    'Unsupported engine artifact platform',
  );
  assert.ok(
    manifest.platform === 'wasm'
      ? manifest.arch === 'wasm32'
      : ['x64', 'arm64'].includes(manifest.arch),
    'Unsupported engine artifact architecture',
  );
  assert.deepEqual(
    Object.fromEntries(manifest.patches.map((p) => [p.path, p.sha256])),
    lock.patches,
    'Engine artifact patch mismatch',
  );
  assert.ok(
    lock.configure.every((flag) => manifest.configure.includes(flag)),
    'Engine artifact configuration mismatch',
  );
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(path.join(source, 'engine.lock.json'), 'utf8'),
    ),
    lock,
    'Engine artifact lock mismatch',
  );
  assert.equal(
    normalized(
      await fs.readFile(path.join(source, 'tinycad-ngspice-host.cpp'), 'utf8'),
    ),
    normalized(
      await fs.readFile(
        path.join(root, 'native/ngspice-host/host.cpp'),
        'utf8',
      ),
    ),
    'Engine artifact bridge mismatch',
  );
  const verified = new Set();
  for (const entry of manifest.files) {
    assert.match(entry.path, /^[A-Za-z0-9_.+-]+$/);
    assert.ok(
      !['.', '..'].includes(entry.path),
      'Invalid engine artifact path',
    );
    const bytes = await fs.readFile(path.join(source, entry.path));
    assert.equal(bytes.length, entry.size, entry.path + ' size mismatch');
    assert.equal(hash(bytes), entry.sha256, entry.path + ' integrity mismatch');
    verified.add(entry.path);
  }
  for (const patch of manifest.patches)
    assert.equal(
      hash(await fs.readFile(path.join(source, 'patches', patch.path))),
      patch.sha256,
      patch.path + ' integrity mismatch',
    );
  if (manifest.platform !== 'wasm')
    for (const name of [manifest.helper, manifest.library, ...manifest.modules])
      assert.ok(verified.has(name), 'Unverified engine binary: ' + name);
  else
    for (const name of ['ngspice.js', 'ngspice.wasm'])
      assert.ok(verified.has(name), 'Unverified WASM engine binary: ' + name);
  return manifest;
}
