/** @typedef {{ id: string, title: string, preview: string, description?: string, descriptionPath?: string }} ExampleContent */
/** @typedef {ExampleContent & { path: string }} BundledExample */
/** @typedef {ExampleContent & { examples: BundledExample[] }} ExampleGroup */
/** @typedef {{ version: 1, groups: ExampleGroup[], assets: string[] }} ExampleCatalog */

export function examplePath(value, extensions) {
  if (
    typeof value !== 'string' ||
    !value ||
    /[\\:%?#\u0000-\u001f]/.test(value) ||
    value.split('/').some((part) => !part || part === '.' || part === '..') ||
    !extensions.includes(value.split('.').pop().toLowerCase())
  ) {
    throw new Error(`Invalid bundled example path: ${value}`);
  }
  return value;
}

export const exampleImageExtensions = [
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'avif',
  'svg',
];

export const exampleVideoExtensions = ['mp4', 'webm'];
export const exampleMediaExtensions = [
  ...exampleImageExtensions,
  ...exampleVideoExtensions,
];

/** @param {unknown} input @returns {ExampleCatalog} */
export function parseExampleCatalog(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    input.version !== 1 ||
    !Array.isArray(input.groups)
  ) {
    throw new Error(
      'Example config must contain version: 1 and a groups array.',
    );
  }
  const content = (value, ids) => {
    if (
      !value ||
      typeof value !== 'object' ||
      typeof value.id !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value.id) ||
      ids.has(value.id) ||
      typeof value.title !== 'string' ||
      !value.title.trim()
    ) {
      throw new Error('Each example and group needs a unique id and a title.');
    }
    ids.add(value.id);
    const inline =
      typeof value.description === 'string' && !!value.description.trim();
    const file = value.descriptionPath !== undefined;
    if (inline === file || (value.description !== undefined && !inline)) {
      throw new Error(
        `Provide either Markdown description or descriptionPath for: ${value.id}`,
      );
    }
    return {
      id: value.id,
      title: value.title.trim(),
      preview: examplePath(value.preview, exampleImageExtensions),
      ...(inline
        ? { description: value.description }
        : {
            descriptionPath: examplePath(value.descriptionPath, [
              'md',
              'markdown',
            ]),
          }),
    };
  };
  const groupIds = new Set();
  const groups = input.groups.map((value) => {
    const group = content(value, groupIds);
    if (!Array.isArray(value.examples))
      throw new Error(`Expected an examples array for: ${group.id}`);
    const ids = new Set();
    return {
      ...group,
      examples: value.examples.map((example) => ({
        ...content(example, ids),
        path: examplePath(example.path, ['dsn', 'dzn']),
      })),
    };
  });
  if (input.assets !== undefined && !Array.isArray(input.assets))
    throw new Error('Example assets must be an array of image or video paths.');
  const assets = [
    ...new Set(
      (input.assets || []).map((asset) =>
        examplePath(asset, exampleMediaExtensions),
      ),
    ),
  ];
  return { version: 1, groups, assets };
}

/** @param {ExampleCatalog} catalog */
export function exampleResourcePaths(catalog) {
  const paths = new Set(catalog.assets);
  for (const group of catalog.groups) {
    for (const item of [group, ...group.examples]) {
      paths.add(item.preview);
      if (item.descriptionPath) paths.add(item.descriptionPath);
    }
    group.examples.forEach((example) => paths.add(example.path));
  }
  return paths;
}

/** Resolve a relative Markdown image/link within the bundled directory. */
export function resolveExampleResource(value, descriptionPath, allowed) {
  if (typeof value !== 'string') return null;
  try {
    value = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (
    typeof value !== 'string' ||
    !value ||
    /[\\:%?#\u0000-\u001f]/.test(value) ||
    value.startsWith('/')
  )
    return null;
  const parts = descriptionPath ? descriptionPath.split('/').slice(0, -1) : [];
  for (const part of value.split('/')) {
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== '.') parts.push(part);
  }
  const path = parts.join('/');
  return allowed.has(path) ? path : null;
}
