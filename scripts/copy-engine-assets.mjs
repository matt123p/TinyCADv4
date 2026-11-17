import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const source = 'public/engines/ngspice';
const manifest = JSON.parse(
  await fs.readFile(`${source}/manifest.json`, 'utf8'),
);
if (manifest.protocol !== 1 || manifest.platform !== 'wasm')
  throw new Error(
    'Build the pinned WASM engine before building the browser UI.',
  );
for (const entry of manifest.files) {
  const bytes = await fs.readFile(`${source}/${entry.path}`);
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
    throw new Error(`Engine integrity check failed: ${entry.path}`);
}
await fs.mkdir('dist/engines', { recursive: true });
await fs.cp(source, 'dist/engines/ngspice', { recursive: true });
