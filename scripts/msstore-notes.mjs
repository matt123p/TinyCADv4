import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  extractReleaseNotes,
  plainReleaseNotes,
  withStoreReleaseNotes,
} from './lib/release-notes.mjs';

const [command, input, notesFile, output] = process.argv.slice(2);
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
if (command === 'generate' && input && !notesFile) {
  const changelog = readFileSync(
    new URL('../CHANGELOG.md', import.meta.url),
    'utf8',
  );
  const text = plainReleaseNotes(extractReleaseNotes(changelog, version));
  if (!text) throw new Error(`No Store release notes for v${version}.`);
  const notes = `TinyCAD ${version}\n\n${text}\n`;
  if (notes.trim().length > 1500)
    throw new Error('Store release notes exceed the 1500-character limit. Shorten the changelog entry.');
  mkdirSync(path.dirname(input), { recursive: true });
  writeFileSync(input, notes, 'utf8');
  console.log(`Generated What's new for ${version}: ${input}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Microsoft Store What's new\n\n${notes}\n`,
    );
  }
} else if (command === 'patch' && input && notesFile && output) {
  const notes = readFileSync(notesFile, 'utf8');
  if (!notes.startsWith(`TinyCAD ${version}\n\n`)) {
    throw new Error(
      `Store notes do not match package.json version ${version}. Regenerate them.`,
    );
  }
  const result = withStoreReleaseNotes(
    JSON.parse(readFileSync(input, 'utf8').replace(/^\uFEFF/, '')),
    notes,
  );
  writeFileSync(
    output,
    JSON.stringify(result.submission, null, 2) + '\n',
    'utf8',
  );
  console.log(`Updated What's new for: ${result.languages.join(', ')}`);
} else {
  throw new Error(
    'Usage: node scripts/msstore-notes.mjs generate <notes.txt> | patch <submission.json> <notes.txt> <updated.json>',
  );
}
