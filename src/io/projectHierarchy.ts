import { DocItemTypes } from '../model/dsnItem';
import type { HierarchicalLink } from '../model/dsnItem';
import type { dsnDrawing } from '../model/dsnDrawing';
import type { ProjectLink } from '../pcb/projectSettings';
import { unpackDsn } from './dsnContainer';
import { ioXML } from './ioXml';
import { XMLBuilder } from '../util/xmlbuilder';
import {
  childInterface,
  childPath,
  hierarchyDefinition,
  isChildPlacement,
  refreshPlacement,
} from './hierarchyDrawing';
import { findProjectPath, projectRequest, readProject } from './projects';
import type { OpenProjectDrawing } from './projectStorage';

type Project = Awaited<ReturnType<typeof readProject>>;
type Location = Pick<OpenProjectDrawing, 'rootId' | 'documentPath'>;

async function readDrawingStructure(data: Uint8Array) {
  // Looking at another document's interface must not load its simulation
  // results into the active editor's result store.
  const { xml } = await unpackDsn(data);
  const builder = new XMLBuilder();
  builder.fromText(xml);
  return new ioXML().from_dsn(builder);
}

export async function readProjectSchematic(
  project: Project,
  link: ProjectLink,
) {
  const file = project.files.get(link.path);
  if (!file)
    throw new Error(`Missing or ambiguous project schematic: ${link.path}`);
  const { data } = await projectRequest({ operation: 'read', id: file.id });
  const drawing = await readDrawingStructure(data);
  if (drawing.documentId.toLowerCase() !== link.id)
    throw new Error(
      `Schematic identity does not match the project link: ${link.path}`,
    );
  return drawing;
}

export async function resolveChild(
  project: Project,
  location: Location,
  link: HierarchicalLink,
) {
  const path = childPath(link, location.documentPath);
  const entry = project.settings.entries.find(
    (entry) =>
      entry.kind === 'schematic' &&
      entry.path.toLowerCase() === path.toLowerCase(),
  );
  if (link.documentId && entry?.id !== link.documentId)
    throw new Error(`The child identity and project path disagree: ${path}`);
  if (entry)
    return {
      path: entry.path,
      entry,
      drawing: await readProjectSchematic(project, entry),
    };

  const file = await findProjectPath(location.rootId, path);
  if (!file) throw new Error(`Missing or ambiguous child schematic: ${path}`);
  const { data } = await projectRequest({ operation: 'read', id: file.id });
  const drawing = await readDrawingStructure(data);
  return { path, entry: undefined, drawing };
}

export async function loadLegacyInterfaces(
  project: Project,
  location: Location,
  drawing: dsnDrawing,
): Promise<dsnDrawing> {
  const loaded = new Map<
    string,
    Promise<Awaited<ReturnType<typeof resolveChild>>>
  >();
  const sheets = await Promise.all(
    drawing.sheets.map(async (sheet) => {
      let symbols = sheet.symbols;
      const items = [...sheet.items];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!isChildPlacement(item) || item.hierarchy.documentId) continue;
        try {
          const key = item.hierarchy.path;
          if (!loaded.has(key))
            loaded.set(key, resolveChild(project, location, item.hierarchy));
          const child = await loaded.get(key);
          if (child.path.toLowerCase() === location.documentPath.toLowerCase())
            continue;
          const link = child.entry
            ? {
                path: child.entry.path,
                documentId: child.entry.id,
                cached: true,
              }
            : item.hierarchy;
          if (item.hierarchy.cached) {
            if (child.entry) items[i] = { ...item, hierarchy: link };
            continue;
          }
          const art = await childInterface(
            child.drawing,
            child.path.split('/').pop(),
          );
          const definition = hierarchyDefinition({ ...sheet, symbols }, art);
          symbols = { ...symbols, [definition.id]: definition };
          items[i] = refreshPlacement(item, link, definition);
        } catch {
          // The original locator stays in the document and can be inspected or repaired.
        }
      }
      return items.every((item, i) => item === sheet.items[i])
        ? sheet
        : { ...sheet, items, symbols };
    }),
  );
  return sheets.every((sheet, i) => sheet === drawing.sheets[i])
    ? drawing
    : { ...drawing, sheets };
}

export async function findChildUsages(
  project: Project,
  documentPath: string,
  documentId: string,
  current: dsnDrawing,
) {
  const uses: {
    entryId: string;
    path: string;
    sheetId: string;
    sheetName: string;
    placementId: string;
    reference: string;
  }[] = [];
  const unread: string[] = [];
  for (const entry of project.settings.entries) {
    if (entry.kind !== 'schematic') continue;
    try {
      const drawing =
        entry.id === documentId
          ? current
          : await readProjectSchematic(project, entry);
      for (const sheet of drawing.sheets) {
        for (const item of sheet.items) {
          if (item.NodeName !== DocItemTypes.Symbol || !item.hierarchy)
            continue;
          if (
            item.hierarchy.documentId &&
            item.hierarchy.documentId !== documentId
          )
            continue;
          let path: string;
          try {
            path = childPath(item.hierarchy, entry.path);
          } catch {
            continue;
          }
          if (path.toLowerCase() !== documentPath.toLowerCase()) continue;
          uses.push({
            entryId: entry.id,
            path: entry.path,
            sheetId: sheet.id,
            sheetName: sheet.name,
            placementId: item.unitId,
            reference:
              item.text.find(({ description }) => description === 'Ref')
                ?.value ?? 'H?',
          });
        }
      }
    } catch {
      unread.push(entry.path);
    }
  }
  return { uses, unread };
}

/** Resolve stable schematic provenance from the root, preserving the exact repeated-instance path. */
export async function navigateSchematicSource(
  location: OpenProjectDrawing,
  root: dsnDrawing,
  source: Omit<import('./netlists/netlistGenerator').SchematicSource, 'itemId'>,
): Promise<import('./projects').OpenProjectAction['location']> {
  const project = await readProject(location.id, location.rootId);
  let entry = project.settings.entries.find(
    (link) => link.kind === 'schematic' && link.id === location.entryId,
  );
  if (!entry)
    throw new Error('The hierarchy root is no longer part of the project.');
  let drawing = root;
  const trail: import('./projectStorage').HierarchyFrame[] = [];
  for (const placementId of source.instancePath) {
    const sheet = drawing.sheets.find((sheet) =>
      sheet.items.some(
        (item) => isChildPlacement(item) && item.unitId === placementId,
      ),
    );
    const placement = sheet?.items.find(
      (item) => isChildPlacement(item) && item.unitId === placementId,
    );
    if (!placement || !isChildPlacement(placement))
      throw new Error('The source placement no longer exists.');
    const reference =
      placement.text.find(({ description }) => description === 'Ref')?.value ||
      'H?';
    trail.push({
      entryId: entry.id,
      name: entry.path,
      sheetId: sheet.id,
      reference,
      placementId,
    });
    const child = await resolveChild(
      project,
      { rootId: location.rootId, documentPath: entry.path },
      placement.hierarchy,
    );
    if (!child.entry)
      throw new Error('The source schematic is no longer part of the project.');
    entry = child.entry;
    drawing = child.drawing;
  }
  const sheet = drawing.sheets.find(({ id }) => id === source.sheetId);
  const unit = sheet?.items.find(
    (item) =>
      item.NodeName === DocItemTypes.Symbol && item.unitId === source.unitId,
  );
  if (drawing.documentId !== source.documentId || !unit)
    throw new Error('The original schematic unit no longer exists.');
  return {
    id: location.id,
    name: location.name,
    rootId: location.rootId,
    folderId: location.folderId,
    entryId: entry.id,
    openSheetId: source.sheetId,
    openUnitId: source.unitId,
    hierarchyTrail: trail,
  };
}
