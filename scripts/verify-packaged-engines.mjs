import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

let found = 0,
  qualified = 0;
async function visit(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const next = path.join(directory, entry.name);
    if (
      (entry.name === 'ngspice' && path.basename(directory) === 'Resources') ||
      (entry.name === 'ngspice' && path.basename(directory) === 'resources')
    ) {
      const manifest = JSON.parse(
        await fs.readFile(path.join(next, 'manifest.json'), 'utf8'),
      );
      found++;
      if (
        manifest.platform === process.platform &&
        manifest.arch === process.arch
      ) {
        const result = spawnSync(
          process.execPath,
          ['scripts/tests/qualify-engines.mjs', 'native'],
          {
            stdio: 'inherit',
            env: {
              ...process.env,
              TINYCAD_NATIVE_ENGINE_DIR: path.resolve(next),
            },
          },
        );
        if (result.status !== 0)
          throw new Error(
            `Packaged engine failed numerical qualification: ${next}`,
          );
        qualified++;
      }
    } else await visit(next);
  }
}
await visit('release');
if (!found) throw new Error('No packaged native engine resources found.');
console.log(
  `Packaged engines checked: ${found} targets, ${qualified} executable on this host.`,
);
// Verify the actual AppX container as well as the unpacked application tree.
for (const file of await fs.readdir('release')) {
  if (!file.endsWith('.appx')) continue;
  const result = spawnSync(
    process.execPath,
    ['scripts/verify-appx-package.mjs', path.join('release', file)],
    { stdio: 'inherit' },
  );
  if (result.status !== 0)
    throw new Error(`AppX archive qualification failed: ${file}`);
}
