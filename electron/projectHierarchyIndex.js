import fs from 'node:fs/promises';
import path from 'node:path';
import { DOMParser, getParserError } from 'common-xml-features';
import ignore from 'ignore';
import { Uint8ArrayReader, ZipReader } from '@zip.js/zip.js';
import {
  COMPRESSED_DRAWING_MIME,
  isDrawingFile,
} from '../shared/drawingFiles.js';

const section = 'hierarchy';
const maxFileBytes = 16 * 1024 * 1024;
const maxReadBytes = 96 * 1024 * 1024;
const maxEntries = 12000;
const maxDrawings = 1000;
const maxDepth = 32;
const maxLinks = 4000;
const maxTime = 5000;
const artworkTags = new Set(['HierarchicalSymbol', 'HierachicalSymbol']);
const linkTags = new Set(['HIERARCHICAL_SYMBOL', 'HIERACHICAL_SYMBOL']);

async function drawingXml(bytes) {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const reader = new ZipReader(new Uint8ArrayReader(bytes), {
      useWebWorkers: false,
      useCompressionStream: false,
      checkAmbiguity: true,
    });
    try {
      const entries = await reader.getEntries();
      const read = async (name, limit) => {
        const matches = entries.filter((entry) => entry.filename === name);
        const entry = matches[0];
        if (
          matches.length !== 1 ||
          entry.directory ||
          entry.encrypted ||
          entry.symlink ||
          entry.uncompressedSize > limit
        )
          throw new Error('Invalid drawing archive.');
        const buffer = new Uint8Array(entry.uncompressedSize);
        let offset = 0;
        await entry.getData(
          new WritableStream({
            write(chunk) {
              buffer.set(chunk, offset);
              offset += chunk.byteLength;
            },
          }),
          { checkSignature: true },
        );
        if (offset !== buffer.length)
          throw new Error('Incomplete drawing archive.');
        return buffer;
      };
      if (
        entries.length > 10000 ||
        new TextDecoder().decode(await read('mimetype', 128)) !==
          COMPRESSED_DRAWING_MIME
      )
        throw new Error('Invalid drawing archive.');
      bytes = await read('drawing.xml', maxFileBytes);
    } finally {
      await reader.close();
    }
  }
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
      ? 'utf-16be'
      : 'utf-8';
  const xml = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Invalid drawing XML.');
  return xml;
}

const elements = (node) =>
  Array.from(node.childNodes).filter((child) => child.nodeType === 1);

async function summarize(bytes) {
  if (!bytes.length) return { hasSymbol: false, links: [] };
  const doc = new DOMParser().parseFromString(
    await drawingXml(bytes),
    'text/xml',
  );
  const root = doc.documentElement;
  if (
    !root ||
    getParserError(doc) ||
    !['TinyCAD', 'TinyCADSheets'].includes(root.nodeName)
  )
    throw new Error('Invalid drawing XML.');
  const sheets =
    root.nodeName === 'TinyCAD'
      ? [root]
      : elements(root).filter(
          (node) =>
            node.nodeName === 'TinyCAD' ||
            node.nodeName === 'SimulationSheet' ||
            artworkTags.has(node.nodeName),
        );
  const links = [];
  for (const sheet of sheets) {
    if (sheet.nodeName !== 'TinyCAD') continue;
    for (const node of elements(sheet)) {
      if (!linkTags.has(node.nodeName)) continue;
      const reference = elements(node).find(
        (field) =>
          field.nodeName === 'FIELD' &&
          field.getAttribute('description') === 'Ref',
      );
      links.push({
        filename: node.getAttribute('file')?.slice(0, 1024) ?? '',
        reference: reference?.getAttribute('value')?.slice(0, 128) ?? '',
      });
      if (links.length > maxLinks) throw new Error('Too many schematic links.');
    }
  }
  return {
    hasSymbol: artworkTags.has(sheets[0]?.nodeName),
    hasSymbolSheet: sheets.some((sheet) => artworkTags.has(sheet.nodeName)),
    links,
  };
}

function cachedDrawings(cache) {
  if (cache?.version !== 2 || !Array.isArray(cache.drawings)) return new Map();
  return new Map(
    cache.drawings
      .slice(0, maxDrawings)
      .filter(
        (entry) =>
          typeof entry?.path === 'string' &&
          Number.isFinite(entry.modified) &&
          typeof entry.hasSymbol === 'boolean' &&
          Array.isArray(entry.links) &&
          entry.links.length <= maxLinks &&
          entry.links.every(
            (link) =>
              typeof link?.filename === 'string' &&
              typeof link.reference === 'string',
          ),
      )
      .map((entry) => [entry.path, entry]),
  );
}

export function createHierarchyIndex({
  readFile,
  readProjectSettings,
  updateProjectSettings,
}) {
  const running = new Map();

  async function scan(project) {
    const previous = await readProjectSettings(
      project,
      section,
      maxEntries,
    ).catch(() => undefined);
    const cached = cachedDrawings(previous);
    const drawings = [];
    let limited = false;
    let unreadable = 0;
    let entries = 0;
    let bytesRead = 0;
    let links = 0;
    const deadline = Date.now() + maxTime;

    async function walk(folder, prefix, ignoreRules, depth) {
      if (depth > maxDepth || Date.now() >= deadline) {
        limited = true;
        return;
      }
      if ((await fs.realpath(folder)) !== folder) return;
      const rules = [...ignoreRules];
      try {
        const filename = path.join(folder, '.gitignore');
        if ((await fs.lstat(filename)).isFile()) {
          const patterns = new TextDecoder().decode(
            await readFile(filename, 256 * 1024),
          );
          rules.push({
            prefix,
            matcher: ignore({ ignorecase: false }).add(patterns),
          });
        }
      } catch (error) {
        if (error.code !== 'ENOENT') unreadable++;
      }
      const directory = await fs.opendir(folder);
      for await (const entry of directory) {
        if (
          ++entries > maxEntries ||
          Date.now() >= deadline ||
          drawings.length >= maxDrawings
        ) {
          limited = true;
          break;
        }
        const relative = prefix + entry.name;
        const target = path.join(folder, entry.name);
        if (entry.name.toLowerCase() === '.git' || entry.isSymbolicLink())
          continue;
        const matchPath = entry.isDirectory() ? relative + '/' : relative;
        let ignored = false;
        for (const rule of rules) {
          const result = rule.matcher.test(matchPath.slice(rule.prefix.length));
          if (result.ignored || result.unignored) ignored = result.ignored;
        }
        if (ignored) continue;
        if (entry.isDirectory()) {
          await walk(target, relative + '/', rules, depth + 1).catch(() => {
            unreadable++;
          });
        } else if (entry.isFile() && isDrawingFile(entry.name)) {
          try {
            const stat = await fs.lstat(target);
            if (!stat.isFile()) continue;
            let record = cached.get(relative);
            if (record?.modified !== stat.mtimeMs) {
              if (
                stat.size > maxFileBytes ||
                bytesRead + stat.size > maxReadBytes
              ) {
                limited = true;
                continue;
              }
              if ((await fs.realpath(target)) !== target) continue;
              bytesRead += stat.size;
              const summary = await summarize(
                await readFile(target, maxFileBytes),
              ).catch(() => ({
                hasSymbol: false,
                links: [],
                unreadable: true,
              }));
              record = { path: relative, modified: stat.mtimeMs, ...summary };
            }
            if (links + record.links.length > maxLinks) {
              limited = true;
              continue;
            }
            links += record.links.length;
            if (record.unreadable) unreadable++;
            drawings.push(record);
          } catch {
            unreadable++;
          }
        }
      }
    }

    await walk(project, '', [], 0);
    drawings.sort((a, b) => a.path.localeCompare(b.path));
    let cacheUnavailable = false;
    const result = { version: 2, drawings };
    const serialized = JSON.stringify(result);
    if (
      (drawings.length || cached.size) &&
      JSON.stringify(previous) !== serialized
    ) {
      try {
        await updateProjectSettings(
          project,
          section,
          (current) => {
            if (JSON.stringify(current) !== serialized) return result;
          },
          maxEntries,
        );
      } catch {
        cacheUnavailable = true;
      }
    }
    return { drawings, limited, unreadable, cacheUnavailable };
  }

  return (project) => {
    if (!running.has(project)) {
      const result = scan(project).finally(() => running.delete(project));
      running.set(project, result);
    }
    return running.get(project);
  };
}
