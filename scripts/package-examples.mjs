import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadExampleSources,
  repositoryExampleSources,
  resolveExampleFile,
} from '../shared/exampleSources.js';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function packageExamples(
  source = path.join(root, 'bundled-examples'),
  destination = path.join(root, 'dist/bundled-examples'),
) {
  // Keep the manual and embedded examples on the same source drawings.
  const sources =
    path.resolve(source) === path.join(root, 'bundled-examples')
      ? repositoryExampleSources(root)
      : [{ directory: source }];
  const { catalog, resources } = await loadExampleSources(sources);
  const files = await Promise.all(
    [...resources].map(async ([resource, source]) => ({
      resource,
      file: await resolveExampleFile(source),
    })),
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
