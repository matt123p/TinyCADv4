import { validProjectName, isProjectFile } from '../../shared/projectFiles';
import { isEntityId } from '../model/schematicIdentity';
import { XMLBuilder } from '../util/xmlbuilder';
export type ProjectEntryKind =
  | 'schematic'
  | 'circuit'
  | 'board'
  | 'rules'
  | 'recipe'
  | 'asset';

export interface ProjectLink {
  readonly kind: ProjectEntryKind;
  readonly id: string;
  readonly path: string;
  readonly asset?: {
    readonly source: string;
    readonly mediaType: string;
    readonly license: string;
  };
}

export interface ProjectSettings {
  projectId: string;
  revisionId: string;
  parentRevisionId?: string;
  title: string;
  requiredFeatures: readonly string[];
  entries: readonly ProjectLink[];
  primarySchematic?: string;
  primaryBoard?: string;
  associations?: readonly { schematic: string; board: string }[];
}

const extensions: Record<ProjectEntryKind, RegExp> = {
  schematic: /\.d[sz]n$/i,
  board: /\.dpn$/i,
  circuit: /\.json$/i,
  rules: /\.json$/i,
  recipe: /\.json$/i,
  asset: /./,
};

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const maxSettingsBytes = 4 * 1024 * 1024;
const canonicalId = (id: string) => isEntityId(id) && id === id.toLowerCase();

function validate(settings: ProjectSettings) {
  const { projectId, revisionId, parentRevisionId, title, entries } = settings;
  if (
    !canonicalId(projectId) ||
    !canonicalId(revisionId) ||
    (parentRevisionId !== undefined &&
      (!canonicalId(parentRevisionId) || parentRevisionId === revisionId)) ||
    !title?.trim() ||
    title.length > 1024
  )
    throw new Error('Invalid project identity, title or revision lineage.');
  if (settings.requiredFeatures.length)
    throw new Error('Unsupported required project features.');
  if (entries.length > 10000) throw new Error('Too many project links.');

  const paths = new Set<string>();
  const identities = new Set<string>();
  for (const { kind, id, path, asset } of entries) {
    const identity = `${kind}:${id}`;
    const foldedPath = path.toLowerCase();
    if (
      !Object.hasOwn(extensions, kind) ||
      !extensions[kind].test(path) ||
      !path.split('/').every(validProjectName) ||
      isProjectFile(path) ||
      paths.has(foldedPath) ||
      identities.has(identity) ||
      (kind === 'asset' ? !/^[0-9a-f]{64}$/.test(id) : !canonicalId(id))
    )
      throw new Error(`Invalid or duplicate project link: ${path}`);
    if (
      kind === 'asset'
        ? !asset ||
          ![asset.source, asset.mediaType, asset.license].every(
            (value) => value?.trim() && value.length <= 4096,
          )
        : !!asset
    )
      throw new Error(`Invalid project asset metadata: ${path}`);
    paths.add(foldedPath);
    identities.add(identity);
  }

  for (const path of paths) {
    const parts = path.split('/');
    parts.pop();
    while (parts.length) {
      if (paths.has(parts.join('/')))
        throw new Error(`Project link crosses a file: ${path}`);
      parts.pop();
    }
  }

  const hasSchematic = (id: string) => identities.has(`schematic:${id}`);
  const hasBoard = (id: string) => identities.has(`board:${id}`);
  if (
    (settings.primarySchematic !== undefined &&
      !hasSchematic(settings.primarySchematic)) ||
    (settings.primaryBoard !== undefined && !hasBoard(settings.primaryBoard))
  )
    throw new Error('Missing primary project document.');
  const associatedBoards = new Set<string>();
  for (const { schematic, board } of settings.associations || []) {
    if (
      !hasSchematic(schematic) ||
      !hasBoard(board) ||
      associatedBoards.has(board)
    )
      throw new Error('Invalid schematic-to-board association.');
    associatedBoards.add(board);
  }
}

export function encodeProjectSettings(settings: ProjectSettings): Uint8Array {
  validate(settings);
  const xml = new XMLBuilder();
  xml.createDoc('TinyCADProject');
  const {
    projectId,
    revisionId,
    parentRevisionId,
    title,
    primarySchematic,
    primaryBoard,
  } = settings;
  xml.appendChild('SETTINGS', undefined, {
    version: '1',
    projectId,
    revisionId,
    title,
    ...(parentRevisionId ? { parentRevisionId } : {}),
    ...(primarySchematic ? { primarySchematic } : {}),
    ...(primaryBoard ? { primaryBoard } : {}),
  });
  for (const { kind, id, path, asset } of [...settings.entries].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  ))
    xml.appendChild('FILE', undefined, { kind, id, path, ...asset });
  for (const association of settings.associations || [])
    xml.appendChild('ASSOCIATION', undefined, association);
  const text = xml.tostring().replace(/^<\?xml[^?]*\?>\s*/, '');
  const bytes = encoder.encode(
    '<?xml version="1.0" encoding="utf-8"?>\n' + text + '\n',
  );
  if (bytes.length > maxSettingsBytes)
    throw new Error('Project settings exceed their size limit.');
  return bytes;
}

function attributes(node: Element, allowed: string[]) {
  for (const { name } of Array.from(node.attributes)) {
    if (!allowed.includes(name))
      throw new Error(`Unsupported project setting: ${name}`);
  }
}

export function decodeProjectSettings(bytes: Uint8Array): ProjectSettings {
  if (bytes.length > maxSettingsBytes)
    throw new Error('Project settings exceed their size limit.');
  const text = decoder.decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Invalid project XML.');
  const xml = new XMLBuilder();
  xml.fromText(text);
  const root: Element = xml.xmlDoc.documentElement;
  if (
    root?.nodeName !== 'TinyCADProject' ||
    xml.getElementsByTagName('parsererror').length
  )
    throw new Error('Invalid TinyCAD project settings XML.');
  attributes(root, []);
  const entries: ProjectLink[] = [];
  const associations: { schematic: string; board: string }[] = [];
  let settings: ProjectSettings;
  for (const node of Array.from(root.childNodes)) {
    if (
      node.nodeType === 8 ||
      (node.nodeType === 3 && !node.textContent.trim())
    )
      continue;
    if (
      node.nodeType !== 1 ||
      Array.from(node.childNodes).some(
        (child) => child.nodeType !== 3 || child.textContent.trim(),
      )
    )
      throw new Error('Invalid project settings element.');
    const element = node as Element;
    const get = (name: string) => element.getAttribute(name) || '';
    switch (element.nodeName) {
      case 'SETTINGS':
        if (settings || get('version') !== '1')
          throw new Error('Unsupported TinyCAD project settings version.');
        attributes(element, [
          'version',
          'projectId',
          'title',
          'revisionId',
          'parentRevisionId',
          'primarySchematic',
          'primaryBoard',
        ]);
        settings = {
          projectId: get('projectId'),
          revisionId: get('revisionId'),
          title: get('title'),
          ...(get('parentRevisionId')
            ? { parentRevisionId: get('parentRevisionId') }
            : {}),
          ...(get('primarySchematic')
            ? { primarySchematic: get('primarySchematic') }
            : {}),
          ...(get('primaryBoard') ? { primaryBoard: get('primaryBoard') } : {}),
          requiredFeatures: [],
          entries,
        };
        break;
      case 'FILE': {
        attributes(element, [
          'kind',
          'id',
          'path',
          'source',
          'mediaType',
          'license',
        ]);
        const kind = get('kind') as ProjectEntryKind;
        const source = get('source');
        const mediaType = get('mediaType');
        const license = get('license');
        entries.push({
          kind,
          id: get('id'),
          path: get('path'),
          ...(source || mediaType || license
            ? { asset: { source, mediaType, license } }
            : {}),
        });
        break;
      }
      case 'ASSOCIATION':
        attributes(element, ['schematic', 'board']);
        associations.push({ schematic: get('schematic'), board: get('board') });
        break;
      case 'REQUIRED':
        throw new Error(
          `Unsupported required project feature: ${get('feature')}`,
        );
      default:
        throw new Error(
          `Unsupported project settings element: ${element.nodeName}`,
        );
    }
  }
  if (!settings) throw new Error('Missing project settings.');
  if (associations.length) settings.associations = associations;
  validate(settings);
  return settings;
}
