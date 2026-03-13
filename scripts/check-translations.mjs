import fs from 'fs';
import path from 'path';
import { execSync } from 'node:child_process';

const rootDir = process.cwd();
const srcDir = path.join(rootDir, 'src');
const localesDir = path.join(srcDir, 'i18n', 'locales');
const defaultLocale = 'en';

function getDiffForEnSinceLastDeChange() {
  const deRelative = 'src/i18n/locales/de/common.ts';
  const enRelative = 'src/i18n/locales/en/common.ts';

  let commit = '';
  try {
    commit = execSync(`git log -1 --format=%H -- ${deRelative}`, { encoding: 'utf8' }).trim();
  } catch {
    return {
      hasCommit: false,
      diff: '',
    };
  }

  if (!commit) {
    return {
      hasCommit: false,
      diff: '',
    };
  }

  const diff = execSync(`git diff ${commit}..HEAD -- ${enRelative}`, { encoding: 'utf8' });
  return {
    hasCommit: true,
    diff,
  };
}

function walkFiles(dirPath, predicate, output = []) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, predicate, output);
      continue;
    }

    if (predicate(fullPath)) {
      output.push(fullPath);
    }
  }

  return output;
}

function extractCommonObjectSource(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const withoutPrefix = source.replace(/^\s*const\s+common\s*=\s*/, '');
  const withoutExport = withoutPrefix.replace(/\n\s*export\s+default\s+common\s*;?\s*$/m, '').trim();
  return withoutExport.endsWith(';') ? withoutExport.slice(0, -1) : withoutExport;
}

function loadLocaleObject(filePath) {
  const objectSource = extractCommonObjectSource(filePath);
  return Function(`"use strict"; return (${objectSource});`)();
}

function flattenKeys(node, prefix = '', output = []) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return output;
  }

  for (const [key, value] of Object.entries(node)) {
    const nextPath = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenKeys(value, nextPath, output);
    } else {
      output.push(nextPath);
    }
  }

  return output;
}

function collectUsedTranslationKeys() {
  const sourceFiles = walkFiles(
    srcDir,
    (filePath) => /\.(ts|tsx|js|jsx)$/.test(filePath),
  );

  const keySet = new Set();
  const keyRegex = /(?:\b(?:i18n\.)?t|\bthis\.props\.t)\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g;

  for (const filePath of sourceFiles) {
    const source = fs.readFileSync(filePath, 'utf8');
    let match;
    while ((match = keyRegex.exec(source)) !== null) {
      const key = match[2];
      if (!key || key.includes('${')) {
        continue;
      }
      keySet.add(key);
    }
  }

  return keySet;
}

function getLocaleFiles() {
  const localeDirs = fs
    .readdirSync(localesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  return localeDirs
    .map((locale) => ({
      locale,
      filePath: path.join(localesDir, locale, 'common.ts'),
    }))
    .filter(({ filePath }) => fs.existsSync(filePath));
}

function printList(title, values) {
  console.log(`\n${title} (${values.length})`);
  for (const value of values) {
    console.log(`  - ${value}`);
  }
}

function main() {
  const localeFiles = getLocaleFiles();
  const defaultLocaleFile = localeFiles.find((entry) => entry.locale === defaultLocale);

  if (!defaultLocaleFile) {
    console.error(`Default locale "${defaultLocale}" not found.`);
    process.exit(1);
  }

  const defaultLocaleObject = loadLocaleObject(defaultLocaleFile.filePath);
  const defaultKeySet = new Set(flattenKeys(defaultLocaleObject));
  const usedKeySet = collectUsedTranslationKeys();

  const missingInDefault = [...usedKeySet].filter((key) => !defaultKeySet.has(key)).sort();

  console.log(`Default locale: ${defaultLocale}`);
  console.log(`Locales found: ${localeFiles.map((entry) => entry.locale).join(', ')}`);
  console.log(`Used translation keys: ${usedKeySet.size}`);
  console.log(`Default locale keys: ${defaultKeySet.size}`);

  if (missingInDefault.length > 0) {
    printList(`Missing keys in ${defaultLocale}`, missingInDefault);
  } else {
    console.log(`\nAll used translation keys exist in ${defaultLocale}.`);
  }

  let hasLocaleMismatch = false;

  for (const { locale, filePath } of localeFiles) {
    if (locale === defaultLocale) {
      continue;
    }

    const localeObject = loadLocaleObject(filePath);
    const localeKeySet = new Set(flattenKeys(localeObject));

    const missingKeys = [...defaultKeySet].filter((key) => !localeKeySet.has(key)).sort();
    const extraKeys = [...localeKeySet].filter((key) => !defaultKeySet.has(key)).sort();

    if (missingKeys.length === 0 && extraKeys.length === 0) {
      continue;
    }

    hasLocaleMismatch = true;
    console.log(`\nLocale ${locale}:`);
    if (missingKeys.length > 0) {
      printList('Missing', missingKeys);
    }
    if (extraKeys.length > 0) {
      printList('Extra', extraKeys);
    }
  }

  const enSinceDeDiff = getDiffForEnSinceLastDeChange();

  if (!enSinceDeDiff.hasCommit) {
    console.log('\nNo commit found for src/i18n/locales/de/common.ts. Skipping existing-key diff check.');
  } else if (!enSinceDeDiff.diff.trim()) {
    console.log('\nNo changes found in src/i18n/locales/en/common.ts since the last de locale update.');
  } else {
    console.log('\nChanges found in existing keys (en since last de update):\n');
    process.stdout.write(enSinceDeDiff.diff);
  }

  const hasErrors = missingInDefault.length > 0 || hasLocaleMismatch || (enSinceDeDiff.hasCommit && !!enSinceDeDiff.diff.trim());
  if (!hasErrors) {
    console.log('\nTranslation check passed.');
    process.exit(0);
  }

  console.error('\nTranslation check failed.');
  process.exit(1);
}

main();