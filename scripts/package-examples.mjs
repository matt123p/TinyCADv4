import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseExampleCatalog,
  exampleResourcePaths,
} from '../shared/bundledExamples.js';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function packageExamples(
  source = path.join(root, 'bundled-examples'),
  destination = path.join(root, 'dist/bundled-examples'),
) {
  const catalog = parseExampleCatalog(
    JSON.parse(await fs.readFile(path.join(source, 'config.json'), 'utf8')),
  );
  const sourceRoot = await fs.realpath(source);
  const files = await Promise.all(
    [...exampleResourcePaths(catalog)].map(async (resource) => {
      const file = await fs.realpath(path.join(sourceRoot, resource));
      const relative = path.relative(sourceRoot, file);
      if (
        relative === '..' ||
        relative.startsWith('..' + path.sep) ||
        path.isAbsolute(relative) ||
        !(await fs.stat(file)).isFile()
      ) {
        throw new Error(
          `Example resource is outside its source directory or is not a file: ${resource}`,
        );
      }
      return { resource, file };
    }),
  );
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  for (const { resource, file } of files) {
    const target = path.join(destination, resource);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(file, target);
  }
  await fs.writeFile(
    path.join(destination, 'config.json'),
    JSON.stringify(catalog, null, 2) + '\n',
  );
  console.log(
    `Packaged ${catalog.groups.length} example groups and ${files.length} resources in ${destination}`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await packageExamples();
