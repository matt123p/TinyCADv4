import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const bin = (name) => (process.platform === 'win32' ? `${name}.cmd` : name);
const workspaceRoot = process.cwd();

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: process.env,
    shell: true,
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

await run(bin('npm'), ['run', 'generate:icons']);

await run(bin('npm'), ['run', 'build:electron']);
await run(bin('electron-builder'), builderArgs);

if (isTestAppxBuild) {
  const signScriptPath = path.resolve(workspaceRoot, 'scripts', 'sign-test-appx.ps1');
  await runPowerShellScript(signScriptPath);
}
