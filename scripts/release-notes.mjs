import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const sections = changelog.split(/^## /m);
const section = sections.find(entry => entry.startsWith(`v${version} — `));
if (!section) {
  throw new Error(`Missing changelog entry for v${version}`);
}
const notes = section.slice(section.indexOf('\n') + 1).trim();
if (!notes) {
  throw new Error(`Empty changelog entry for v${version}`);
}
console.log(notes);
