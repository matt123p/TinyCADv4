import fs from 'node:fs/promises';
import path from 'node:path';
import {
  exampleResourcePaths,
  parseExampleCatalog,
} from './bundledExamples.js';

export function repositoryExampleSources(root) {
  return [
    {
      directory: path.join(root, 'bundled-examples'),
      config: 'config.json',
      prefix: '',
    },
    {
      directory: path.join(root, 'tutorials'),
      config: 'catalog.json',
      prefix: 'tutorials/',
    },
  ];
}

export async function loadExampleSources(sources) {
  const catalog = { version: 1, groups: [], assets: [] };
  const resources = new Map();
  for (const { directory, config = 'config.json', prefix = '' } of sources) {
    const section = parseExampleCatalog(
      JSON.parse(await fs.readFile(path.join(directory, config), 'utf8')),
    );
    const content = (item) => ({
      ...item,
      preview: prefix + item.preview,
      ...(item.descriptionPath && {
        descriptionPath: prefix + item.descriptionPath,
      }),
    });
    catalog.groups.push(
      ...section.groups.map((group) => ({
        ...content(group),
        examples: group.examples.map((example) => ({
          ...content(example),
          path: prefix + example.path,
        })),
      })),
    );
    catalog.assets.push(...section.assets.map((asset) => prefix + asset));
    for (const resource of exampleResourcePaths(section)) {
      const name = prefix + resource;
      if (resources.has(name))
        throw new Error(`Duplicate example resource: ${name}`);
      resources.set(name, { directory, resource });
    }
  }
  return { catalog: parseExampleCatalog(catalog), resources };
}

export async function resolveExampleFile({ directory, resource }) {
  const root = await fs.realpath(directory);
  const file = await fs.realpath(path.join(root, resource));
  const relative = path.relative(root, file);
  if (
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative) ||
    !(await fs.stat(file)).isFile()
  )
    throw new Error(
      `Invalid example resource location outside its source directory or not a file: ${resource}`,
    );
  return file;
}
