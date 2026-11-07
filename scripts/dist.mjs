import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const workspaceRoot = process.cwd();

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: process.env,
    shell: false,
    windowsHide: true,
  });

  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) {
      resolve();
      return;
    }
    reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}`));
  });
});

const runPowerShellScript = (scriptPath, args = []) => run('powershell', [
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  scriptPath,
  ...args,
]);

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const contents = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
};

const envPath = path.resolve(workspaceRoot, '.env.local');
loadEnvFile(envPath);

const rawBuilderArgs = process.argv.slice(2);
const isTestAppxBuild = rawBuilderArgs.includes('--test-appx');
const builderArgs = rawBuilderArgs.filter((arg) => arg !== '--test-appx');
if (isTestAppxBuild) {
  const testPublisher = process.env.TEST_APPX_PUBLISHER;
  const missingTestVars = ['TEST_APPX_PUBLISHER']
    .filter((key) => !(process.env[key] && process.env[key].trim() !== ''));

  if (missingTestVars.length > 0) {
    throw new Error(
      `Signed test AppX build is missing ${missingTestVars.join(', ')}. `
      + 'Run "npm run setup:test-appx" first.',
    );
  }

  process.env.APPX_PUBLISHER = testPublisher;
}

if (process.env.APPX_PUBLISHER && process.env.APPX_PUBLISHER.trim() !== '') {
  builderArgs.push(`-c.appx.publisher=${process.env.APPX_PUBLISHER}`);
}

// Launch JavaScript CLIs directly: Windows .cmd shims need a shell, which
// otherwise breaks executable paths and arguments containing spaces.
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script through npm run dist.');
const runNpm = (args) => run(process.execPath, [npmCli, ...args]);
await runNpm(['run', 'generate:icons']);
await runNpm(['run', 'generate:simulation-examples']);

await runNpm(['run', 'build:electron']);
await run(process.execPath, [path.resolve('node_modules/electron-builder/cli.js'), ...builderArgs]);
await run(process.execPath, ['scripts/verify-packaged-engines.mjs']);

if (isTestAppxBuild) {
  const signScriptPath = path.resolve(workspaceRoot, 'scripts', 'sign-test-appx.ps1');
  await runPowerShellScript(signScriptPath);
}
