import type { dsnDrawing, dsnSheet, libSymbolPart } from '../model/dsnDrawing';
import {
  DocItemTypes,
  type Coordinate,
  type dsnPin,
  type dsnSymbol,
  type dsnText,
} from '../model/dsnItem';
import { Snap } from '../manipulators/snap';
import { updateSymbol } from '../manipulators/updateSymbol';
import { updateFactory, updateTextFactory } from '../manipulators/updateFactory';
import { getFont, measureText } from '../util/measureText';
import { decodeDrawing } from './dsnCodec';
import { blank, ioXML } from './ioXml';
import { projectRequest } from './projects';
import { get_global_id } from '../util/global_id';

function missingOutline(): libSymbolPart {
  const marker: dsnText = {
    NodeName: DocItemTypes.Text,
    _id: get_global_id(),
    point: [-32, -32],
    point_b: [0, 0],
    rotation: 0,
    text: '?',
    textData: null,
    font_name: 'Arial',
    font_size: 22,
    font_bold: true,
    font_italic: false,
    font_colour: '#b42318',
    line_colour: '#b42318',
    line_width: 1,
    line_pattern: -1,
    stroked: true,
    filled: false,
    fill_colour: '#ffffff',
    hatch: 0,
  };
  return {
    items: [updateTextFactory(marker).post_construction()],
    active_points: [],
    size: [32, 32],
    ref_point: [0, 0],
  };
}

function legacyPinEnd(pin: dsnPin): Coordinate {
  const [x, y] = pin.point;
  const length = pin.length;
  if (pin.which === 4 || pin.which === 5 || !length) return [x, y];
  const sizing = length <= 20 ? 20 : 30;
  const spacing =
    length +
    Math.floor(sizing / 8) +
    (pin.which & 2 ? 2 * Math.floor(sizing / 6) : 0);
  const width = Math.round(measureText(getFont(pin), pin.name));
  const height = pin.centre_name
    ? pin.font_size
    : Math.floor(pin.font_size / 2);
  switch (pin.rotation) {
    case 3: {
      const end = y - (pin.centre_name ? (length - width) / 2 : spacing);
      return pin.show_name
        ? [x, Math.min(end - width, y - length)]
        : [x + height, end];
    }
    case 1: {
      const end =
        y + (pin.centre_name ? (width + length) / 2 : spacing + width);
      return pin.show_name ? [x, Math.max(end, y + length)] : [x + height, end];
    }
    case 2: {
      const end =
        x - (pin.centre_name ? (width + length) / 2 : width + spacing);
      return pin.show_name ? [Math.min(end, x - length), y] : [end, y + height];
    }
    default: {
      const end = x + (pin.centre_name ? (length - width) / 2 : spacing);
      return pin.show_name ? [Math.max(end, x + length), y] : [end, y + height];
    }
  }
}

function hierarchyOutline(xml: ioXML, artwork: dsnSheet, parent: dsnSheet) {
  const items = structuredClone(artwork.items);
  const snap = new Snap(parent.details.grid, parent.details.grid_snap);
  // V3 anchors the outline at its maximum corner using the first visible pin's
  // grid offset. Its rotation pivot includes the independently snapped minimum.
  const low = [Infinity, Infinity];
  const high = [0, 0];
  for (const item of items) {
    let points: Coordinate[];
    if (item.NodeName === DocItemTypes.Pin) {
      if (!Number.isFinite(item.length) || (item.length > 0 && item.length < 5))
        item.length = 20;
      points = [item.point, legacyPinEnd(item)];
    } else if ('point_b' in item && item.point_b && item.point) {
      points = [item.point, item.point_b];
    } else {
      const box = updateFactory(item)?.getBoundingRect();
      if (!box) continue;
      points = [
        [box.x1, box.y1],
        [box.x2, box.y2],
      ];
    }
    for (const [x, y] of points) {
      low[0] = Math.min(low[0], x);
      low[1] = Math.min(low[1], y);
      high[0] = Math.max(high[0], x);
      high[1] = Math.max(high[1], y);
    }
  }
  const firstPin = items.find(
    (item): item is dsnPin =>
      item.NodeName === DocItemTypes.Pin && item.which !== 4,
  );
  const pinned = firstPin && snap.snap(firstPin.point);
  const origin = snap.snap(high);
  const minimum = snap.snap(low.every(Number.isFinite) ? low : high);
  for (let axis = 0; axis < 2; axis++) {
    const offset = pinned ? firstPin.point[axis] - pinned[axis] : 0;
    origin[axis] += offset;
    minimum[axis] += offset;
    if (origin[axis] < high[axis]) origin[axis] += snap._grid;
    if (minimum[axis] > low[axis] && Number.isFinite(low[axis]))
      minimum[axis] -= snap._grid;
  }
  const outline = xml.normalize_symbol(items, snap, origin, true, true);
  outline.size = [origin[0] - minimum[0], origin[1] - minimum[1]];
  return outline;
}

export async function prepareHierarchicalPlacement(
  drawing: dsnDrawing,
  sheetIndex: number,
  project: string,
  owner: string | undefined,
  fileId: string,
  openDrawings?: ReadonlyMap<string, dsnDrawing>,
) {
  const file = await projectRequest({
    operation: 'read-hierarchical-drawing',
    project,
    owner,
    filename: fileId,
  });
  const used = new Set(
    drawing.sheets.flatMap((sheet) =>
      sheet.items.flatMap((item) =>
        item.NodeName === DocItemTypes.Symbol
          ? item.text
              .filter(({ description }) => description === 'Ref')
              .map(({ value }) => value)
          : [],
      ),
    ),
  );
  let number = 1;
  while (used.has(`H${number}`)) number++;
  const item: dsnSymbol = {
    NodeName: DocItemTypes.Symbol,
    _id: get_global_id(),
    point: [0, 0],
    hierarchicalFile: file.relative,
    show_power: true,
    allow_resize: false,
    scale_x: 1,
    scale_y: 1,
    part: 0,
    rotation: 0,
    _symbol: {
      id: null,
      name: null,
      ref: null,
      description: '',
      uid: null,
      outlines: [
        { items: [], active_points: [], size: [0, 0], ref_point: [0, 0] },
      ],
      parts: 1,
      heterogeneous: false,
    },
    text: [
      {
        description: 'Ref',
        value: `H${number}`,
        show: true,
        display: 0,
        position: [5, 0],
      },
      {
        description: 'Design',
        value: file.id.split(/[\\/]/).at(-1)!,
        show: true,
        display: 0,
        position: [5, 12],
      },
    ],
    font_name: 'Arial',
    font_colour: '#FF0000',
    font_bold: false,
    font_italic: false,
    font_size: 10,
    hints: [],
    textData: [],
    _active_points: undefined,
  };
  const result = await resolveProjectHierarchy(
    { ...drawing, sheets: [{ ...drawing.sheets[sheetIndex], items: [item] }] },
    project,
    owner,
    openDrawings,
  );
  const placement = result.sheets[0].items[0] as dsnSymbol;
  if (placement._hierarchicalError)
    throw new Error(placement._hierarchicalError);
  return placement;
}

export function hasProjectHierarchy(drawing: dsnDrawing) {
  return drawing.sheets.some((sheet) =>
    sheet.items.some(
      (item) =>
        item.NodeName === DocItemTypes.Symbol &&
        item.hierarchicalFile !== undefined,
    ),
  );
}

export async function rebaseProjectHierarchy(
  drawing: dsnDrawing,
  project: string,
  previous: string | undefined,
  next: string,
) {
  const changed: dsnSymbol[] = [];
  for (const sheet of drawing.sheets)
    for (const item of sheet.items)
      if (
        item.NodeName === DocItemTypes.Symbol &&
        item.hierarchicalFile !== undefined &&
        ((item._hierarchicalOwner ?? previous) !== next ||
          (!item._hierarchicalError && /^(?:[A-Za-z]:|[\\/])/.test(item.hierarchicalFile)))
      )
        changed.push(item);
  if (!changed.length) return drawing;
  const filenames = await projectRequest({
    operation: 'rebase-hierarchical-links',
    project,
    owner: next,
    links: changed.map((item) => ({
      owner: item._hierarchicalOwner ?? previous,
      filename: item.hierarchicalFile,
    })),
  });
  const changes = new Map(
    changed.map((item, index) => [item, filenames[index]]),
  );
  return {
    ...drawing,
    sheets: drawing.sheets.map((sheet) => ({
      ...sheet,
      items: sheet.items.map((item) =>
        item.NodeName === DocItemTypes.Symbol && changes.has(item)
          ? { ...item, hierarchicalFile: changes.get(item) }
          : item,
      ),
    })),
  };
}

export async function resolveProjectHierarchy(
  drawing: dsnDrawing,
  project: string,
  owner?: string,
  openDrawings?: ReadonlyMap<string, dsnDrawing>,
): Promise<dsnDrawing> {
  const xml = new ioXML();
  const loaded = new Map<string, dsnDrawing>();
  let placeholder: libSymbolPart;
  const requests = new Map<string, Promise<{ id: string; relative: string; data: Uint8Array }>>();
  let placements = 0;

  async function hydrate(
    source: dsnDrawing,
    id: string | undefined,
    stack: string[],
  ) {
    let changed = false;
    const sheets = [];
    for (const sheet of source.sheets) {
      if (sheet.hierarchicalSymbol) {
        sheets.push(sheet);
        continue;
      }
      let linked = false;
      const items = [];
      for (const item of sheet.items) {
        if (
          item.NodeName !== DocItemTypes.Symbol ||
          item.hierarchicalFile === undefined
        ) {
          items.push(item);
          continue;
        }
        changed = linked = true;
        // Keep the draft's project-root anchor when the editor acquires a saved filename.
        const owner = item._hierarchicalOwner ?? id ?? project;
        const symbol: dsnSymbol = {
          ...item,
          _hierarchicalOwner: owner,
          _hierarchicalTarget: undefined,
          _hierarchicalDrawing: undefined,
          _hierarchicalError: undefined,
        };
        try {
          if (++placements > 1000 || stack.length > 100)
            throw new Error('The schematic hierarchy exceeds its size limit.');
          const key = JSON.stringify([owner, item.hierarchicalFile]);
          if (!requests.has(key))
            requests.set(
              key,
              projectRequest({
                operation: 'read-hierarchical-drawing',
                project,
                owner,
                filename: item.hierarchicalFile,
              }),
            );
          const file = await requests.get(key)!;
          if (stack.includes(file.id))
            throw new Error('The linked schematics contain a cycle.');
          symbol._hierarchicalTarget = file.id;
          if (/^(?:[A-Za-z]:|[\\/])/.test(item.hierarchicalFile))
            symbol.hierarchicalFile = file.relative;
          if (!loaded.has(file.id))
            loaded.set(file.id, openDrawings?.get(file.id) ??
              (file.data.length ? await decodeDrawing(file.data) : blank()));
          const child = loaded.get(file.id)!;
          const artwork = child.sheets.find(
            (part) => part.hierarchicalSymbol,
          );
          if (!artwork)
            throw new Error(
              'The linked schematic has no hierarchical symbol sheet.',
            );
          const outline = hierarchyOutline(xml, artwork, sheet);
          symbol._symbol = { ...item._symbol, outlines: [outline] };
          symbol._active_points = undefined;
          symbol._hierarchicalDrawing = await hydrate(child, file.id, [
            ...stack,
            file.id,
          ]);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          symbol._hierarchicalError = message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
          symbol._symbol = { ...item._symbol, outlines: [placeholder ??= missingOutline()] };
          symbol._active_points = undefined;
          symbol.hints = [];
        }
        items.push(new updateSymbol(symbol).post_construction());
      }
      sheets.push(linked ? { ...sheet, items } : sheet);
    }
    return changed ? { ...source, sheets } : source;
  }

  return hydrate(drawing, owner, owner ? [owner] : []);
}
