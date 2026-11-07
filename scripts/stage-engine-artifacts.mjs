import fs from 'node:fs/promises';
import path from 'node:path';
for (const directory of await fs.readdir('build/engine-artifacts')) {
  const source = path.join('build/engine-artifacts', directory);
  const manifest = JSON.parse(
    await fs.readFile(path.join(source, 'manifest.json'), 'utf8'),
  );
  if (manifest.platform === 'wasm') {
    await fs.cp(source, 'public/engines/ngspice', { recursive: true });
  } else if (manifest.platform === process.platform) {
    await fs.cp(source, `build/engines/native-${manifest.arch}`, {
      recursive: true,
    });
    if (manifest.arch === process.arch)
      await fs.cp(source, 'build/engines/native', { recursive: true });
    if (process.platform !== 'win32') {
      await fs.chmod(
        `build/engines/native-${manifest.arch}/${manifest.helper}`,
        0o755,
      );
      if (manifest.arch === process.arch)
        await fs.chmod(`build/engines/native/${manifest.helper}`, 0o755);
    }
  }
}
