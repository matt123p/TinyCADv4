import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import finalize from '../finalize-signed-engine.cjs';

const digest = (bytes) =>
  crypto.createHash('sha256').update(bytes).digest('hex');
async function fixture(run) {
  const parent = path.resolve('build/qualification/signing-tests');
  await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, 'package-'));
  const engine = path.join(directory, 'resources/ngspice');
  await fs.mkdir(engine, { recursive: true });
  const pe = Buffer.alloc(128);
  pe.write('MZ');
  pe.writeUInt32LE(64, 0x3c);
  pe.writeUInt16LE(0x8664, 68);
  const entries = [
    ['helper.exe', pe],
    ['ngspice.dll', pe],
    ['source.txt', Buffer.from('locked source')],
  ];
  const manifest = {
    platform: 'win32',
    arch: 'x64',
    protocol: 1,
    helper: 'helper.exe',
    library: 'ngspice.dll',
    modules: [],
    files: entries.map(([name, bytes]) => ({
      path: name,
      size: bytes.length,
      sha256: digest(bytes),
    })),
  };
  for (const [name, bytes] of entries)
    await fs.writeFile(path.join(engine, name), bytes);
  const manifestPath = path.join(engine, 'manifest.json');
  const original = JSON.stringify(manifest);
  await fs.writeFile(manifestPath, original);
  try {
    await run({
      engine,
      manifestPath,
      original,
      context: { electronPlatformName: 'win32', arch: 1, appOutDir: directory },
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('unsigned Windows packaging preserves its verified manifest exactly', async () =>
  fixture(async (f) => {
    await finalize(f.context);
    assert.equal(await fs.readFile(f.manifestPath, 'utf8'), f.original);
  }));

test('post-signing finalization records changed PE hashes and sizes', async () =>
  fixture(async (f) => {
    // Simulate signer byte changes; this is not Authenticode verification.
    for (const name of ['helper.exe', 'ngspice.dll'])
      await fs.appendFile(path.join(f.engine, name), 'signer bytes');
    await finalize(f.context);
    const manifest = JSON.parse(await fs.readFile(f.manifestPath, 'utf8'));
    for (const entry of manifest.files) {
      const bytes = await fs.readFile(path.join(f.engine, entry.path));
      assert.equal(entry.sha256, digest(bytes));
      assert.equal(entry.size, bytes.length);
    }
  }));

test('post-signing finalization rejects changed source resources transactionally', async () =>
  fixture(async (f) => {
    await fs.appendFile(path.join(f.engine, 'helper.exe'), 'signer bytes');
    await fs.appendFile(path.join(f.engine, 'source.txt'), 'unexpected change');
    await assert.rejects(finalize(f.context), /Non-PE engine resource changed/);
    assert.equal(await fs.readFile(f.manifestPath, 'utf8'), f.original);
  }));

test('post-signing finalization rejects a wrong PE architecture without retaining new hashes', async () =>
  fixture(async (f) => {
    const file = path.join(f.engine, 'helper.exe'),
      bytes = await fs.readFile(file);
    bytes.writeUInt16LE(0xaa64, 68);
    await fs.writeFile(file, bytes);
    await assert.rejects(finalize(f.context), /Wrong PE architecture/);
    assert.equal(await fs.readFile(f.manifestPath, 'utf8'), f.original);
  }));
