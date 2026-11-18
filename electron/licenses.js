import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export function registerLicenseHandlers({ ipcMain, app, shell, getWindow }) {
  const dist = path.join(root, 'dist', 'licenses');
  const engine = app.isPackaged
    ? path.join(process.resourcesPath, 'ngspice')
    : path.join(root, 'build', 'engines', 'native');
  const electron = app.isPackaged
    ? path.join(process.resourcesPath, 'electron-licenses')
    : path.join(root, 'node_modules', 'electron', 'dist');
  const chromium = path.join(electron, 'LICENSES.chromium.html');
  const runtime = path.join(engine, 'runtime-licenses');
  const files = {
    'tinycad.txt': path.join(dist, 'tinycad.txt'),
    'electron.txt': path.join(electron, 'LICENSE'),
    'mingw-crt.txt': path.join(runtime, 'crt', 'COPYING.MinGW-w64-runtime.txt'),
    'winpthreads.txt': path.join(runtime, 'libwinpthread', 'COPYING'),
    'libcxx.txt': path.join(runtime, 'libc++', 'LICENSE'),
    'libunwind.txt': path.join(runtime, 'libunwind', 'LICENSE'),
  };
  const gccDirectory = path.join(runtime, 'libgcc');
  const readText = (file) => readFile(file, 'utf8');

  function assertMainFrame(event) {
    const contents = getWindow()?.webContents;
    if (!contents || event.sender !== contents || !event.senderFrame || event.senderFrame !== contents.mainFrame) {
      throw new Error('License requests must come from the TinyCAD window');
    }
  }

  ipcMain.handle('licenses-index', async (event) => {
    assertMainFrame(event);
    const notices = JSON.parse(await readText(path.join(dist, 'index.json')));
    const version = process.versions.electron;
    notices.push({ name: 'Electron', version, license: 'MIT', file: 'electron.txt' });
    notices.push({ name: 'Chromium and bundled components', version: process.versions.chrome, file: 'chromium' });
    const manifestPath = path.join(engine, 'manifest.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(await readText(manifestPath));
      if (manifest.platform === 'win32') {
        if (existsSync(files['mingw-crt.txt'])) {
          notices.push({ name: 'MinGW-w64 runtime', license: 'Bundled runtime notices', file: 'mingw-crt.txt' });
        }
        if (manifest.files.some(({ path }) => path === 'libwinpthread-1.dll') && existsSync(files['winpthreads.txt'])) {
          notices.push({ name: 'MinGW-w64 winpthreads', license: 'MIT', file: 'winpthreads.txt' });
        }
        if (manifest.arch === 'x64' && existsSync(path.join(gccDirectory, 'COPYING.RUNTIME'))) {
          notices.push({ name: 'GCC runtime libraries', license: 'GPL-3.0-or-later with GCC Runtime Library Exception', file: 'gcc.txt' });
        }
        // The Windows ARM64 build links the helper with the MSYS2 LLVM C++ runtime.
        if (manifest.arch === 'arm64') {
          const license = 'Apache-2.0 WITH LLVM-exception';
          if (existsSync(files['libcxx.txt'])) notices.push({ name: 'LLVM libc++', license, file: 'libcxx.txt' });
          if (existsSync(files['libunwind.txt'])) notices.push({ name: 'LLVM libunwind', license, file: 'libunwind.txt' });
        }
      }
    }
    return notices.sort((a, b) => a.name.localeCompare(b.name));
  });

  ipcMain.handle('licenses-read', async (event, file) => {
    assertMainFrame(event);
    if (typeof file !== 'string') throw new Error('Unknown license file');
    if (Object.hasOwn(files, file)) return readText(files[file]);
    if (/^[a-f0-9]{64}\.txt$/.test(file)) return readText(path.join(dist, file));
    if (file === 'gcc.txt') {
      const texts = await Promise.all(['COPYING3', 'COPYING.RUNTIME'].map((name) => readText(path.join(gccDirectory, name))));
      return texts.join('\n\n');
    }
    throw new Error('Unknown license file');
  });

  ipcMain.handle('licenses-open-chromium', async (event) => {
    assertMainFrame(event);
    const error = await shell.openPath(chromium);
    if (error) throw new Error(error);
  });
}
