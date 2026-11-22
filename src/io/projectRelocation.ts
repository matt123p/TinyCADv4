import {
  isProjectFile,
  MAX_PROJECT_FILE_BYTES,
  validProjectName,
} from '../../shared/projectFiles';
import { XMLBuilder } from '../util/xmlbuilder';
import { digest, packDsn, unpackDsn } from './dsnContainer';
import { childPath } from './hierarchyDrawing';
import {
  decodeProjectSettings,
  encodeProjectSettings,
} from '../pcb/projectSettings';
import type { ProjectSettings } from '../pcb/projectSettings';
import { findProjectPath, projectRequest, readProject } from './projects';
import { inProjectTransaction } from './projectReferenceTransaction';
import {
  deleteProjectFileJournal,
  readProjectFileJournal,
  writeProjectFileJournal,
} from './projectRecovery';
import type { ProjectRelocationJournal } from './projectRecovery';
import type { ProjectItem } from './projectStorage';

type Endpoint = ProjectRelocationJournal['source'];

function pathIsWithin(path: string, source: string, directory: boolean) {
  if (!source) return false;
  const from = source.toLowerCase();
  const candidate = path.toLowerCase();
  return candidate === from || (directory && candidate.startsWith(from + '/'));
}

function relocatedPath(
  path: string,
  source: string,
  destination: string,
  directory: boolean,
) {
  return pathIsWithin(path, source, directory)
    ? destination + path.slice(source.length)
    : path;
}

function relativeChild(parent: string, child: string) {
  const folders = parent.split('/').slice(0, -1);
  const parts = child.split('/');
  let common = 0;
  while (
    common < folders.length &&
    folders[common].toLowerCase() === parts[common]?.toLowerCase()
  )
    common++;
  return [
    ...folders.slice(common).map(() => '..'),
    ...parts.slice(common),
  ].join('/');
}

function parentPath(path: string) {
  return path.slice(0, Math.max(0, path.lastIndexOf('/')));
}

function list(folder: string) {
  return projectRequest({ operation: 'list', folder, tree: true });
}

async function changeLocation(item: ProjectItem, from: Endpoint, to: Endpoint) {
  await projectRequest({
    operation: from.folder === to.folder ? 'rename' : 'move',
    id: item.id,
    from: from.folder,
    folder: to.folder,
    name: to.name,
    directory: item.folder,
  });
}

async function recoveryItem(location: Endpoint) {
  const matches = (await list(location.folder)).filter(
    ({ name }) => name === location.name,
  );
  if (matches.length > 1 || matches[0]?.unsupported)
    throw new Error('A saved project move has an ambiguous file location.');
  return matches[0];
}

function settingsPaths(settings: ProjectSettings) {
  return digest(
    new TextEncoder().encode(
      JSON.stringify([
        settings.projectId,
        settings.entries.map(({ kind, id, path }) => [kind, id, path]).sort(),
        settings.outputRecipes
          ?.map(({ id, directory, filename }) => [id, directory, filename])
          .sort() ?? [],
      ]),
    ),
  );
}

async function recover(journal: ProjectRelocationJournal) {
  const { key, source, destination, root, directory, identity, rewrites } =
    journal;
  const [marker, oldItem, newItem] = await Promise.all([
    projectRequest({ operation: 'read', id: key }),
    recoveryItem(source),
    recoveryItem(destination),
  ]);
  const markerDigest = await digest(marker.data);
  const unchangedMarker =
    markerDigest === journal.markerBefore ||
    markerDigest === journal.markerAfter;
  const paths = unchangedMarker
    ? undefined
    : await settingsPaths(decodeProjectSettings(marker.data));
  const committed = Boolean(
    journal.markerAfter &&
      (markerDigest === journal.markerAfter ||
        (paths && paths === journal.pathsAfter)),
  );
  const markerBefore =
    markerDigest === journal.markerBefore || paths === journal.pathsBefore;
  const moved = !oldItem && Boolean(newItem);
  const item = oldItem ?? newItem;
  const recoveryError =
    'A file changed during a project move. The recovery copy has been retained.';
  if (
    !item ||
    (oldItem && newItem) ||
    item.folder !== directory ||
    (committed && !moved) ||
    (!committed && !markerBefore)
  )
    throw new Error(recoveryError);
  const currentIdentity = directory
    ? await projectRequest({ operation: 'folder-identity', id: item.id })
    : await digest(
        (
          await projectRequest({ operation: 'read', id: item.id })
        ).data,
      );
  if (
    currentIdentity !== identity &&
    (directory ||
      currentIdentity !==
        rewrites.find(({ path }) => path === source.path)?.after)
  )
    throw new Error(recoveryError);

  const restore = [];
  for (const rewrite of rewrites) {
    const path = moved
      ? relocatedPath(rewrite.path, source.path, destination.path, directory)
      : rewrite.path;
    const file = await findProjectPath(root, path);
    if (!file) throw new Error(recoveryError);
    const saved = await projectRequest({ operation: 'read', id: file.id });
    const hash = await digest(saved.data);
    if (hash === rewrite.after && !committed)
      restore.push({ file, version: saved.version, data: rewrite.data });
    else if (hash !== (committed ? rewrite.after : rewrite.before))
      throw new Error(recoveryError);
  }
  for (const { file, version, data } of restore) {
    await projectRequest({
      operation: 'write',
      id: file.id,
      name: file.name,
      folder: root,
      data,
      version,
    });
  }
  if (!committed && moved) await changeLocation(item, destination, source);
  await deleteProjectFileJournal(key);
  return committed;
}

export async function recoverProjectRelocation(journal: ProjectRelocationJournal) {
  await recover(journal);
}

async function prepareHierarchyRewrites(
  project: Awaited<ReturnType<typeof readProject>>,
  root: string,
  mapPath: (path: string) => string,
  isOpen: (id: string) => boolean,
) {
  const schematics = new Map(
    project.settings.entries
      .filter(({ kind }) => kind === 'schematic')
      .map(({ id, path }) => [path.toLowerCase(), { id, path }]),
  );
  const seen = new Set<string>();
  const pending = [...schematics.values()].map(({ path }) => path);
  const rewrites: (ProjectRelocationJournal['rewrites'][number] & {
    next: Uint8Array;
  })[] = [];
  let rewriteBytes = 0;

  for (const path of pending) {
    if (seen.has(path.toLowerCase())) continue;
    seen.add(path.toLowerCase());
    if (seen.size > 10_000)
      throw new Error(
        'This project has too many hierarchy files to move at once.',
      );
    const file = project.files.get(path) ?? (await findProjectPath(root, path));
    if (!file) continue;
    const saved = await projectRequest({ operation: 'read', id: file.id });
    const { xml, payloads, representation } = await unpackDsn(saved.data);
    if (!/<HIERAR?CHICAL_SYMBOL[\s>]/.test(xml)) continue;
    const builder = new XMLBuilder();
    builder.fromText(xml);
    if (builder.getElementsByTagName('parsererror').length)
      throw new Error('Invalid schematic XML in ' + path);
    let changed = false;
    const placements = ['HIERARCHICAL_SYMBOL', 'HIERACHICAL_SYMBOL'].flatMap(
      (tag) => Array.from(builder.getElementsByTagName(tag)) as Element[],
    );
    for (const node of placements) {
      const oldLink = node.getAttribute('file') ?? '';
      const documentId = node.getAttribute('child_uuid')?.toLowerCase();
      let child: string;
      try {
        child = childPath({ path: oldLink, documentId, cached: false }, path);
      } catch {
        continue;
      }
      const registered = schematics.get(child.toLowerCase());
      if (documentId && registered?.id !== documentId) continue;
      if (!documentId && !registered) pending.push(child);
      const target = mapPath(registered?.path ?? child);
      if (
        child === target &&
        (documentId || parentPath(path) === parentPath(mapPath(path)))
      )
        continue;
      const locator = documentId
        ? target
        : relativeChild(mapPath(path), target);
      if (locator === oldLink) continue;
      node.setAttribute('file', locator);
      changed = true;
    }
    if (!changed) continue;
    if (isOpen(file.id))
      throw new Error(
        'Close the affected hierarchy schematics before moving them.',
      );
    const nextXml = builder.tostring().replace(/^<\?xml[^?]*\?>\s*/, '');
    const next =
      representation === 'zip-v1'
        ? await packDsn(nextXml, payloads)
        : new TextEncoder().encode(nextXml);
    rewriteBytes += saved.data.byteLength + next.byteLength;
    if (rewriteBytes > MAX_PROJECT_FILE_BYTES)
      throw new Error('The project move exceeds the available recovery size.');
    rewrites.push({
      path,
      data: saved.data,
      before: await digest(saved.data),
      after: await digest(next),
      next,
    });
  }
  return rewrites;
}

export async function relocateProjectPath(
  key: string,
  root: string,
  item: ProjectItem,
  source: Endpoint,
  destination: Endpoint,
  isOpen: (id: string) => boolean,
) {
  if (source.path === destination.path) return;
  if (
    !destination.path.split('/').every(validProjectName) ||
    isProjectFile(destination.path) ||
    (item.folder &&
      pathIsWithin(parentPath(destination.path), source.path, true))
  )
    throw new Error('Choose an available destination inside the project.');

  const project = await readProject(key, root);
  return inProjectTransaction(key, async () => {
    if (await readProjectFileJournal(key))
      throw new Error('Reopen the project to recover its previous file operation.');
    const marker = await projectRequest({ operation: 'read', id: key });
    if (marker.version !== project.version)
      throw new Error(
        'Project settings changed. Refresh the project and try again.',
      );

    const sourceItem = await findProjectPath(root, source.path, item.folder);
    const destinationParent = parentPath(destination.path);
    const destinationFolder = destinationParent
      ? (await findProjectPath(root, destinationParent, true))?.id
      : root;
    const collisions = (await list(destination.folder)).filter(
      ({ name, id }) =>
        name.toLowerCase() === destination.name.toLowerCase() && id !== item.id,
    );
    if (
      sourceItem?.id !== item.id ||
      destinationFolder !== destination.folder ||
      collisions.length
    )
      throw new Error(
        'The file or destination changed. Refresh the project and try again.',
      );

    const mapPath = (path: string) =>
      relocatedPath(path, source.path, destination.path, item.folder);
    const { settings } = project;
    const entries = settings.entries.map((entry) => {
      const path = mapPath(entry.path);
      if (path === entry.path) return entry;
      const file = project.files.get(entry.path);
      if (!file || isOpen(file.id))
        throw new Error(
          'Close the affected project documents before moving them.',
        );
      if (
        entry.kind === 'schematic' &&
        entry.path.slice(-4).toLowerCase() !== path.slice(-4).toLowerCase()
      )
        throw new Error('Use Save As to change a schematic file format.');
      return { ...entry, path };
    });
    const outputRecipes = settings.outputRecipes?.map((recipe) =>
      item.folder
        ? { ...recipe, directory: mapPath(recipe.directory) }
        : recipe,
    );
    const changesSettings =
      entries.some((entry, i) => entry !== settings.entries[i]) ||
      outputRecipes?.some(
        (recipe, i) => recipe.directory !== settings.outputRecipes[i].directory,
      );
    const updatedSettings = { ...settings, entries, outputRecipes };
    const data = changesSettings
      ? encodeProjectSettings(updatedSettings)
      : marker.data;

    const rewrites =
      item.folder || /\.d[sz]n$/i.test(item.name)
        ? await prepareHierarchyRewrites(project, root, mapPath, isOpen)
        : [];

    const markerBefore = await digest(marker.data);
    const markerAfter = await digest(data);
    if (markerAfter === markerBefore && !rewrites.length) {
      await changeLocation(item, source, destination);
      return;
    }
    const identity = item.folder
      ? await projectRequest({ operation: 'folder-identity', id: item.id })
      : await digest(
          (
            await projectRequest({ operation: 'read', id: item.id })
          ).data,
        );
    if (isOpen(key))
      throw new Error(
        'Close the project settings tab before moving linked files.',
      );
    await writeProjectFileJournal({
      kind: 'move',
      key,
      root,
      source,
      destination,
      directory: item.folder,
      identity,
      markerBefore,
      markerAfter: changesSettings ? markerAfter : undefined,
      pathsBefore: await settingsPaths(settings),
      pathsAfter: changesSettings
        ? await settingsPaths(updatedSettings)
        : undefined,
      rewrites: rewrites.map(({ path, data, before, after }) => ({
        path,
        data,
        before,
        after,
      })),
    });
    try {
      await changeLocation(item, source, destination);
      for (const rewrite of rewrites) {
        const file = await findProjectPath(root, mapPath(rewrite.path));
        if (!file)
          throw new Error('The moved hierarchy schematic could not be found.');
        // A move can change the provider version even when bytes were preserved.
        const saved = await projectRequest({ operation: 'read', id: file.id });
        if ((await digest(saved.data)) !== rewrite.before)
          throw new Error(
            'An affected schematic changed during the project move.',
          );
        await projectRequest({
          operation: 'write',
          id: file.id,
          name: file.name,
          folder: root,
          data: rewrite.next,
          version: saved.version,
        });
      }
      if (markerAfter !== markerBefore) {
        await projectRequest({
          operation: 'write',
          id: key,
          name: project.marker.name,
          folder: root,
          data,
          version: marker.version,
        });
      }
      await deleteProjectFileJournal(key);
    } catch (failure) {
      const journal = await readProjectFileJournal(key);
      if (journal && journal.kind !== 'trash' && (await recover(journal))) return;
      throw failure;
    }
  });
}
