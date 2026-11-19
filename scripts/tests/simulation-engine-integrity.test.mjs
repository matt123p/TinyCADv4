import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { verifyEngineFiles, verifySignedMacBundle } from '../../electron/engine-integrity.js';

async function fixture(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tinycad-integrity-'));
  const names = ['host', 'ngspice.dylib', 'analog.cm', 'model.lib'];
  const files = names.map(name => ({ path: name, sha256: crypto.createHash('sha256').update(name).digest('hex') }));
  const manifest = { helper: 'host', library: 'ngspice.dylib', modules: ['analog.cm'], files };
  try {
    await Promise.all(names.map(name => fs.writeFile(path.join(directory, name), name)));
    await run(directory, manifest);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('unchanged engines pass without invoking signature verification', () => fixture(async (dir, manifest) => {
  await verifyEngineFiles(dir, manifest, { verifyBundle: () => assert.fail('unexpected verification') });
}));

test('macOS codesign accepts the inline Apple trust requirement', { skip: process.platform !== 'darwin' }, async () => {
  // Exercise the real CLI parser and trust evaluation, rather than mocking it.
  await verifySignedMacBundle('/usr/bin/true');
});

test('macOS signature verification rejects damaged Apple-signed code', { skip: process.platform !== 'darwin' }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tinycad-codesign-'));
  try {
    const file = path.join(directory, 'true');
    const bytes = await fs.readFile('/usr/bin/true');
    bytes[Math.floor(bytes.length / 2)] ^= 1;
    await fs.writeFile(file, bytes);
    await assert.rejects(verifySignedMacBundle(file));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('Store re-signing verifies the bundle once for all changed executables', () => fixture(async (dir, manifest) => {
  for (const name of ['host', 'ngspice.dylib', 'analog.cm']) await fs.appendFile(path.join(dir, name), 'new signature');
  let calls = 0;
  await verifyEngineFiles(dir, manifest, { allowResignedCode: true, verifyBundle: async () => { calls++; } });
  assert.equal(calls, 1);
  await assert.rejects(verifyEngineFiles(dir, manifest), /integrity check failed/);
}));

test('changed Store executable fails if its bundle signature is invalid or unchecked', () => fixture(async (dir, manifest) => {
  await fs.appendFile(path.join(dir, 'analog.cm'), 'damaged');
  await assert.rejects(verifyEngineFiles(dir, manifest, { allowResignedCode: true, verifyBundle: async () => { throw new Error('invalid signature'); } }), /code signature verification failed/);
  await assert.rejects(verifyEngineFiles(dir, manifest, { allowResignedCode: true }), /verification is required/);
}));

test('Store resource hashes remain mandatory', () => fixture(async (dir, manifest) => {
  await fs.appendFile(path.join(dir, 'model.lib'), 'damaged');
  await assert.rejects(verifyEngineFiles(dir, manifest, { allowResignedCode: true, verifyBundle: () => assert.fail('must reject resource') }), /integrity check failed: model.lib/);
}));

test('unlisted executables and unsafe manifest paths are rejected', () => fixture(async (dir, manifest) => {
  manifest.modules.push('missing.cm');
  await assert.rejects(verifyEngineFiles(dir, manifest), /unverified executable/);
  manifest.files[0].path = '../host';
  await assert.rejects(verifyEngineFiles(dir, manifest), /Invalid bundled engine path/);
}));
