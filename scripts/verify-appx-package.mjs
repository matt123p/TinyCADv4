import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  ZipReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  TextWriter,
} from '@zip.js/zip.js';

const file = process.argv[2];
if (!file)
  throw new Error('Usage: node scripts/verify-appx-package.mjs <package.appx>');
const reader = new ZipReader(new Uint8ArrayReader(await fs.readFile(file)));
try {
  const entries = await reader.getEntries();
  // AppX/MSIX percent-encodes payload names (e.g. libstdc++ becomes
  // libstdc%2B%2B). Match the deployed names, as the MSIX SDK decoder does.
  const deployed = new Map();
  for (const item of entries) {
    const name = decodeURIComponent(item.filename);
    assert.ok(!deployed.has(name), 'Duplicate deployed AppX path: ' + name);
    deployed.set(name, item);
  }
  const entry = (name) => {
    const found = deployed.get(name);
    if (!found || found.directory)
      throw new Error(`Missing AppX resource: ${name}`);
    return found;
  };
  const appManifest = await entry('AppxManifest.xml').getData(new TextWriter());
  for (const extension of ['dsn', 'dzn', 'tclib'])
    assert.match(
      appManifest,
      new RegExp(
        '<(?:\\w+:)?FileType(?:\\s[^>]*)?>\\s*\\.' + extension + '\\s*</',
      ),
      `Missing .${extension} association`,
    );
  const engineManifest = entries.find((item) =>
    item.filename.endsWith('/ngspice/manifest.json'),
  );
  assert.ok(engineManifest, 'AppX must contain its bundled native engine');
  const prefix = engineManifest.filename.slice(0, -'manifest.json'.length);
  const manifestText = await engineManifest.getData(new TextWriter());
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.platform, 'win32');
  assert.equal(manifest.protocol, 1);
  assert.ok(['x64', 'arm64'].includes(manifest.arch));
  assert.match(
    appManifest,
    new RegExp('ProcessorArchitecture="' + manifest.arch + '"'),
  );
  const workspace = await fs.realpath(process.cwd());
  await fs.mkdir(path.join(workspace, 'build'), { recursive: true });
  const buildRoot = await fs.realpath(path.join(workspace, 'build'));
  assert.ok(buildRoot.startsWith(workspace + path.sep));
  await fs.mkdir(path.join(buildRoot, 'qualification'), { recursive: true });
  const parent = await fs.realpath(path.join(buildRoot, 'qualification'));
  assert.ok(parent.startsWith(buildRoot + path.sep));
  const directory = path.join(parent, 'appx-runtime-' + manifest.arch);
  // This is a dedicated generated tree beneath build/qualification.
  assert.ok(directory.startsWith(parent + path.sep));
  try {
    const existing = await fs.realpath(directory);
    assert.ok(
      existing.startsWith(parent + path.sep),
      'Runtime staging path escaped qualification directory',
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fs.rm(directory, { recursive: true, force: true });
  await fs.mkdir(directory, { recursive: true });
  const verified = new Set();
  for (const record of manifest.files) {
    assert.match(record.path, /^[A-Za-z0-9_.+-]+$/);
    const bytes = await entry(prefix + record.path).getData(
      new Uint8ArrayWriter(),
      { checkSignature: true },
    );
    assert.equal(bytes.length, record.size, record.path + ' size');
    assert.equal(
      crypto.createHash('sha256').update(bytes).digest('hex'),
      record.sha256,
      record.path + ' integrity',
    );
    if (/\.(exe|dll|cm)$/i.test(record.path)) {
      const buffer = Buffer.from(bytes);
      assert.equal(buffer.toString('ascii', 0, 2), 'MZ', record.path);
      assert.equal(
        buffer.readUInt16LE(buffer.readUInt32LE(0x3c) + 4),
        manifest.arch === 'arm64' ? 0xaa64 : 0x8664,
        record.path + ' architecture',
      );
    }
    await fs.writeFile(path.join(directory, record.path), bytes);
    verified.add(record.path);
  }
  for (const name of [manifest.helper, manifest.library, ...manifest.modules])
    assert.ok(verified.has(name), 'Unverified engine binary: ' + name);
  await fs.writeFile(path.join(directory, 'manifest.json'), manifestText);
  for (const patch of manifest.patches) {
    const bytes = await entry(prefix + 'patches/' + patch.path).getData(
      new Uint8ArrayWriter(),
      { checkSignature: true },
    );
    assert.equal(
      crypto.createHash('sha256').update(bytes).digest('hex'),
      patch.sha256,
      patch.path + ' integrity',
    );
  }
  assert.ok(
    [...deployed.keys()].some((name) =>
      name.startsWith(prefix + 'runtime-licenses/'),
    ),
    'Missing runtime licences',
  );
  for (const name of ['voltage-divider', 'rc-charging', 'rc-low-pass'])
    assert.ok(
      entries.some((item) =>
        item.filename.endsWith('/examples/simulation/' + name + '.dsn'),
      ),
      'Missing teaching drawing: ' + name,
    );
  console.log(
    `AppX verified: win32/${manifest.arch}, ${verified.size} engine resources, .dsn/.dzn/.tclib associations.`,
  );
  console.log(
    'AppX signature entry: ' +
      (entries.some((item) => item.filename === 'AppxSignature.p7x')
        ? 'present (not cryptographically verified)'
        : 'absent (unsigned package)'),
  );
  if (process.platform === 'win32' && process.arch === manifest.arch) {
    const result = spawnSync(
      process.execPath,
      ['scripts/tests/qualify-engines.mjs', 'native'],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          TINYCAD_NATIVE_ENGINE_DIR: directory,
          TEMP: parent,
          TMP: parent,
          PATH: path.join(process.env.SystemRoot, 'System32'),
        },
      },
    );
    if (result.status !== 0)
      throw new Error(
        result.error?.message || 'AppX engine numerical qualification failed',
      );
  }
} finally {
  await reader.close();
}
