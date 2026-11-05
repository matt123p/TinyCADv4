import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Parcel's HTML and JS must agree on import-map support. A missing map can
// otherwise produce a successful build that fails only when Electron starts.
const directory = path.resolve(process.argv[2] ?? 'dist');
const entry = pathToFileURL(path.join(directory, 'index-electron.html'));
const html = await fs.readFile(entry, 'utf8');
const mapMatch = html.match(/<script\b[^>]*\btype\s*=\s*["']?importmap["']?[^>]*>([\s\S]*?)<\/script>/i);
assert.ok(mapMatch, 'Electron renderer is missing its Parcel import map');
assert.ok(mapMatch.index < html.search(/<script\b[^>]*\bsrc\s*=/i),
  'Import map must precede the renderer entry script');
const { imports } = JSON.parse(mapMatch[1]);
assert.ok(imports && Object.keys(imports).length > 0, 'Renderer import map is empty');

const checkFile = async (specifier, base, moduleSpecifier = true) => {
  assert.ok(moduleSpecifier
    ? specifier.startsWith('./') || specifier.startsWith('../')
    : !/^(?:[a-z][a-z\d+.-]*:|[\/\\])/i.test(specifier),
    `Renderer resource must use a relative URL: ${specifier}`);
  const url = new URL(specifier, base);
  assert.ok((await fs.stat(url)).isFile(), `Missing renderer resource: ${url}`);
  return url;
};

for (const specifier of Object.values(imports)) {
  await checkFile(specifier, entry);
}

const pending = Object.values(imports)
  .filter((specifier) => specifier.endsWith('.js'))
  .map((specifier) => new URL(specifier, entry));
const scriptPattern = /<script\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
for (const match of html.matchAll(scriptPattern)) {
  pending.push(await checkFile(match[1] ?? match[2] ?? match[3], entry, false));
}

const visited = new Set();
let references = 0;
while (pending.length > 0) {
  const url = pending.pop();
  if (visited.has(url.href)) continue;
  visited.add(url.href);
  const javascript = await fs.readFile(url, 'utf8');
  // Check literal calls emitted by Parcel, including lazy translation chunks
  // and asset URL modules. Runtime-computed library calls are left alone.
  const calls = /\b(?:import\s*\(|import\.meta\.resolve\s*\()\s*(["'])([^"']+)\1/g;
  for (const match of javascript.matchAll(calls)) {
    const specifier = match[2];
    const mapped = Object.hasOwn(imports, specifier);
    assert.ok(mapped || specifier.startsWith('./') || specifier.startsWith('../'),
      `Unresolved renderer specifier ${specifier} in ${fileURLToPath(url)}`);
    const resource = await checkFile(mapped ? imports[specifier] : specifier, mapped ? entry : url);
    if (resource.pathname.endsWith('.js')) pending.push(resource);
    references += 1;
  }
}
console.log(`Electron build checked: ${visited.size} modules, ${references} resource/chunk references.`);
