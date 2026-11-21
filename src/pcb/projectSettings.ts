import {
  isProjectFile,
  MAX_PROJECT_SETTINGS_BYTES,
  validProjectName,
} from '../../shared/projectFiles';
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

export const projectNetlistFormats = [
  'PADS-PCB',
  'PADS-PCB-WITH-VALUE',
  'Eagle SCR',
  'Protel',
  'gEDA PCB',
] as const;

export type ProjectNetlistFormat = (typeof projectNetlistFormats)[number];

type BoardOutputFormat = {
  label: string;
  stem: string;
  extension: 'csv' | 'gbr' | 'xnc' | 'svg';
  sided?: true;
  precision?: true;
};

const boardOutputFormats = {
  'board-bom': {
    label: 'PCB bill of materials',
    stem: 'bom',
    extension: 'csv',
  },
  'fitted-bom': {
    label: 'Fitted PCB bill of materials',
    stem: 'bom-fitted',
    extension: 'csv',
  },
  placement: {
    label: 'Placement CSV',
    stem: 'placement',
    extension: 'csv',
    precision: true,
  },
  assembly: {
    label: 'Assembly CSV',
    stem: 'assembly',
    extension: 'csv',
    precision: true,
  },
  copper: {
    label: 'Copper Gerber',
    stem: 'copper',
    extension: 'gbr',
    sided: true,
  },
  mask: {
    label: 'Solder mask Gerber',
    stem: 'mask',
    extension: 'gbr',
    sided: true,
  },
  paste: {
    label: 'Solder paste Gerber',
    stem: 'paste',
    extension: 'gbr',
    sided: true,
  },
  silk: { label: 'Legend Gerber', stem: 'silk', extension: 'gbr', sided: true },
  profile: { label: 'Board outline Gerber', stem: 'profile', extension: 'gbr' },
  plated: { label: 'Plated drill XNC', stem: 'plated', extension: 'xnc' },
  'non-plated': {
    label: 'Non-plated drill XNC',
    stem: 'non-plated',
    extension: 'xnc',
  },
  'assembly-drawing': {
    label: 'Assembly drawing SVG',
    stem: 'assembly',
    extension: 'svg',
    sided: true,
  },
} as const satisfies Record<string, BoardOutputFormat>;

export type ProjectBoardOutputFormat = keyof typeof boardOutputFormats;
export const projectBoardOutputFormats: Readonly<
  Record<ProjectBoardOutputFormat, BoardOutputFormat>
> = boardOutputFormats;

type RecipeDestination = {
  readonly id: string;
  readonly directory: string;
  readonly filename: string;
};

export type ProjectBoardOutputRecipe = RecipeDestination & {
  readonly kind: 'pcb';
  readonly board: string;
  readonly format: ProjectBoardOutputFormat;
  readonly layer?: 'top' | 'bottom';
  readonly decimals?: number;
  readonly csvText?: 'raw';
};

export type ProjectSchematicOutputRecipe = RecipeDestination & (
  | { readonly schematic: string; readonly board?: undefined }
  | { readonly board: string; readonly schematic?: undefined }
) & (
    | { readonly kind: 'bom'; readonly format?: never }
    | { readonly kind: 'netlist'; readonly format: ProjectNetlistFormat }
  );

export type ProjectOutputRecipe =
  | ProjectSchematicOutputRecipe
  | ProjectBoardOutputRecipe;

export function boardOutputFilename(
  format: ProjectBoardOutputFormat,
  layer?: ProjectBoardOutputRecipe['layer'],
) {
  const { stem, extension, sided } = projectBoardOutputFormats[format];
  return stem + (sided && layer ? '-' + layer : '') + '.' + extension;
}

export function boardOutputDirectory(boardPath: string, pcb = false) {
  return boardPath.slice(0, boardPath.lastIndexOf('/') + 1) + (pcb ? 'outputs/pcb' : 'outputs');
}

export interface ProjectSettings {
  projectId: string;
  revisionId: string;
  parentRevisionId?: string;
  title: string;
  author?: string;
  requiredFeatures: readonly string[];
  entries: readonly ProjectLink[];
  primarySchematic?: string;
  primaryBoard?: string;
  outputRecipes?: readonly ProjectOutputRecipe[];
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
  if (
    settings.author !== undefined &&
    (typeof settings.author !== 'string' ||
      !settings.author.trim() ||
      settings.author.length > 1024 ||
      /[\x00-\x1f\uFFFE\uFFFF]/.test(settings.author))
  )
    throw new Error('Invalid project author.');
  if (settings.requiredFeatures.length)
    throw new Error('Unsupported required project features.');
  if (entries.length > 10000) throw new Error('Too many project links.');

  const paths = new Set<string>();
  const identities = new Set<string>();
  const boardFolders = new Set<string>();
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
    if (kind === 'board') {
      const folder = foldedPath.slice(0, foldedPath.lastIndexOf('/') + 1);
      if (boardFolders.has(folder))
        throw new Error(`Only one active PCB can be registered in each board folder: ${path}`);
      boardFolders.add(folder);
    }
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
  const recipeIds = new Set<string>();
  const sourceByBoard = new Map(settings.associations?.map(({ board, schematic }) => [board, schematic]));
  const outputPaths = new Set<string>();
  if ((settings.outputRecipes?.length ?? 0) > 1000)
    throw new Error('Too many project output recipes.');
  for (const recipe of settings.outputRecipes ?? []) {
    const { id, directory, filename, kind, format } = recipe;
    const output = `${directory}/${filename}`.toLowerCase();
    const manifest = output + '.manifest.json';
    let validSourceAndFormat: boolean;
    if (kind === 'pcb') {
      const spec = Object.hasOwn(projectBoardOutputFormats, format)
        ? projectBoardOutputFormats[format]
        : undefined;
      validSourceAndFormat =
        !!spec &&
        hasBoard(recipe.board) &&
        filename.toLowerCase().endsWith('.' + spec.extension) &&
        (spec.sided
          ? recipe.layer === 'top' || recipe.layer === 'bottom'
          : recipe.layer === undefined) &&
        (recipe.decimals === undefined ||
          (!!spec.precision &&
            Number.isInteger(recipe.decimals) &&
            recipe.decimals >= 0 &&
            recipe.decimals <= 6)) &&
        (recipe.csvText === undefined || (spec.extension === 'csv' && recipe.csvText === 'raw'));
    } else {
      validSourceAndFormat =
        (recipe.board !== undefined
          ? recipe.schematic === undefined && hasBoard(recipe.board) && hasSchematic(sourceByBoard.get(recipe.board))
          : hasSchematic(recipe.schematic)) &&
        (kind === 'bom'
          ? format === undefined && /\.csv$/i.test(filename)
          : kind === 'netlist' &&
            projectNetlistFormats.includes(format) &&
            (format === 'Eagle SCR' ? /\.scr$/i : /\.net$/i).test(filename));
    }
    if (
      !canonicalId(id) ||
      recipeIds.has(id) ||
      !validSourceAndFormat ||
      !directory.split('/').every(validProjectName) ||
      !validProjectName(filename) ||
      !validProjectName(filename + '.manifest.json') ||
      outputPaths.has(output) ||
      outputPaths.has(manifest) ||
      paths.has(output) ||
      paths.has(manifest)
    )
      throw new Error(
        `Invalid or duplicate project output recipe: ${filename}`,
      );
    recipeIds.add(id);
    outputPaths.add(output);
    outputPaths.add(manifest);
  }
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
    author,
    primarySchematic,
    primaryBoard,
  } = settings;
  xml.appendChild('SETTINGS', undefined, {
    version: '1',
    projectId,
    revisionId,
    title,
    ...(author !== undefined ? { author } : {}),
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
  for (const recipe of [...(settings.outputRecipes ?? [])].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  ))
    xml.appendChild(
      'OUTPUTRECIPE',
      undefined,
      Object.fromEntries(
        Object.entries(recipe).filter(([, value]) => value !== undefined),
      ),
    );
  const text = xml.tostring().replace(/^<\?xml[^?]*\?>\s*/, '');
  const bytes = encoder.encode(
    '<?xml version="1.0" encoding="utf-8"?>\n' + text + '\n',
  );
  if (bytes.length > MAX_PROJECT_SETTINGS_BYTES)
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
  if (bytes.length > MAX_PROJECT_SETTINGS_BYTES)
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
  const recipes: ProjectOutputRecipe[] = [];
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
          'author',
          'revisionId',
          'parentRevisionId',
          'primarySchematic',
          'primaryBoard',
        ]);
        settings = {
          projectId: get('projectId'),
          revisionId: get('revisionId'),
          title: get('title'),
          ...(element.hasAttribute('author') ? { author: get('author') } : {}),
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
      case 'OUTPUTRECIPE': {
        const kind = get('kind');
        const format = get('format');
        const common = ['id', 'directory', 'filename', 'kind'];
        const base = {
          id: get('id'),
          directory: get('directory'),
          filename: get('filename'),
        };
        if (kind === 'pcb') {
          attributes(element, [
            ...common,
            'board',
            'format',
            'layer',
            'decimals',
            'csvText',
          ]);
          const layer = get('layer');
          const decimals = get('decimals');
          const csvText = get('csvText');
          if (
            !Object.hasOwn(projectBoardOutputFormats, format) ||
            (element.hasAttribute('layer') &&
              layer !== 'top' &&
              layer !== 'bottom') ||
            (element.hasAttribute('decimals') && !/^[0-6]$/.test(decimals)) ||
            (element.hasAttribute('csvText') && csvText !== 'raw')
          )
            throw new Error('Unsupported PCB output recipe settings.');
          recipes.push({
            ...base,
            kind,
            board: get('board'),
            format: format as ProjectBoardOutputFormat,
            ...(layer === 'top' || layer === 'bottom'
              ? { layer: layer as 'top' | 'bottom' }
              : {}),
            ...(decimals === '' ? {} : { decimals: Number(decimals) }),
            ...(csvText === 'raw' ? { csvText } : {}),
          });
        } else {
          attributes(element, [
            ...common,
            'schematic',
            'board',
            ...(kind === 'netlist' ? ['format'] : []),
          ]);
          const source = element.hasAttribute('board') && !element.hasAttribute('schematic')
            ? { board: get('board') }
            : !element.hasAttribute('board') && element.hasAttribute('schematic')
              ? { schematic: get('schematic') }
              : undefined;
          if (!source) throw new Error('Choose one source for the circuit output recipe.');
          if (kind === 'bom') {
            recipes.push({ ...base, kind, ...source });
          } else if (
            kind === 'netlist' &&
            projectNetlistFormats.includes(format as ProjectNetlistFormat)
          ) {
            recipes.push({
              ...base,
              kind,
              ...source,
              format: format as ProjectNetlistFormat,
            });
          } else {
            throw new Error('Unsupported project output recipe format.');
          }
        }
        break;
      }
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
  if (recipes.length) settings.outputRecipes = recipes;
  if (associations.length) settings.associations = associations;
  validate(settings);
  return settings;
}
