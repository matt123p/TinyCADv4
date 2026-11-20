import {
  affectedPorts,
  childInterface,
  hierarchyDefinition,
  isChildPlacement,
  refreshPlacement,
} from '../io/hierarchyDrawing';
import type {
  NetlistData,
  SchematicSource,
} from '../io/netlists/netlistGenerator';
import type { dsnDrawing, dsnSheet } from '../model/dsnDrawing';
import { DocItemTypes } from '../model/dsnItem';
import type { dsnSymbol, HierarchicalLink } from '../model/dsnItem';
import { isEntityId } from '../model/schematicIdentity';
import { digest } from '../util/sha256';
import {
  createSheetSnapshot,
  mergeSheetSnapshots,
} from '../web-worker/netlistState';
import type { ScopedNet, SheetSnapshot } from '../web-worker/netlistState';

export interface HierarchyDocument {
  path: string;
  drawing: dsnDrawing;
}
export type ResolveHierarchyChild = (
  parent: HierarchyDocument,
  link: HierarchicalLink,
) => Promise<HierarchyDocument>;

export class HierarchyConnectivityError extends Error {
  constructor(message: string, readonly source: SchematicSource) {
    super(`${source.documentPath} · ${message}`);
    this.name = 'HierarchyConnectivityError';
  }
}

/** The readable reference path can change without changing the physical identity. */
export async function stableHierarchyId(
  namespace: string,
  ...ids: string[]
): Promise<string> {
  const hex = await digest(
    new TextEncoder().encode(JSON.stringify([namespace, ...ids])),
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(
    13,
    16,
  )}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const referenceOf = (symbol: dsnSymbol) =>
  symbol.text.find(({ description }) => description === 'Ref')?.value?.trim();

export type HierarchicalNetlist = NetlistData & {
  sources: Record<string, SchematicSource>;
};

export async function buildHierarchicalNetlist(
  root: HierarchyDocument,
  resolve: ResolveHierarchyChild,
): Promise<HierarchicalNetlist> {
  const snapshots: SheetSnapshot[] = [];
  const scopes: { key: string; prefix: string }[] = [];
  const bindings: [ScopedNet, ScopedNet][] = [];
  const sources: Record<string, SchematicSource> = Object.create(null);
  const resolved = new Map<string, Promise<HierarchyDocument>>();
  const interfaces = new Map<string, ReturnType<typeof childInterface>>();
  let nextId = -1;
  let visits = 0;
  const exportedReferences = new Map<string, string>();

  async function visit(
    doc: HierarchyDocument,
    chain: readonly string[],
    instancePath: readonly string[],
    referencePath: readonly string[],
  ): Promise<Map<string, ScopedNet>> {
    const scopeKey = JSON.stringify(instancePath);
    const prefix = referencePath.join('_');
    const labels = new Map<string, ScopedNet>();
    const children: {
      target: HierarchyDocument;
      placement: dsnSymbol;
      source: SchematicSource;
      reference: string;
      sheet: number;
      ports: string[];
    }[] = [];
    const designators = new Map<string, boolean>();
    for (const sheet of doc.drawing.sheets) {
      if (sheet.hierarchicalSymbol || sheet.kind === 'simulation') continue;
      const index = snapshots.length;
      const sourceOf = (item: dsnSheet['items'][number]): SchematicSource => ({
        documentId: doc.drawing.documentId,
        documentPath: doc.path,
        sheetId: sheet.id,
        instancePath,
        itemId: item._id,
        ...(item.NodeName === DocItemTypes.Symbol
          ? { unitId: item.unitId }
          : {}),
      });
      const localSources = new Map<
        number,
        { source: SchematicSource; id: string }
      >();
      const name = prefix ? `${prefix} / ${sheet.name}` : sheet.name;
      const items: dsnSheet['items'] = [];
      const itemSources = new Map<number, SchematicSource>();
      for (const item of sheet.items) {
        if (item.NodeName !== DocItemTypes.Symbol) {
          const id = instancePath.length ? nextId-- : item._id;
          itemSources.set(id, sourceOf(item));
          items.push({
            ...item,
            _id: id,
            ...('hints' in item ? { hints: [] } : {}),
          });
          continue;
        }
        const source = sourceOf(item);
        const reference = referenceOf(item);
        const child = isChildPlacement(item);
        if (!reference || reference.includes('?') || !isEntityId(item.unitId))
          throw new HierarchyConnectivityError(
            'Unassigned reference or missing placement identity.',
            source,
          );
        const folded = reference.toUpperCase();
        const existing = designators.get(folded);
        if (existing !== undefined && (child || existing))
          throw new HierarchyConnectivityError(
            `Duplicate child designator ${reference}.`,
            source,
          );
        designators.set(folded, child);
        if (child) {
          try {
            const key = JSON.stringify([
              doc.path,
              item.hierarchy.path,
              item.hierarchy.documentId,
            ]);
            if (!resolved.has(key))
              resolved.set(key, resolve(doc, item.hierarchy));
            const target = await resolved.get(key);
            const targetKey = target.path.toLowerCase();
            if (chain.includes(targetKey))
              throw new Error(`Hierarchy cycle through ${target.path}.`);
            if (++visits > 4096 || instancePath.length >= 64)
              throw new Error(
                'Hierarchy exceeds the supported instance or depth limit.',
              );
            if (!interfaces.has(targetKey))
              interfaces.set(
                targetKey,
                childInterface(target.drawing, target.path),
              );
            const art = await interfaces.get(targetKey);
            const definition = hierarchyDefinition(
              { ...sheet, symbols: {} },
              art,
            );
            const current = refreshPlacement(item, item.hierarchy, definition);
            const ports = definition.outlines[0].active_points.map(({ pin }) =>
              pin.name.trim(),
            );
            if (item.hierarchy.cached) {
              const cached = item._symbol.outlines[0].active_points;
              if (
                cached.length !== ports.length ||
                cached.some(({ pin }) => !ports.includes(pin.name.trim())) ||
                affectedPorts(sheet, item, current).length
              )
                throw new Error(
                  'Reload the child interface and review its connected ports.',
                );
            }
            children.push({
              target,
              placement: item,
              source,
              reference,
              sheet: index,
              ports,
            });
            items.push({
              ...(item.hierarchy.cached ? item : current),
              hints: [],
            });
          } catch (reason) {
            throw new HierarchyConnectivityError(
              `${reference}: ${
                reason instanceof Error ? reason.message : String(reason)
              }`,
              source,
            );
          }
        } else {
          const exportRef = prefix ? `${prefix}_${reference}` : reference;
          const exportOwner = JSON.stringify([scopeKey, folded]);
          const owner = exportedReferences.get(exportRef.toUpperCase());
          if (owner && owner !== exportOwner)
            throw new HierarchyConnectivityError(
              `Ambiguous expanded reference ${exportRef}.`,
              source,
            );
          exportedReferences.set(exportRef.toUpperCase(), exportOwner);
          const id = instancePath.length
            ? await stableHierarchyId(
                'schematic-unit',
                root.drawing.documentId,
                ...instancePath,
                item.unitId,
              )
            : item.unitId;
          const runtimeId = instancePath.length ? nextId-- : item._id;
          if (sources[id])
            throw new HierarchyConnectivityError(
              'Duplicate schematic unit identity.',
              source,
            );
          sources[id] = source;
          localSources.set(runtimeId, { source, id });
          items.push({
            ...item,
            _id: runtimeId,
            unitId: id,
            _active_points: null,
            hints: [],
            text: item.text.map((field) =>
              field.description === 'Ref'
                ? { ...field, value: exportRef }
                : field,
            ),
          });
        }
      }
      const snapshot = createSheetSnapshot({ ...sheet, name, items }, true);
      for (const [net, nodes] of Object.entries(snapshot.nets)) {
        for (const node of nodes) {
          if (node.symbol) {
            const origin = localSources.get(node.symbol._id);
            node.source = origin?.source;
            node.instanceUnitId = origin?.id;
          } else if (node.parent) {
            node.source = itemSources.get(node.parent._id);
          }
          if (node.parent?.NodeName === DocItemTypes.Label)
            labels.set(node.label, { sheet: index, net });
        }
      }
      snapshots.push(snapshot);
      scopes.push({ key: scopeKey, prefix });
    }
    for (const child of children) {
      const childLabels = await visit(
        child.target,
        [...chain, child.target.path.toLowerCase()],
        [...instancePath, child.placement.unitId],
        [...referencePath, child.reference],
      );
      const ports = new Map<string, ScopedNet>();
      for (const [net, nodes] of Object.entries(snapshots[child.sheet].nets))
        for (const node of nodes)
          if (node.port?.placementId === child.placement.unitId)
            ports.set(node.port.name, { sheet: child.sheet, net });
      for (const port of child.ports) {
        const label = childLabels.get(port);
        const hotspot = ports.get(port);
        if (!label || !hotspot)
          throw new HierarchyConnectivityError(
            `${child.reference}: missing binding for port ${port} in ${child.target.path}.`,
            child.source,
          );
        bindings.push([hotspot, label]);
      }
    }
    return labels;
  }

  await visit(root, [root.path.toLowerCase()], [], []);
  return {
    ...mergeSheetSnapshots(snapshots, { scopes, bindings }),
    sources,
  };
}
