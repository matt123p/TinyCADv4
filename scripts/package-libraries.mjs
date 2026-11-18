import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBundledLibraryCatalog } from '../shared/bundledLibraries.js';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Copy only configured files; never parse SQLite or embed libraries in JavaScript. */
export async function packageLibraries(
  source = path.join(root, 'bundled-libraries'),
  destination = path.join(root, 'dist/bundled-libraries'),
) {
  const catalog = parseBundledLibraryCatalog(
    JSON.parse(await fs.readFile(path.join(source, 'config.json'), 'utf8')),
  );
  const sourceRoot = await fs.realpath(source);
  // Validate every source before replacing the previous build output.
  const files = await Promise.all(
    catalog.libraries.map(async (entry) => {
      const file = await fs.realpath(path.join(sourceRoot, entry.path));
      const relative = path.relative(sourceRoot, file);
      if (
        relative.startsWith('..' + path.sep) ||
        relative === '..' ||
        path.isAbsolute(relative) ||
        !(await fs.stat(file)).isFile()
      ) {
        throw new Error(
          `Bundled library is outside the source directory or is not a file: ${entry.path}`,
        );
      }
      return { entry, file };
    }),
  );
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  for (const { entry, file } of files) {
    const target = path.join(destination, entry.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(file, target);
  }
  await fs.writeFile(
    path.join(destination, 'config.json'),
    JSON.stringify(catalog, null, 2) + '\n',
  );
  console.log(`Packaged ${files.length} bundled libraries in ${destination}`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await packageLibraries(
    process.argv[2] && path.resolve(process.argv[2]),
    process.argv[3] && path.resolve(process.argv[3]),
  );
}
