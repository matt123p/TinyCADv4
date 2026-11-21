import { validProjectName } from '../../shared/projectFiles';
import { boardAssembly } from '../pcb/boardAssembly';
import { buildHierarchicalNetlist } from '../pcb/hierarchicalNetlist';
import type {
  ProjectBoardOutputRecipe,
  ProjectLink,
  ProjectOutputRecipe,
  ProjectSchematicOutputRecipe,
} from '../pcb/projectSettings';
import {
  boardOutputFilename,
  encodeProjectSettings,
  projectBoardOutputFormats,
} from '../pcb/projectSettings';
import { digest } from '../util/sha256';
import { bomCsv } from './bomCsv';
import { netlistBomRows } from './netlists/activeNetlist';
import { serializeNetlist } from './netlists/netlistFiles';
import { linkedBoardSource, readProjectSchematic, resolveChild } from './projectHierarchy';
import {
  projectFilesChanged,
  projectRequest,
  readProject,
  readProjectBoard,
} from './projects';

type Project = Awaited<ReturnType<typeof readProject>>;
type Location = { id: string; rootId: string };
const encoder = new TextEncoder();

export async function saveProjectOutputRecipes(
  location: Location,
  project: Project,
  outputRecipes: readonly ProjectOutputRecipe[],
) {
  const data = encodeProjectSettings({
    ...project.settings,
    ...(outputRecipes.length
      ? { outputRecipes }
      : { outputRecipes: undefined }),
  });
  await projectRequest({
    operation: 'write',
    id: location.id,
    folder: location.rootId,
    name: project.marker.name,
    version: project.version,
    data,
  });
  window.dispatchEvent(new Event(projectFilesChanged));
}

async function projectFolder(root: string, directory: string) {
  let folder = root;
  for (const name of directory.split('/')) {
    if (!validProjectName(name)) throw new Error('Invalid output folder.');
    const matches = (
      await projectRequest({ operation: 'list', folder, tree: true })
    ).filter((item) => item.name.toLowerCase() === name.toLowerCase());
    if (
      matches.length > 1 ||
      matches.some((item) => item.unsupported || !item.folder)
    )
      throw new Error('Output folder is blocked or ambiguous: ' + name);
    const next =
      matches[0] ??
      (await projectRequest({ operation: 'mkdir', folder, name }));
    folder = next.id;
  }
  return folder;
}

type Manifest = {
  version: 1;
  recipeId: string;
  recipeDigest: string;
  sources: Record<string, string>;
  output: { name: string; digest: string };
  pending?: boolean;
  previous?: string;
};

function readManifest(data: Uint8Array, recipe: ProjectOutputRecipe): Manifest {
  try {
    const manifest = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(data),
    );
    const checksum = /^[a-f0-9]{64}$/;
    if (
      manifest.version === 1 &&
      manifest.recipeId === recipe.id &&
      manifest.output?.name === recipe.filename &&
      checksum.test(manifest.output.digest) &&
      (manifest.previous === undefined ||
        (manifest.pending === true && checksum.test(manifest.previous)))
    ) {
      return manifest;
    }
  } catch {
    // An unrecognised manifest does not give permission to replace a file.
  }
  throw new Error(
    'The existing output manifest belongs to another file or recipe.',
  );
}

type SourceFiles = Map<
  string,
  { id: string; version: string; data: Uint8Array }
>;

async function schematicOutput(
  location: Location,
  project: Project,
  recipe: ProjectSchematicOutputRecipe,
  captured: SourceFiles,
) {
  const linked = recipe.board ? linkedBoardSource(project, recipe.board).source : project.settings.entries.find(
    ({ kind, id }) => kind === 'schematic' && id === recipe.schematic,
  );
  if (!linked) throw new Error('This recipe needs a linked schematic.');
  const drawings = new Map<string, ReturnType<typeof readProjectSchematic>>();
  const read = (_project: Project, link: ProjectLink) => {
    let drawing = drawings.get(link.id);
    if (!drawing) {
      drawing = readProjectSchematic(project, link, (id, version, data) =>
        captured.set(link.path, { id, version, data }),
      );
      drawings.set(link.id, drawing);
    }
    return drawing;
  };
  const netlist = await buildHierarchicalNetlist(
    { path: linked.path, drawing: await read(project, linked) },
    async (parent, link) => {
      const child = await resolveChild(
        project,
        {
          rootId: location.rootId,
          documentPath: parent.path,
        },
        link,
        read,
      );
      if (!child.entry)
        throw new Error(
          'Register the child schematic in this project first: ' + child.path,
        );
      return child;
    },
  );
  return encoder.encode(
    recipe.kind === 'bom'
      ? bomCsv(netlistBomRows(netlist))
      : serializeNetlist(recipe.filename, recipe.format, netlist).text,
  );
}

async function pcbOutput(
  project: Project,
  recipe: ProjectBoardOutputRecipe,
  captured: SourceFiles,
) {
  const linked = project.settings.entries.find(
    ({ kind, id }) => kind === 'board' && id === recipe.board,
  );
  if (!linked) throw new Error('This recipe needs a linked PCB.');
  const { board, data, version } = await readProjectBoard(project, linked.id);
  captured.set(linked.path, {
    id: project.files.get(linked.path).id,
    data,
    version,
  });
  const name = boardOutputFilename(recipe.format, recipe.layer);
  const spec = projectBoardOutputFormats[recipe.format];
  let files: Readonly<Record<string, string>>;
  if (spec.extension === 'csv') {
    files = boardAssembly(board, recipe.decimals, recipe.csvText);
  } else {
    const { createBoardWorker } = await import('../pcb/boardWorker');
    const worker = createBoardWorker();
    try {
      ({ files } = await worker.cam(board));
    } finally {
      worker.dispose();
    }
  }
  const output = files[name];
  if (output === undefined)
    throw new Error(`The saved PCB has no ${name} output.`);
  return encoder.encode(output);
}

async function generate(
  location: Location,
  project: Project,
  recipe: ProjectOutputRecipe,
) {
  const captured: SourceFiles = new Map();
  const data = await (recipe.kind === 'pcb'
    ? pcbOutput(project, recipe, captured)
    : schematicOutput(location, project, recipe, captured));
  const outputDigest = await digest(data);
  const sources = Object.fromEntries(
    await Promise.all(
      [...captured.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(async ([path, { data }]) => [path, await digest(data)] as const),
    ),
  );
  const recipeDigest = await digest(
    encoder.encode(
      JSON.stringify({
        kind: recipe.kind,
        format: recipe.format ?? null,
        ...(recipe.kind === 'pcb'
          ? {
              board: recipe.board,
              layer: recipe.layer ?? null,
              decimals: recipe.decimals ?? null,
              csvText: recipe.csvText,
            }
          : recipe.board ? { board: recipe.board } : { schematic: recipe.schematic }),
        directory: recipe.directory,
        filename: recipe.filename,
      }),
    ),
  );
  const manifest: Manifest = {
    version: 1,
    recipeId: recipe.id,
    recipeDigest,
    sources,
    output: { name: recipe.filename, digest: outputDigest },
  };
  const folder = await projectFolder(location.rootId, recipe.directory);
  const entries = await projectRequest({
    operation: 'list',
    folder,
    tree: true,
  });
  async function existing(name: string) {
    const matches = entries.filter(
      (item) => item.name.toLowerCase() === name.toLowerCase(),
    );
    if (
      matches.length > 1 ||
      matches.some((item) => item.unsupported || item.folder)
    )
      throw new Error('Output path is blocked or ambiguous: ' + name);
    const [item] = matches;
    if (!item) return undefined;
    return {
      id: item.id,
      ...(await projectRequest({ operation: 'read', id: item.id })),
    };
  }
  const name = recipe.filename;
  const manifestName = name + '.manifest.json';
  const [oldOutput, oldManifest] = await Promise.all([
    existing(name),
    existing(manifestName),
  ]);
  const previous = oldOutput && (await digest(oldOutput.data));
  const ownership = oldManifest && readManifest(oldManifest.data, recipe);
  if (
    previous &&
    (!ownership ||
      (previous !== ownership.output.digest && previous !== ownership.previous))
  )
    throw new Error(
      'An existing file has been edited or is not managed by this recipe: ' +
        name,
    );

  const versions = [
    { id: location.id, version: project.version },
    ...captured.values(),
  ];
  await Promise.all(
    versions.map(async ({ id, version }) => {
      if ((await projectRequest({ operation: 'read', id })).version !== version)
        throw new Error(
          'The saved project changed during generation. Run the recipe again.',
        );
    }),
  );

  const write = (
    name: string,
    data: Uint8Array,
    file?: { id: string; version: string },
  ) =>
    projectRequest({
      operation: 'write',
      folder,
      name,
      data,
      id: file?.id,
      version: file?.version,
    });
  let manifestFile = oldManifest && {
    id: oldManifest.id,
    version: oldManifest.version,
  };
  const serialized = (value: Manifest) =>
    encoder.encode(JSON.stringify(value, null, 2) + '\n');
  if (previous !== outputDigest) {
    // A retry can recognise either the original or the newly generated file.
    manifestFile = await write(
      manifestName,
      serialized({
        ...manifest,
        pending: true,
        ...(previous ? { previous } : {}),
      }),
      manifestFile,
    );
    await write(name, data, oldOutput);
  }
  const final = serialized(manifest);
  if (
    manifestFile?.version !== oldManifest?.version ||
    !oldManifest ||
    (await digest(oldManifest.data)) !== (await digest(final))
  )
    await write(manifestName, final, manifestFile);
  return recipe.directory + '/' + name;
}

const running = new Set<string>();

export async function runProjectOutputRecipe(location: Location, id: string) {
  const key = JSON.stringify([location.id, id]);
  if (running.has(key))
    throw new Error('This output recipe is already running.');
  running.add(key);
  try {
    const project = await readProject(location.id, location.rootId);
    const recipe = project.settings.outputRecipes?.find(
      (recipe) => recipe.id === id,
    );
    if (!recipe) throw new Error('The output recipe no longer exists.');
    return await generate(location, project, recipe);
  } finally {
    running.delete(key);
    window.dispatchEvent(new Event(projectFilesChanged));
  }
}
