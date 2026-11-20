import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(`Usage: npm run dist:mas -- [--dev] [--check]
Builds the host architecture only. Requires Node 22+, Xcode, Python 3,
Apple signing certificates and MAS_TEAM_ID / MAS_PROVISIONING_PROFILE.
See docs/mac-app-store.md for setup and sandbox testing.`);
  process.exit(0);
}
if (args.some(arg => !['--dev', '--check'].includes(arg)))
  throw new Error('Unknown option. Use --help.');
if (process.platform !== 'darwin') throw new Error('MAS builds require macOS.');
if (fs.existsSync('.env.local')) {
  for (const [key, value] of Object.entries(parseEnv(fs.readFileSync('.env.local', 'utf8'))))
    if (!(key in process.env)) process.env[key] = value;
}
const dev = args.includes('--dev');
const team = process.env.MAS_TEAM_ID;
const appId = process.env.MAS_APP_ID || 'com.tinycad.app';
const buildVersion = process.env.MAS_BUILD_VERSION || '4.1.1';
const encryptionDeclaration = process.env.MAS_USES_NON_EXEMPT_ENCRYPTION;
if (encryptionDeclaration !== undefined && !['true', 'false'].includes(encryptionDeclaration))
  throw new Error('MAS_USES_NON_EXEMPT_ENCRYPTION must be true or false.');
const profile = process.env[dev ? 'MAS_DEV_PROVISIONING_PROFILE' : 'MAS_PROVISIONING_PROFILE'];
if (!/^[A-Z0-9]{10}$/.test(team || '')) throw new Error('Set MAS_TEAM_ID to your Apple Team ID.');
if (!profile || !fs.existsSync(profile)) throw new Error('Set the MAS provisioning profile path; see docs/mac-app-store.md.');
if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false')
  throw new Error('MAS builds require signing; remove CSC_IDENTITY_AUTO_DISCOVERY=false.');
const run = (cmd, argv) => execFileSync(cmd, argv, { stdio: 'inherit', env: process.env });
const identities = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
const names = [...identities.matchAll(/"([^"]+)"/g)].map(match => match[1]);
const identity = names.find(name => name.includes(`(${team})`) &&
  (dev ? /^(Apple Development|Mac Developer):/.test(name) : /^(Apple Distribution|3rd Party Mac Developer Application):/.test(name)));
if (!identity) throw new Error('No matching Apple signing certificate with private key in the login keychain.');
process.env.MAS_ENGINE_IDENTITY = identity;
const decoded = execFileSync('security', ['cms', '-D', '-i', path.resolve(profile)]);
const pl = key => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, '/dev/stdin'], { input: decoded, encoding: 'utf8' }).trim();
const profileTeam = pl('TeamIdentifier:0');
const profileAppId = pl('Entitlements:com.apple.application-identifier');
if (profileTeam !== team || profileAppId !== `${team}.${appId}`)
  throw new Error(`Profile identifies ${profileAppId} (team ${profileTeam}); expected ${team}.${appId}. Set MAS_APP_ID to your registered bundle ID or download the matching profile.`);
if (new Date(pl('ExpirationDate')) <= new Date()) throw new Error('Provisioning profile has expired.');
run('xcrun', ['--find', 'productbuild']);
run('plutil', ['-lint', 'scripts/mas/entitlements.plist', 'scripts/mas/entitlements.inherit.plist']);
if (args.includes('--check')) {
  console.log('MAS configuration checked. Installer certificate is checked by electron-builder during packaging.');
  process.exit(0);
}
if (!['arm64', 'x64'].includes(process.arch)) throw new Error('Unsupported host architecture.');
const npm = argv => run(process.execPath, [process.env.npm_execpath || (() => { throw new Error('Run through npm run dist:mas'); })(), ...argv]);
await npm(['run', 'engine:native']);
await npm(['run', 'generate:icons']);
await npm(['run', 'generate:simulation-examples']);
await npm(['run', 'build:electron']);
const { build, Platform, Arch } = await import('electron-builder');
const artifacts = await build({
  targets: Platform.MAC.createTarget(dev ? 'mas-dev' : 'mas', Arch[process.arch]),
  publish: 'never',
  config: {
    appId,
    buildVersion,
    directories: { output: 'release/mas-store' },
    forceCodeSigning: true,
    mac: { category: 'public.app-category.productivity', notarize: false },
    mas: {
      identity: team,
      provisioningProfile: path.resolve(profile),
      entitlements: 'scripts/mas/entitlements.plist',
      entitlementsInherit: 'scripts/mas/entitlements.inherit.plist',
      hardenedRuntime: false,
      extendInfo: {
        ElectronTeamID: team,
        ...(encryptionDeclaration === undefined ? {} : {
          ITSAppUsesNonExemptEncryption: encryptionDeclaration === 'true',
        }),
      },
      artifactName: '${productName}-Mac-App-Store-${version}-${arch}.${ext}',
    },
  },
});
for (const artifact of artifacts.filter(file => file.endsWith('.pkg')))
  run('pkgutil', ['--check-signature', artifact]);
console.log(dev ? 'Development MAS app built in release/mas-store. Test sandbox workflows before submission.' :
  'Signed submission package built in release/mas-store. Upload the .pkg with Transporter.');
