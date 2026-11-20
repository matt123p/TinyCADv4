import { validProjectName } from '../../shared/projectFiles';
import { onSegment } from '../layout/geometry';
import { updateSymbol } from '../manipulators/updateSymbol';
import { Snap } from '../manipulators/snap';
import type { dsnDrawing, dsnSheet, libSymbol } from '../model/dsnDrawing';
import { DocItemTypes } from '../model/dsnItem';
import type { dsnSymbol, HierarchicalLink } from '../model/dsnItem';
import { isEntityId } from '../model/schematicIdentity';
import { TextDisplayMethod } from '../model/tclib';
import { digest } from '../util/sha256';
import { XMLBuilder } from '../util/xmlbuilder';
import { ioXML } from './ioXml';

export function isChildPlacement(
  item: dsnSheet['items'][number],
): item is dsnSymbol & { hierarchy: HierarchicalLink } {
  return item.NodeName === DocItemTypes.Symbol && Boolean(item.hierarchy);
}

export function hasChildPlacements(drawing: dsnDrawing): boolean {
  return drawing.sheets.some((sheet) => sheet.items.some(isChildPlacement));
}

/** Interpret legacy locators relative to the containing schematic. Native paths start at the project root. */
export function childPath(link: HierarchicalLink, parentPath: string): string {
  const path = link.documentId ? link.path : link.path.replace(/\\/g, '/');
  if (!path || /^(?:\/|[A-Za-z]:)/.test(path))
    throw new Error(
      'Choose a schematic inside this project to replace the legacy path.',
    );
  const parts = link.documentId ? [] : parentPath.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (!link.documentId && part === '.') continue;
    if (!link.documentId && part === '..' && parts.length) {
      parts.pop();
      continue;
    }
    if (!validProjectName(part))
      throw new Error('The child path leaves the project or is invalid.');
    parts.push(part);
  }
  const relative = parts.join('/');
  if (!/\.d[sz]n$/i.test(relative))
    throw new Error('The child path must name a TinyCAD schematic.');
  return relative;
}

export async function childInterface(drawing: dsnDrawing, title: string) {
  const sheet = drawing.sheets.find(
    ({ hierarchicalSymbol }) => hierarchicalSymbol,
  );
  if (!sheet)
    throw new Error(`Add a hierarchy interface to ${title} before placing it.`);
  const items = structuredClone(sheet.items);
  const names = new Set<string>();
  const identities = new Set<string>();
  for (const item of items) {
    if (item.NodeName === DocItemTypes.Symbol)
      throw new Error(
        'A hierarchy interface uses artwork and pins. Place child designs on circuit sheets.',
      );
    if (item.NodeName !== DocItemTypes.Pin) continue;
    const name = item.name.trim();
    const id = item.pinId?.toLowerCase();
    if (!name || names.has(name) || !isEntityId(id) || identities.has(id))
      throw new Error(
        `Use distinct, nonempty port names and identities in ${title} (${
          name || 'unnamed port'
        }).`,
      );
    names.add(name);
    identities.add(id);
    item.part = 0;
  }
  if (!items.length)
    throw new Error(`Draw an interface for ${title} before placing it.`);
  // Use the canonical XML for the interface only. Circuit edits and simulation
  // data do not change the embedded interface revision.
  const artwork = { ...sheet, items };
  const xml = new XMLBuilder();
  xml.createDoc('TinyCADSheets');
  new ioXML().to_tinycad(artwork, xml, items, false, false, true);
  const revision = await digest(new TextEncoder().encode(xml.tostring()));
  return { title, items, uid: `hierarchy:${drawing.documentId}:${revision}` };
}

export type ChildInterface = Awaited<ReturnType<typeof childInterface>>;

export function hierarchyDefinition(
  sheet: dsnSheet,
  child: ChildInterface,
): libSymbol {
  const existing = Object.values(sheet.symbols).find(
    (definition) => definition.uid === child.uid,
  );
  if (existing) return existing;
  const id =
    Math.max(
      0,
      ...Object.keys(sheet.symbols).map(Number).filter(Number.isFinite),
    ) + 1;
  const outline = new ioXML().normalize_symbol(
    structuredClone(child.items),
    new Snap(sheet.details.grid, sheet.details.grid_snap),
    null,
    true,
    false,
  );
  return {
    id,
    uid: child.uid,
    parts: 1,
    heterogeneous: false,
    name: { value: child.title, type: TextDisplayMethod.ShowValue },
    ref: { value: 'H?', type: TextDisplayMethod.ShowValue },
    description: '',
    outlines: [outline],
  };
}

export function refreshPlacement(
  item: dsnSymbol,
  link: HierarchicalLink,
  definition: libSymbol,
): dsnSymbol {
  return new updateSymbol({
    ...item,
    hierarchy: { ...link, cached: true },
    _symbol: definition,
    show_power: true,
    _active_points: null,
  }).post_construction();
}

export function affectedPorts(
  sheet: dsnSheet,
  previous: dsnSymbol,
  next: dsnSymbol,
): string[] {
  const pins = new Map(
    new updateSymbol({ ...next, _active_points: null })
      .active_points()
      .map(([x, y, pin]) => [pin.pinId, { x, y, name: pin.name }]),
  );
  return new updateSymbol({ ...previous, _active_points: null })
    .active_points()
    .flatMap(([x, y, pin]) => {
      const updated = pins.get(pin.pinId);
      if (updated?.x === x && updated?.y === y && updated?.name === pin.name)
        return [];
      const point = [x, y];
      const connected = sheet.items.some((item) => {
        if (item === previous) return false;
        if (item.NodeName === DocItemTypes.Wire)
          return item.d_points
            .slice(1)
            .some((end, index) => onSegment(point, item.d_points[index], end));
        if (
          item.NodeName === DocItemTypes.Label ||
          item.NodeName === DocItemTypes.Power ||
          item.NodeName === DocItemTypes.NoConnect
        )
          return item.point[0] === x && item.point[1] === y;
        if (item.NodeName === DocItemTypes.Symbol)
          return new updateSymbol({ ...item })
            .active_points()
            .some(([px, py]) => px === x && py === y);
        return false;
      });
      return connected ? [pin.name] : [];
    });
}
