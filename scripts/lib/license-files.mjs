import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import upstream from '../../licenses/upstream.json' with { type: 'json' };
import engineLock from '../../build-support/ngspice/engine.lock.json' with { type: 'json' };

// These grants do not require a redistribution notice. Select CC0 for type-fest.
const noNotice = new Set(['0BSD', 'CC0-1.0', 'Unlicense', '(MIT OR CC0-1.0)']);
const noticeFile = /^(?:licen[cs]es?|copying|notice|copyright(?:notice)?)(?:[._-]|$)/i;
const reactPackages = new Set(['react', 'react-dom', 'react-is', 'react-lifecycles-compat', 'scheduler']);

// Resolve a bundled file to its npm package, including nested and scoped packages.
function packageDirectory(root, file) {
  const parts = path.relative(root, file).split(path.sep);
  const index = parts.lastIndexOf('node_modules') + 1;
  if (!index || !parts[index]) return;
  return parts.slice(0, index + (parts[index].startsWith('@') ? 2 : 1)).join('/');
}

async function packageNotice(root, directory) {
  const location = path.join(root, directory);
  const { name, version, license: declaredLicense } = JSON.parse(
    await fs.readFile(path.join(location, 'package.json'), 'utf8'),
  );
  if (noNotice.has(declaredLicense)) return;

  const packageFamily = name.replace(/^(@napi-rs\/canvas-|@rollup\/rollup-).+$/, '$1*');
  const override = upstream[`${name}@${version}`] ?? upstream[`${packageFamily}@${version}`] ?? upstream[name];
  const license = override?.license ?? declaredLicense;
  const files = (await fs.readdir(location, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && noticeFile.test(entry.name))
    .map((entry) => entry.name)
    .filter((file) => name !== 'dompurify' || file !== 'LICENSE-MPL');
  const contents = await Promise.all([
    ...files.sort().map((file) => fs.readFile(path.join(location, file), 'utf8')),
    ...(override?.files ?? []).map((file) => fs.readFile(path.join(root, 'licenses', file), 'utf8')),
    ...(override?.packageFiles ?? []).map((file) => fs.readFile(path.join(location, file), 'utf8')),
  ]);
  if (!license || !contents.some((text) => text.trim())) {
    throw new Error(`Missing redistribution license or notice for ${name}@${version} (${directory})`);
  }
  return { name, version, license, contents: contents.map((text) => text.replace(/\r\n/g, '\n').trim()).filter(Boolean) };
}

function combineMitNotices(texts) {
  const credits = new Set();
  const notes = new Set();
  const compare = (text) => text.replace(/[“”"*_]/g, '').replace(/\s+/g, ' ');
  let terms;
  for (const text of texts) {
    const grant = /Permission is hereby granted[\s\S]*?OTHER DEALINGS IN THE\s+SOFTWARE\./.exec(text);
    // Retain the original notices if a package uses different license terms.
    if (!grant || (terms && compare(grant[0]) !== compare(terms))) return [...texts].join('\n\n');
    terms ??= grant[0];
    for (const line of text.slice(0, grant.index).split('\n')) {
      const credit = line.trim();
      if (credit && !/^(?:MIT License$|@fluentui\/|Fluent UI React - )/.test(credit)) credits.add(credit);
    }
    const note = text.slice(grant.index + grant[0].length).trim();
    if (note) notes.add(note);
  }
  return ['MIT License', [...credits].join('\n'), terms, ...notes].filter(Boolean).join('\n\n');
}

function groupPackageNotices(packages) {
  const groups = new Map();
  for (const { name, version, license, contents } of packages) {
    const fluent = name.startsWith('@fluentui/');
    const family = fluent ? 'Fluent UI' : reactPackages.has(name) ? 'React' : undefined;
    const key = family ?? `${name}@${version}`;
    if (!groups.has(key)) {
      groups.set(key, { name: family ?? name, version: family ? undefined : version, licenses: new Set(), components: new Set(), texts: new Set() });
    }
    const notice = groups.get(key);
    notice.licenses.add(license);
    notice.components.add(`${name} ${version}`);
    for (const text of contents) {
      // Fluent packages prepend their npm package name to a shared MIT notice.
      const header = `${name}\n`;
      notice.texts.add(fluent && text.startsWith(header) ? text.slice(header.length).trimStart() : text);
    }
  }

  return [...groups.values()].map(({ name, version, licenses, components, texts }) => {
    const license = [...licenses].join(' / ');
    const text = !version && license === 'MIT' ? combineMitNotices(texts) : [...texts].join('\n\n');
    if (name === 'sql.js') {
      return {
        name: 'SQLite (via sql.js)', version, license,
        text: `SQLite is in the public domain (https://sqlite.org/copyright.html). The sql.js wrapper is distributed under the MIT license below.\n\n${text}`,
      };
    }
    return { name, version, license, text: version ? text : `${text}\n\nIncluded packages\n${[...components].sort().join('\n')}` };
  });
}

export async function writeLicenseFiles(root, destination, assets, target) {
  const directories = new Set([...assets].map((file) => packageDirectory(root, file)).filter(Boolean));
  // Electron Builder also ships production Node packages. It filters out .d.ts files.
  if (target === 'electron') {
    const { packages } = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
    for (const [directory, entry] of Object.entries(packages)) {
      if (directory && !entry.dev && !directory.includes('node_modules/@types/') && existsSync(path.join(root, directory, 'package.json'))) {
        directories.add(directory);
      }
    }
  }

  const packages = [];
  const failures = [];
  for (const directory of [...directories].sort()) {
    try {
      const notice = await packageNotice(root, directory);
      if (notice) packages.push(notice);
    } catch (error) {
      failures.push(error.message);
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
  const notices = groupPackageNotices(packages);

  const addNotice = async (name, version, license, ...files) => {
    const texts = await Promise.all(files.map((file) => fs.readFile(path.join(root, 'licenses', file), 'utf8')));
    notices.push({ name, version, license, text: texts.map((text) => text.trim()).join('\n\n') });
  };
  if ([...assets].some((file) => /^Liberation(?:Mono|Sans|Serif)-/.test(path.basename(file)))) {
    await addNotice('Liberation Fonts', '2.1.5', 'OFL-1.1', 'liberation-fonts.txt');
  }
  if (notices.some(({ name }) => name === 'pdfkit')) {
    await addNotice('Adobe PDF Core 14 font metrics (PDFKit)', undefined, 'Adobe AFM redistribution terms', 'adobe-afm.txt');
  }
  const desktop = target === 'electron';
  const engineVersion = engineLock.version;
  await addNotice('ngspice', engineVersion, 'BSD-3-Clause and bundled notices',
    `ngspice-${engineVersion}-copying.txt`, 'ngspice-sparse.txt', 'ngspice-lgpl-attribution.txt');
  if (desktop) {
    await addNotice('XSPICE table code models', undefined, 'GPL-2.0-or-later', 'xspice-table.txt', 'gpl-2.0.txt');
  }
  if (!desktop || packages.some(({ name }) => name === 'sql.js')) {
    await addNotice('Emscripten WebAssembly runtime', undefined, 'MIT OR NCSA', 'emscripten.txt');
    await addNotice('musl libc (WebAssembly runtime)', undefined, 'MIT and bundled notices', 'musl.txt');
  }

  await fs.mkdir(destination, { recursive: true });
  await fs.copyFile(path.join(root, 'license.md'), path.join(destination, 'tinycad.txt'));
  const index = [];
  const written = new Set();
  for (const { text, ...notice } of notices.sort((a, b) => a.name.localeCompare(b.name) || (a.version ?? '').localeCompare(b.version ?? ''))) {
    const file = `${createHash('sha256').update(text).digest('hex')}.txt`;
    if (!written.has(file)) {
      await fs.writeFile(path.join(destination, file), `${text}\n`);
      written.add(file);
    }
    index.push({ ...notice, file });
  }
  await fs.writeFile(path.join(destination, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
}
