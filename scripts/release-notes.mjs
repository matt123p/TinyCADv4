import { readFileSync } from 'node:fs';
import { extractReleaseNotes } from './lib/changelog.mjs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
console.log(extractReleaseNotes(changelog, version));
