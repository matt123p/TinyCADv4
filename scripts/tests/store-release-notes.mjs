import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  extractReleaseNotes,
  plainReleaseNotes,
  withStoreReleaseNotes,
} from '../lib/release-notes.mjs';
import { load } from 'js-yaml';

const changelog =
  '# Changelog\r\n\r\n## Unreleased\r\n\r\n- Future work\r\n\r\n' +
  '## v1.2.3 — 2026-11-10\r\n\r\n### Added\r\n\r\n- **Bold** and `code`, [help](https://example.com).\r\n' +
  '\r\n```text\r\n## not a release heading\r\n```\r\n\r\n## v1.2.2 — 2026-11-01\r\n\r\n- Old changes\r\n';
const notes = extractReleaseNotes(changelog, '1.2.3');
assert.match(notes, /## not a release heading/);
assert.ok(!notes.includes('Future work') && !notes.includes('Old changes'));
assert.match(plainReleaseNotes(notes), /• Bold and code, help\./);
assert.ok(!plainReleaseNotes(notes).includes('**'));
assert.throws(() => extractReleaseNotes(changelog, '9.9.9'), /Missing/);
assert.throws(
  () => extractReleaseNotes('## v1.2.3\n\n### Added\n', '1.2.3'),
  /Empty/,
);
assert.throws(
  () => extractReleaseNotes('## v1.2.3\n- A\n## v1.2.3\n- B', '1.2.3'),
  /Duplicate/,
);
assert.throws(() => plainReleaseNotes('<script>test</script>'), /Unsupported/);

for (const camel of [false, true]) {
  const listingsKey = camel ? 'listings' : 'Listings';
  const baseKey = camel ? 'baseListing' : 'BaseListing';
  const notesKey = camel ? 'releaseNotes' : 'ReleaseNotes';
  const submission = {
    Id: 'draft-1',
    Pricing: {
      PriceId: 'Free',
      MarketSpecificPricings: { GB: { PriceId: 'Free' } },
    },
    ApplicationPackages: [{ fileName: 'x64.appx' }, { fileName: 'arm64.appx' }],
    PackageDeliveryOptions: {
      PackageRollout: { PackageRolloutPercentage: 25 },
    },
    [listingsKey]: Object.fromEntries(
      ['en-us', 'en-GB', 'de-de'].map((language) => [
        language,
        {
          [baseKey]: {
            [notesKey]: language + ' old notes',
            Description: 'Keep description',
            Images: [{ id: 'image' }],
          },
          PlatformOverrides: { Desktop: { Title: 'Keep platform listing' } },
        },
      ]),
    ),
  };
  const original = structuredClone(submission);
  const result = withStoreReleaseNotes(submission, 'New notes');
  assert.deepEqual(result.languages, ['en-us', 'en-GB']);
  assert.equal(
    result.submission[listingsKey]['en-us'][baseKey][notesKey],
    'New notes',
  );
  assert.equal(
    result.submission[listingsKey]['en-GB'][baseKey][notesKey],
    'New notes',
  );
  // Restore only the two changed fields; the entire remaining payload must match.
  for (const language of result.languages)
    result.submission[listingsKey][language][baseKey][notesKey] =
      original[listingsKey][language][baseKey][notesKey];
  assert.deepEqual(result.submission, original);
  assert.deepEqual(submission, original, 'Do not mutate the downloaded draft');
}
assert.throws(() => withStoreReleaseNotes({}, 'Notes'), /no listings/);
assert.throws(() => withStoreReleaseNotes({}, 'x'.repeat(1501)), /1500-character/);
assert.throws(
  () => withStoreReleaseNotes({ Listings: { 'de-de': {} } }, 'Notes'),
  /No English/,
);
assert.throws(
  () => withStoreReleaseNotes({ Listings: { 'en-us': {} } }, 'Notes'),
  /no base listing/,
);
assert.throws(() => withStoreReleaseNotes({ Listings: {} }, ''), /empty/);

// Check the real CLI and workflow without contacting a store.
const output = '.tmp/store-notes-test/whats-new.txt';
execFileSync(process.execPath, [
  'scripts/msstore-notes.mjs',
  'generate',
  output,
]);
assert.ok(existsSync(output));
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const generated = readFileSync(output, 'utf8');
assert.ok(generated.startsWith(`TinyCAD ${version}\n\n`));
assert.ok(generated.trim().length <= 1500, 'Store notes fit the listing limit');
assert.ok(!generated.includes('## '));
const workflow = load(
  readFileSync('.github/workflows/publish-store.yml', 'utf8'),
);
const steps = workflow.jobs['publish-ms-store'].steps;
assert.ok(
  steps.some((step) => step.run?.includes('msstore-notes.mjs generate')),
);
const publishing = steps.find(
  (step) => step.name === 'Publish to Microsoft Store',
).run;
assert.ok(publishing.includes('--noCommit'));
assert.ok(
  publishing.indexOf('submission get') <
    publishing.indexOf('msstore-notes.mjs patch'),
);
assert.ok(
  publishing.indexOf('submission update') <
    publishing.indexOf('submission publish'),
);

if (process.platform === 'win32') {
  const directory = '.tmp/store-notes-test/draft';
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}/whats-new.txt`, generated);
  const fixture = path.resolve(directory, 'fixture.json');
  const log = path.resolve(directory, 'commands.log');
  const psFile = path.resolve(directory, 'workflow.ps1');
  writeFileSync(
    psFile,
    `
$ErrorActionPreference = 'Stop'
function Get-ChildItem {
  @('x64', 'arm64') | ForEach-Object { [pscustomobject]@{ Name = 'TinyCAD Windows Setup ${version}-' + $_ + '.appx' } }
}
function msstore {
  $command = $args -join '|'
  [IO.File]::AppendAllText($env:STORE_TEST_LOG, $command + [Environment]::NewLine)
  $global:LASTEXITCODE = 0
  if ($args[0] -eq 'submission' -and $args[1] -eq 'get') {
    Get-Content $env:STORE_TEST_FIXTURE -Raw
  }
  if ($args[0] -eq 'submission' -and $args[1] -eq 'update') {
    if (-not (Test-Path -LiteralPath $args[3])) { throw 'Submission payload file does not exist' }
    if ($env:STORE_TEST_FAIL_UPDATE -eq 'true') { $global:LASTEXITCODE = 23 }
  }
}
${publishing.replaceAll('.tmp/msstore/', directory + '/')}
`,
  );
  for (const scenario of ['success', 'update-failure', 'missing-listing']) {
    const fixtureData = {
      Id: 'draft',
      Pricing: { PriceId: 'Free' },
      ApplicationPackages: [{ id: 'x64' }, { id: 'arm64' }],
      Listings:
        scenario === 'missing-listing'
          ? {}
          : {
              'en-us': {
                BaseListing: { ReleaseNotes: 'old', Title: 'TinyCAD' },
              },
            },
    };
    writeFileSync(fixture, JSON.stringify(fixtureData));
    writeFileSync(log, '');
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile],
      {
        env: {
          ...process.env,
          MICROSOFT_STORE_APP_ID: 'TEST',
          STORE_TEST_LOG: log,
          STORE_TEST_FIXTURE: fixture,
          STORE_TEST_FAIL_UPDATE: String(scenario === 'update-failure'),
        },
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    if (result.error) throw result.error;
    const commands = readFileSync(log, 'utf8');
    assert.equal(result.status === 0, scenario === 'success', result.stderr);
    assert.equal(
      commands.includes('submission|publish|'),
      scenario === 'success',
      'Never commit after a failed metadata update',
    );
    if (scenario === 'success') {
      assert.match(commands, /--noCommit/);
      assert.match(commands, /submission\|poll\|TEST/);
      const updated = JSON.parse(
        readFileSync(`${directory}/submission.updated.json`, 'utf8'),
      );
      assert.equal(
        updated.Listings['en-us'].BaseListing.ReleaseNotes,
        generated.trim(),
      );
      updated.Listings['en-us'].BaseListing.ReleaseNotes = 'old';
      assert.deepEqual(updated, fixtureData);
    }
  }
  console.log(
    'PowerShell Store workflow passed success and failure tests with a mocked CLI; no Store calls were made.',
  );
}
console.log(
  'Store release-note extraction, formatting, metadata preservation and workflow checks passed.',
);
