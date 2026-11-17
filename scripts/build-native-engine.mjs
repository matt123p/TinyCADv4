import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let command = process.env.PYTHON || 'python3';
let args = ['scripts/build-ngspice.py', 'native', ...process.argv.slice(2)];
const env = { ...process.env };
if (process.platform === 'win32') {
  const candidates = [
    env.MSYS2_ROOT,
    path.join(root, 'build/toolchains/msys64'),
    'C:/msys64',
  ].filter(Boolean);
  const toolchain = candidates.find((directory) =>
    fs.existsSync(path.join(directory, 'usr/bin/bash.exe')),
  );
  if (!toolchain)
    throw new Error(
      'Install MSYS2 UCRT64 (x64) or CLANGARM64 (ARM64), or set MSYS2_ROOT.',
    );
  if (!['x64', 'arm64'].includes(process.arch))
    throw new Error(`Unsupported Windows architecture: ${process.arch}`);
  const arm = process.arch === 'arm64';
  const compiler = path.join(
    toolchain,
    arm ? 'clangarm64/bin/clang.exe' : 'ucrt64/bin/gcc.exe',
  );
  if (!fs.existsSync(compiler))
    throw new Error(
      `Missing native compiler: ${compiler}. Install the matching MSYS2 UCRT64 or CLANGARM64 compiler toolchain.`,
    );
  command = path.join(toolchain, 'usr/bin/bash.exe');
  env.MSYSTEM = arm ? 'CLANGARM64' : 'UCRT64';
  env.CHERE_INVOKING = '1';
  env.TINYCAD_ENGINE_WORKSPACE = root;
  env.CC = arm ? 'clang' : 'gcc';
  env.CXX = arm ? 'clang++' : 'g++';
  const extra = process.argv.slice(2);
  if (extra.some((arg) => arg !== '--stage-only'))
    throw new Error(
      'Windows launcher supports only --stage-only; use the MSYS2 shell for other build options.',
    );
  // Pass the checkout through the environment; quoting paths with spaces must
  // not change which source tree is built or execute shell substitutions.
  args = [
    '--login',
    '-c',
    'set -e; cd "$(cygpath -u "$TINYCAD_ENGINE_WORKSPACE")"; python3 scripts/build-ngspice.py native' +
      (extra.includes('--stage-only') ? ' --stage-only' : ''),
  ];
}
const child = spawn(command, args, {
  cwd: root,
  env,
  stdio: 'inherit',
  windowsHide: true,
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
